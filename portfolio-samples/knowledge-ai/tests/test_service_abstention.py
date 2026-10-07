"""Abstention and citation-verification policy of the answer service."""

from knowledge_ai import ABSTAIN_MESSAGE
from knowledge_ai.answer.abstain import AbstentionPolicy
from knowledge_ai.answer.base import DraftCitation, ProviderAnswer, ProviderError
from knowledge_ai.retrieval.retriever import SupportSignals


class SpyProvider:
    """Records calls; returns a canned draft."""

    name = "spy"

    def __init__(self, draft: ProviderAnswer | None = None, error: Exception | None = None):
        self.draft = draft
        self.error = error
        self.calls = 0

    def answer(self, question, hits):
        self.calls += 1
        if self.error:
            raise self.error
        return self.draft


def test_policy_support_formula_and_threshold():
    policy = AbstentionPolicy(threshold=0.4, dense_weight=4.0, dense_floor=0.8)
    strong = SupportSignals(dense_top=0.90, lexical_coverage=0.30)
    weak = SupportSignals(dense_top=0.82, lexical_coverage=0.10)
    assert abs(policy.support(strong) - 0.70) < 1e-9
    assert not policy.should_abstain(strong)
    assert policy.should_abstain(weak)  # 0.10 + 4*0.02 = 0.18 < 0.4


def test_low_support_abstains_without_calling_the_provider(make_service):
    spy = SpyProvider(ProviderAnswer(True, "x", [DraftCitation(0, "x")]))
    svc = make_service(provider=spy, threshold=10.0)  # impossible bar → always gated
    result = svc.ask("社員食堂の営業時間は？")
    assert result.abstained
    assert result.answer == ABSTAIN_MESSAGE
    assert result.abstain_reason == "low_retrieval_support"
    assert result.provider == "gate"
    assert spy.calls == 0


def test_extractive_answer_cites_an_exact_span(service):
    result = service.ask("年次有給休暇は何日もらえますか？")
    assert not result.abstained
    assert result.citations, "an answer must carry at least one citation"
    c = result.citations[0]
    assert c.chunk_text[c.chunk_start : c.chunk_end] == c.quote
    doc = service.documents[c.doc_id]
    assert doc.text[c.doc_start : c.doc_end] == c.quote
    assert "10日" in result.answer
    assert "[1]" in result.answer


def test_unverifiable_quote_is_dropped_and_markers_renumbered(make_service, retriever):
    hits = retriever.search("在宅勤務手当はいくらですか", k=3).hits
    real = next(h for h in hits if "在宅勤務手当" in h.chunk.text)
    idx = hits.index(real)
    draft = ProviderAnswer(
        True,
        "在宅勤務手当は存在しない規定によると5万円です[1]。正しくは月額3,000円です[2]。",
        [
            DraftCitation(idx, "在宅勤務手当として5万円を支給する。"),  # hallucinated quote
            DraftCitation(idx, "在宅勤務手当として、月額3,000円を支給する。"),
        ],
    )
    svc = make_service(provider=SpyProvider(draft))
    result = svc.ask("在宅勤務手当はいくらですか")
    assert not result.abstained
    assert result.unverified_citations == 1
    assert [c.marker for c in result.citations] == [1]
    assert "[2]" not in result.answer and "[1]" in result.answer
    assert result.citations[0].quote.endswith("支給する。")


def test_answer_with_no_verified_citation_becomes_an_abstention(make_service):
    draft = ProviderAnswer(
        True, "全員に賞与100万円です[1]。", [DraftCitation(0, "全員に賞与100万円を支給する")]
    )
    result = make_service(provider=SpyProvider(draft)).ask("賞与はいくらですか")
    assert result.abstained
    assert result.abstain_reason == "no_verified_citation"
    assert result.answer == ABSTAIN_MESSAGE


def test_out_of_range_source_index_is_rejected(make_service):
    draft = ProviderAnswer(True, "x[1]", [DraftCitation(99, "副業を行う場合")])
    result = make_service(provider=SpyProvider(draft)).ask("副業はできますか")
    assert result.abstained and result.unverified_citations == 1


def test_provider_declining_is_an_abstention(make_service):
    draft = ProviderAnswer(False, ABSTAIN_MESSAGE, reason="llm_abstained")
    result = make_service(provider=SpyProvider(draft)).ask("副業はできますか")
    assert result.abstained and result.abstain_reason == "llm_abstained"


def test_provider_failure_falls_back_to_extractive(make_service, service):
    svc = make_service(provider=SpyProvider(error=ProviderError("boom")), fallback=service.provider)
    result = svc.ask("副業をする場合の手続きは？")
    assert result.degraded
    assert result.provider == "extractive"
    assert not result.abstained


def test_provider_failure_without_fallback_raises(make_service):
    import pytest

    svc = make_service(provider=SpyProvider(error=ProviderError("boom")))
    with pytest.raises(ProviderError):
        svc.ask("副業をする場合の手続きは？")
