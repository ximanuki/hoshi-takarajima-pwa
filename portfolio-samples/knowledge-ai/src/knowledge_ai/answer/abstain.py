"""Retrieval-based abstention.

Before any answer is generated, the service asks: *does the corpus look like
it covers this question at all?* If not, it answers 「資料に記載がありません」
without calling the LLM — cheaper, faster, and it removes the most common
source of RAG hallucination (the model "helpfully" answering from general
knowledge when retrieval found nothing relevant).

The support score combines two signals from retrieval (see
:class:`~knowledge_ai.retrieval.retriever.SupportSignals`):

``support = lexical_coverage + dense_weight * (dense_top - dense_floor)``

* ``lexical_coverage`` (0–1) drops when the question's distinctive terms
  appear nowhere near the top hit;
* ``dense_top`` (e5 cosine) catches paraphrases that share few characters.

The weights and the threshold are tuned on the *dev* split of the evaluation
set only, and the report shows the full precision/recall trade-off.
"""

from __future__ import annotations

from dataclasses import dataclass

from knowledge_ai.retrieval.retriever import SupportSignals


@dataclass(frozen=True)
class AbstentionPolicy:
    # dense_weight was chosen by AUROC on the dev split (candidates 1, 2, 4, 8);
    # dense_floor only shifts the scale. threshold comes from Settings.
    threshold: float = 0.40
    dense_weight: float = 4.0
    dense_floor: float = 0.80

    def support(self, s: SupportSignals) -> float:
        return s.lexical_coverage + self.dense_weight * (s.dense_top - self.dense_floor)

    def should_abstain(self, s: SupportSignals) -> bool:
        return self.support(s) < self.threshold
