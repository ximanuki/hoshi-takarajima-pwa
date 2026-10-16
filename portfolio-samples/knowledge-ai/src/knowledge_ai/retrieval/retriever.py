"""Hybrid retriever: BM25 (character bigrams) + dense (multilingual-e5) fused with RRF.

Besides the ranked hits it returns *support signals* — how well the corpus
appears to cover the question — which drive abstention.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from knowledge_ai.models import Chunk
from knowledge_ai.retrieval.bm25 import BM25Index
from knowledge_ai.retrieval.embeddings import Embedder
from knowledge_ai.retrieval.fusion import reciprocal_rank_fusion
from knowledge_ai.retrieval.glossary import QueryExpander
from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer
from knowledge_ai.store.base import ChunkStore, NumpyVectorIndex, VectorIndex

Mode = Literal["hybrid", "bm25", "dense"]
MODES: tuple[Mode, ...] = ("bm25", "dense", "hybrid")


@dataclass
class Hit:
    chunk: Chunk
    rank: int
    score: float  # the score the list is ordered by (RRF score in hybrid mode)
    bm25_score: float | None = None
    bm25_rank: int | None = None
    dense_score: float | None = None
    dense_rank: int | None = None


@dataclass
class SupportSignals:
    """Evidence that the corpus covers the question (inputs to abstention).

    * ``dense_top`` — best cosine similarity between the query and any chunk.
    * ``lexical_coverage`` — IDF-weighted share of the query's bigrams that occur
      in the top-ranked chunk. Terms absent from the whole corpus get the
      maximum IDF, so "社員食堂" in a corpus without it pulls coverage down hard.
    """

    dense_top: float = 0.0
    lexical_coverage: float = 0.0
    bm25_top: float = 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "dense_top": round(self.dense_top, 4),
            "lexical_coverage": round(self.lexical_coverage, 4),
            "bm25_top": round(self.bm25_top, 4),
        }


@dataclass
class RetrievalResult:
    query: str
    mode: Mode
    hits: list[Hit]
    signals: SupportSignals
    timings_ms: dict[str, float] = field(default_factory=dict)


class HybridRetriever:
    def __init__(
        self,
        chunks: Sequence[Chunk],
        embedder: Embedder,
        vector_index: VectorIndex,
        tokenizer: CharNgramTokenizer | None = None,
        rrf_k: int = 60,
        candidate_k: int = 30,
        expander: QueryExpander | None = None,
    ) -> None:
        self.chunks = list(chunks)
        self.expander = expander or QueryExpander()
        self.by_id = {c.chunk_id: c for c in self.chunks}
        self.embedder = embedder
        self.vector_index = vector_index
        self.tokenizer = tokenizer or CharNgramTokenizer(2)
        self.rrf_k = rrf_k
        self.candidate_k = candidate_k
        self.bm25 = BM25Index(
            [c.chunk_id for c in self.chunks], [c.index_text for c in self.chunks], self.tokenizer
        )
        self._terms = {c.chunk_id: set(self.tokenizer(c.index_text)) for c in self.chunks}

    @classmethod
    def from_store(cls, store: ChunkStore, embedder: Embedder, **kwargs) -> HybridRetriever:
        built_with = store.embedder_name()
        if built_with is not None and built_with != embedder.name:
            raise ValueError(
                f"index was built with {built_with!r} but the app is configured with "
                f"{embedder.name!r}; run `make ingest` again"
            )
        ids, matrix = store.vectors()
        return cls(store.chunks(), embedder, NumpyVectorIndex(ids, matrix), **kwargs)

    # ------------------------------------------------------------------ api
    def lexical_coverage(self, query: str, chunk_ids: Sequence[str]) -> float:
        terms = set(self.tokenizer(query))
        if not terms or not chunk_ids:
            return 0.0
        present: set[str] = set()
        for cid in chunk_ids:
            present |= self._terms.get(cid, set())
        total = sum(self.bm25.term_idf(t) for t in terms)
        hit = sum(self.bm25.term_idf(t) for t in terms if t in present)
        return hit / total if total else 0.0

    def search(self, query: str, k: int = 5, mode: Mode = "hybrid") -> RetrievalResult:
        if mode not in MODES:
            raise ValueError(f"unknown mode {mode!r}")
        timings: dict[str, float] = {}
        n_cand = max(k, self.candidate_k)
        lexical_query = self.expander.expand(query)  # glossary terms for BM25 only

        t0 = time.perf_counter()
        bm25_list = self.bm25.search(lexical_query, n_cand) if mode in ("bm25", "hybrid") else []
        timings["bm25"] = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        # Dense similarity is also an abstention signal, so compute it in every mode.
        dense_list = self.vector_index.search(self.embedder.embed_query(query), n_cand)
        dense_top = dense_list[0][1] if dense_list else 0.0
        timings["dense"] = (time.perf_counter() - t0) * 1000

        bm25_pos = {cid: (r, s) for r, (cid, s) in enumerate(bm25_list, start=1)}
        dense_pos = {cid: (r, s) for r, (cid, s) in enumerate(dense_list, start=1)}

        if mode == "bm25":
            ranked = bm25_list
        elif mode == "dense":
            ranked = dense_list
        else:
            ranked = reciprocal_rank_fusion(
                [[c for c, _ in bm25_list], [c for c, _ in dense_list]], k=self.rrf_k
            )

        hits: list[Hit] = []
        for rank, (cid, score) in enumerate(ranked[:k], start=1):
            b = bm25_pos.get(cid)
            d = dense_pos.get(cid)
            hits.append(
                Hit(
                    chunk=self.by_id[cid],
                    rank=rank,
                    score=float(score),
                    bm25_rank=b[0] if b else None,
                    bm25_score=b[1] if b else None,
                    dense_rank=d[0] if d else None,
                    dense_score=d[1] if d else None,
                )
            )
        signals = SupportSignals(
            dense_top=float(dense_top),
            lexical_coverage=self.lexical_coverage(
                lexical_query, [h.chunk.chunk_id for h in hits[:1]]
            ),
            bm25_top=float(bm25_list[0][1]) if bm25_list else 0.0,
        )
        return RetrievalResult(
            query=query, mode=mode, hits=hits, signals=signals, timings_ms=timings
        )
