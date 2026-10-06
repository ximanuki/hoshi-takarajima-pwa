"""The question-answering pipeline: retrieve → gate (abstain?) → answer → verify citations.

Policy enforced here, independent of the provider:

* **No support, no LLM call.** If retrieval support is below the threshold the
  service answers 「資料に記載がありません」 without calling the provider.
* **No verified citation, no answer.** Every quote returned by a provider must
  occur verbatim (modulo whitespace/width) in the cited chunk. Unverifiable
  citations are dropped, their ``[n]`` markers removed, and an answer left
  with no verified citation is replaced by an abstention.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from knowledge_ai import ABSTAIN_MESSAGE
from knowledge_ai.answer.abstain import AbstentionPolicy
from knowledge_ai.answer.base import AnswerProvider, ProviderAnswer, ProviderError
from knowledge_ai.answer.extractive import ExtractiveProvider
from knowledge_ai.config import Settings
from knowledge_ai.models import Document
from knowledge_ai.retrieval.embeddings import build_embedder
from knowledge_ai.retrieval.glossary import QueryExpander
from knowledge_ai.retrieval.retriever import Hit, HybridRetriever, Mode, RetrievalResult
from knowledge_ai.schemas import AnswerResult, Citation, DocumentInfo, RetrievedChunk
from knowledge_ai.store.sqlite import SQLiteStore
from knowledge_ai.text import MatchIndex

log = logging.getLogger(__name__)

_MARKER = re.compile(r"[\[［]\s*(\d+)\s*[\]］]")


@dataclass
class Gate:
    retrieval: RetrievalResult
    support: float
    abstain: bool


class AnswerService:
    def __init__(
        self,
        retriever: HybridRetriever,
        provider: AnswerProvider,
        policy: AbstentionPolicy,
        documents: dict[str, Document],
        *,
        top_k: int = 5,
        fallback: AnswerProvider | None = None,
    ) -> None:
        self.retriever = retriever
        self.provider = provider
        self.policy = policy
        self.documents = documents
        self.top_k = top_k
        self.fallback = fallback

    # ---------------------------------------------------------------- build
    @classmethod
    def from_settings(cls, settings: Settings, provider: str | None = None) -> AnswerService:
        if not Path(settings.index_path).exists():
            raise FileNotFoundError(f"index not found: {settings.index_path} (run `make ingest`)")
        store = SQLiteStore(settings.index_path, readonly=True)
        embedder = build_embedder(
            settings.embedder,
            model=settings.embedding_model,
            revision=settings.embedding_revision,
            cache_dir=settings.model_cache_dir,
            threads=settings.embedding_threads,
        )
        expander = QueryExpander.from_file(
            settings.glossary_path if settings.use_glossary else None
        )
        retriever = HybridRetriever.from_store(
            store,
            embedder,
            rrf_k=settings.rrf_k,
            candidate_k=settings.candidate_k,
            expander=expander,
        )
        documents = {d.doc_id: d for d in store.documents()}
        store.close()
        if not retriever.chunks:
            raise RuntimeError(f"index is empty: {settings.index_path} (run `make ingest`)")
        extractive = ExtractiveProvider.for_retriever(retriever)
        chosen = make_provider(provider or settings.llm_provider, settings, documents, extractive)
        return cls(
            retriever,
            chosen,
            AbstentionPolicy(threshold=settings.abstain_threshold),
            documents,
            top_k=settings.top_k,
            fallback=extractive if chosen is not extractive else None,
        )

    # ------------------------------------------------------------------ api
    def gate(self, question: str, mode: Mode = "hybrid") -> Gate:
        result = self.retriever.search(question, k=self.top_k, mode=mode)
        support = self.policy.support(result.signals)
        return Gate(result, support, support < self.policy.threshold)

    def ask(
        self, question: str, mode: Mode = "hybrid", provider: AnswerProvider | None = None
    ) -> AnswerResult:
        provider = provider or self.provider
        t0 = time.perf_counter()
        gate = self.gate(question, mode)
        timings = {f"retrieve_{k}": round(v, 2) for k, v in gate.retrieval.timings_ms.items()}
        base = {
            "question": question,
            "support": round(gate.support, 4),
            "signals": gate.retrieval.signals.as_dict(),
            "retrieved": [self._retrieved(h) for h in gate.retrieval.hits],
        }
        if gate.abstain:
            timings["total"] = round((time.perf_counter() - t0) * 1000, 2)
            return AnswerResult(
                answer=ABSTAIN_MESSAGE,
                abstained=True,
                abstain_reason="low_retrieval_support",
                provider="gate",
                timings_ms=timings,
                **base,
            )

        hits = gate.retrieval.hits
        degraded = False
        t1 = time.perf_counter()
        try:
            draft = provider.answer(question, hits)
            used = provider
        except ProviderError as e:
            if self.fallback is None:
                raise
            log.warning("provider %s failed (%s); using %s", provider.name, e, self.fallback.name)
            draft = self.fallback.answer(question, hits)
            used, degraded = self.fallback, True
        timings["answer"] = round((time.perf_counter() - t1) * 1000, 2)

        text, citations, reason, unverified = self._finalize(draft, hits)
        timings["total"] = round((time.perf_counter() - t0) * 1000, 2)
        return AnswerResult(
            answer=text,
            abstained=reason is not None,
            abstain_reason=reason,
            citations=citations,
            unverified_citations=unverified,
            provider=used.name,
            model=draft.model,
            degraded=degraded,
            usage=draft.usage,
            timings_ms=timings,
            **base,
        )

    def document_infos(self) -> list[DocumentInfo]:
        counts: dict[str, int] = {}
        for c in self.retriever.chunks:
            counts[c.doc_id] = counts.get(c.doc_id, 0) + 1
        return [
            DocumentInfo(
                doc_id=d.doc_id,
                title=d.title,
                kind=d.kind,
                pages=len(d.pages) or None,
                chunks=counts.get(d.doc_id, 0),
                source_url=d.source_url,
                license=d.license,
                attribution=d.attribution,
            )
            for d in self.documents.values()
        ]

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _retrieved(h: Hit) -> RetrievedChunk:
        return RetrievedChunk(
            rank=h.rank,
            chunk_id=h.chunk.chunk_id,
            heading=h.chunk.heading,
            page_start=h.chunk.page_start,
            score=round(h.score, 5),
            bm25_rank=h.bm25_rank,
            dense_rank=h.dense_rank,
            dense_score=round(h.dense_score, 4) if h.dense_score is not None else None,
        )

    def verify_citations(
        self, draft: ProviderAnswer, hits: Sequence[Hit]
    ) -> tuple[list[Citation], dict[int, int]]:
        """Locate each draft quote in its chunk. Returns citations + old→new marker map."""
        citations: list[Citation] = []
        mapping: dict[int, int] = {}
        seen: dict[tuple[str, int, int], int] = {}
        for old, dc in enumerate(draft.citations, start=1):
            if not 0 <= dc.source_index < len(hits):
                continue
            chunk = hits[dc.source_index].chunk
            span = MatchIndex(chunk.text).find(dc.quote)
            if span is None:
                log.info("unverified quote dropped: %r", dc.quote[:80])
                continue
            s, e = span
            key = (chunk.chunk_id, s, e)
            if key in seen:
                mapping[old] = seen[key]
                continue
            doc = self.documents.get(chunk.doc_id)
            marker = len(citations) + 1
            seen[key] = marker
            mapping[old] = marker
            citations.append(
                Citation(
                    marker=marker,
                    chunk_id=chunk.chunk_id,
                    doc_id=chunk.doc_id,
                    doc_title=doc.title if doc else chunk.doc_id,
                    heading=chunk.heading,
                    page=doc.page_at(chunk.start + s) if doc else chunk.page_start,
                    quote=chunk.text[s:e],
                    doc_start=chunk.start + s,
                    doc_end=chunk.start + e,
                    chunk_text=chunk.text,
                    chunk_start=s,
                    chunk_end=e,
                    source_url=doc.source_url if doc else None,
                )
            )
        return citations, mapping

    def _finalize(
        self, draft: ProviderAnswer, hits: Sequence[Hit]
    ) -> tuple[str, list[Citation], str | None, int]:
        """Returns (answer text, verified citations, abstain reason or None, #unverified)."""
        if not draft.answerable:
            return ABSTAIN_MESSAGE, [], draft.reason or "provider_abstained", 0
        citations, mapping = self.verify_citations(draft, hits)
        unverified = len(draft.citations) - len(mapping)
        if not citations:
            return ABSTAIN_MESSAGE, [], "no_verified_citation", unverified

        def renumber(m: re.Match[str]) -> str:
            new = mapping.get(int(m.group(1)))
            return f"[{new}]" if new else ""

        text = _MARKER.sub(renumber, draft.text).strip()
        return text, citations, None, unverified


def make_provider(
    kind: str, settings: Settings, documents: dict[str, Document], extractive: ExtractiveProvider
) -> AnswerProvider:
    if kind == "auto":
        kind = "claude" if settings.anthropic_api_key else "extractive"
    if kind == "extractive":
        return extractive
    if kind == "claude":
        from knowledge_ai.answer.claude import ClaudeProvider

        if not settings.anthropic_api_key:
            raise ValueError("KAI_LLM_PROVIDER=claude requires ANTHROPIC_API_KEY")
        return ClaudeProvider(
            settings.claude_model,
            api_key=settings.anthropic_api_key,
            max_tokens=settings.claude_max_tokens,
            timeout=settings.claude_timeout_s,
            titles={d.doc_id: d.title for d in documents.values()},
        )
    raise ValueError(f"unknown provider {kind!r} (expected auto, claude or extractive)")
