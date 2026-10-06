"""Extractive answering — no LLM, no API key.

Picks the sentence(s) in the top retrieved chunks that best cover the
question's terms (IDF-weighted) and returns them verbatim with citations.
It cannot synthesise or reason, but every word it returns is a quote, which
makes it a useful baseline, an offline demo mode and a fallback when the LLM
is unavailable.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from knowledge_ai import ABSTAIN_MESSAGE
from knowledge_ai.answer.base import DraftCitation, ProviderAnswer
from knowledge_ai.retrieval.retriever import Hit, HybridRetriever
from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer
from knowledge_ai.text import display_text, split_units

_HEADING_ONLY = re.compile(r"^[\s　]*[【（(\[［〔][^。]{0,60}[】）)\]］〕][\s　]*$")


class ExtractiveProvider:
    name = "extractive"

    def __init__(
        self,
        idf: Callable[[str], float],
        tokenizer: CharNgramTokenizer | None = None,
        *,
        known: Callable[[str], bool] | None = None,
        expand: Callable[[str], str] | None = None,
        max_hits: int = 3,
        max_sentences: int = 2,
        min_coverage: float = 0.1,
        rank_decay: float = 0.1,
    ) -> None:
        self.idf = idf
        # Only terms that occur in the corpus can be matched by a sentence; unknown
        # terms are handled by the retrieval gate, not by sentence selection.
        self.known = known or (lambda _t: True)
        self.expand = expand or (lambda q: q)
        self.tokenizer = tokenizer or CharNgramTokenizer(2)
        self.max_hits = max_hits
        self.max_sentences = max_sentences
        self.min_coverage = min_coverage
        self.rank_decay = rank_decay

    @classmethod
    def for_retriever(cls, retriever: HybridRetriever, **kwargs) -> ExtractiveProvider:
        return cls(
            idf=retriever.bm25.term_idf,
            tokenizer=retriever.tokenizer,
            known=lambda t: t in retriever.bm25.idf,
            expand=retriever.expander.expand,
            **kwargs,
        )

    def _coverage(self, q_terms: set[str], text: str) -> float:
        total = sum(self.idf(t) for t in q_terms)
        if not total:
            return 0.0
        u_terms = set(self.tokenizer(text))
        return sum(self.idf(t) for t in q_terms if t in u_terms) / total

    def answer(self, question: str, hits: Sequence[Hit]) -> ProviderAnswer:
        q_terms = {t for t in self.tokenizer(self.expand(question)) if self.known(t)}
        candidates: list[tuple[float, int, int, int]] = []  # (score, hit_idx, start, end)
        for hi, hit in enumerate(hits[: self.max_hits]):
            text = hit.chunk.text
            for s, e in split_units(text):
                unit = text[s:e]
                if len(unit.strip()) < 8 or _HEADING_ONLY.match(unit):
                    continue
                cov = self._coverage(q_terms, unit)
                score = cov * (1.0 - self.rank_decay * hi)
                candidates.append((score, hi, s, e))
        if not candidates:
            return ProviderAnswer(False, ABSTAIN_MESSAGE, reason="no_candidate_sentence")
        candidates.sort(key=lambda c: (-c[0], c[1], c[2]))
        best = candidates[0]
        if best[0] < self.min_coverage:
            return ProviderAnswer(False, ABSTAIN_MESSAGE, reason="low_sentence_coverage")

        chosen = [best]
        for cand in candidates[1:]:
            if len(chosen) >= self.max_sentences:
                break
            if cand[0] >= 0.75 * best[0] and all(
                not (cand[1] == c[1] and cand[2] < c[3] and c[2] < cand[3]) for c in chosen
            ):
                chosen.append(cand)
        # present in document order within each hit, best hit first
        chosen.sort(key=lambda c: (c[1] != best[1], c[1], c[2]))

        parts: list[str] = []
        citations: list[DraftCitation] = []
        for n, (_score, hi, s, e) in enumerate(chosen, start=1):
            quote = hits[hi].chunk.text[s:e]
            citations.append(DraftCitation(source_index=hi, quote=quote))
            parts.append(f"「{display_text(quote)}」[{n}]")
        text = "資料には次のように記載されています。" + "".join(parts)
        return ProviderAnswer(True, text, citations, model=None)
