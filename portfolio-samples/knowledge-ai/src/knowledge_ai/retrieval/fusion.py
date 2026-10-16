"""Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009).

RRF combines ranked lists using ranks only: ``score(d) = Σ_i w_i / (k + rank_i(d))``.
BM25 scores are unbounded and e5 cosine similarities live in a narrow band
(≈0.75–0.92), so score-level fusion would need per-corpus calibration; rank
fusion needs none, which is why it is the default here.
"""

from __future__ import annotations

from collections.abc import Sequence


def reciprocal_rank_fusion(
    rankings: Sequence[Sequence[str]],
    k: int = 60,
    weights: Sequence[float] | None = None,
) -> list[tuple[str, float]]:
    """Fuse ranked id lists. Returns ``(id, score)`` sorted by score desc.

    Ties are broken by the best (lowest) rank the item reached in any list,
    then by id, so the output is deterministic.
    """
    if k <= 0:
        raise ValueError("k must be positive")
    if weights is None:
        weights = [1.0] * len(rankings)
    if len(weights) != len(rankings):
        raise ValueError("one weight per ranking is required")
    scores: dict[str, float] = {}
    best_rank: dict[str, int] = {}
    for ranking, w in zip(rankings, weights, strict=True):
        unique = list(dict.fromkeys(ranking))  # a repeated id keeps its first rank only
        for rank, item in enumerate(unique, start=1):
            scores[item] = scores.get(item, 0.0) + w / (k + rank)
            best_rank[item] = min(best_rank.get(item, rank), rank)
    return sorted(scores.items(), key=lambda kv: (-kv[1], best_rank[kv[0]], kv[0]))
