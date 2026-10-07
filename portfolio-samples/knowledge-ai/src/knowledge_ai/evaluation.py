"""Evaluation primitives (pure functions; the runner lives in ``scripts/eval.py``).

Gold labels are *evidence quotes*, not chunk ids: each answerable question
lists one or more verbatim passages that answer it. A retrieved chunk is
relevant when it covers at least half of an evidence passage. This keeps the
evaluation set valid when the chunking strategy changes — the thing being
evaluated must not define its own ground truth.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from knowledge_ai.models import Chunk, Document
from knowledge_ai.text import MatchIndex, normalize_for_match


@dataclass
class QAItem:
    id: str
    question: str
    answerable: bool
    split: str
    category: str
    doc_id: str | None = None
    gold_ref: str | None = None
    evidence: list[str] = field(default_factory=list)
    answer: str = ""
    answer_aliases: list[str] = field(default_factory=list)
    note: str | None = None

    @property
    def answers(self) -> list[str]:
        return [self.answer, *self.answer_aliases] if self.answer else list(self.answer_aliases)


@dataclass(frozen=True)
class Span:
    doc_id: str
    start: int
    end: int


def load_qa(path: Path) -> list[QAItem]:
    items: list[QAItem] = []
    seen: set[str] = set()
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        raw = json.loads(line)
        item = QAItem(**raw)
        if item.id in seen:
            raise ValueError(f"{path}:{lineno}: duplicate id {item.id}")
        if item.answerable and not item.evidence:
            raise ValueError(f"{path}:{lineno}: answerable item {item.id} has no evidence")
        if item.split not in {"dev", "test"}:
            raise ValueError(f"{path}:{lineno}: split must be dev or test")
        seen.add(item.id)
        items.append(item)
    return items


def locate_evidence(item: QAItem, documents: dict[str, Document]) -> list[Span]:
    """All spans in the corpus where any of the item's evidence quotes occur.

    Raises ``ValueError`` if an evidence quote cannot be found verbatim — a
    broken gold label must fail loudly, not silently lower the scores.
    """
    docs = [documents[item.doc_id]] if item.doc_id else list(documents.values())
    spans: list[Span] = []
    for quote in item.evidence:
        found = [Span(d.doc_id, s, e) for d in docs for s, e in MatchIndex(d.text).find_all(quote)]
        if not found:
            raise ValueError(f"{item.id}: evidence not found in corpus: {quote[:40]}…")
        spans.extend(found)
    return spans


def _overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def relevant_chunks(
    spans: Sequence[Span], chunks: Iterable[Chunk], min_cover: float = 0.5
) -> set[str]:
    """Chunks that cover at least ``min_cover`` of some evidence span."""
    out: set[str] = set()
    for c in chunks:
        for sp in spans:
            if c.doc_id == sp.doc_id and _overlap(c.start, c.end, sp.start, sp.end) >= (
                min_cover * (sp.end - sp.start)
            ):
                out.add(c.chunk_id)
                break
    return out


def first_relevant_rank(ranked_ids: Sequence[str], relevant: set[str]) -> int | None:
    for rank, cid in enumerate(ranked_ids, start=1):
        if cid in relevant:
            return rank
    return None


def retrieval_metrics(
    ranks: Sequence[int | None], ks: Sequence[int] = (1, 3, 5), mrr_cutoff: int = 10
) -> dict[str, float]:
    """Recall@k (share of questions with a relevant chunk in the top k) and MRR@cutoff."""
    n = len(ranks)
    if n == 0:
        return {}
    out = {f"recall@{k}": sum(1 for r in ranks if r is not None and r <= k) / n for k in ks}
    out[f"mrr@{mrr_cutoff}"] = sum(1.0 / r for r in ranks if r is not None and r <= mrr_cutoff) / n
    return out


def abstention_metrics(
    pred_abstain: Sequence[bool], unanswerable: Sequence[bool]
) -> dict[str, float]:
    """Positive class = "should abstain". Precision: abstentions that were right.
    Recall: unanswerable questions that were caught."""
    tp = sum(p and u for p, u in zip(pred_abstain, unanswerable, strict=True))
    fp = sum(p and not u for p, u in zip(pred_abstain, unanswerable, strict=True))
    fn = sum((not p) and u for p, u in zip(pred_abstain, unanswerable, strict=True))
    tn = sum((not p) and (not u) for p, u in zip(pred_abstain, unanswerable, strict=True))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_abstention_rate": fp / (fp + tn) if fp + tn else 0.0,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


def auroc(scores: Sequence[float], labels: Sequence[bool]) -> float:
    """Probability that a random positive scores higher than a random negative (ties = 0.5)."""
    pos = [s for s, y in zip(scores, labels, strict=True) if y]
    neg = [s for s, y in zip(scores, labels, strict=True) if not y]
    if not pos or not neg:
        return math.nan
    wins = sum(1.0 if p > q else 0.5 if p == q else 0.0 for p in pos for q in neg)
    return wins / (len(pos) * len(neg))


def contains_answer(text: str, item: QAItem) -> bool:
    norm = normalize_for_match(text)
    return any(normalize_for_match(a) in norm for a in item.answers if a)


def citation_hits_evidence(
    cited: Iterable[tuple[str, int, int]], spans: Sequence[Span], min_overlap: int = 5
) -> bool:
    """True if any cited (doc_id, start, end) overlaps a gold evidence span."""
    for doc_id, s, e in cited:
        for sp in spans:
            if doc_id == sp.doc_id and _overlap(s, e, sp.start, sp.end) >= min(
                min_overlap, sp.end - sp.start
            ):
                return True
    return False
