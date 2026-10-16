import math

import pytest

from knowledge_ai.retrieval.bm25 import BM25Index
from knowledge_ai.retrieval.fusion import reciprocal_rank_fusion
from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer


def test_rrf_rewards_agreement_between_lists():
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "a", "d"]], k=60)
    ids = [i for i, _ in fused]
    assert set(ids[:2]) == {"a", "b"}
    assert ids[-1] in {"c", "d"}
    score = dict(fused)
    assert math.isclose(score["a"], 1 / 61 + 1 / 62)
    assert math.isclose(score["d"], 1 / 63)


def test_rrf_is_deterministic_on_ties():
    # a and b have identical scores; a reached rank 1 first → tie broken by best rank, then id
    fused = reciprocal_rank_fusion([["a", "b"], ["b", "a"]], k=60)
    assert [i for i, _ in fused] == ["a", "b"]


def test_rrf_weights_and_duplicates():
    fused = dict(reciprocal_rank_fusion([["a", "a", "b"], ["b"]], k=10, weights=[2.0, 1.0]))
    assert math.isclose(fused["a"], 2 / 11)  # duplicate "a" ignored
    assert math.isclose(fused["b"], 2 / 12 + 1 / 11)


def test_rrf_validates_arguments():
    with pytest.raises(ValueError):
        reciprocal_rank_fusion([["a"]], k=0)
    with pytest.raises(ValueError):
        reciprocal_rank_fusion([["a"], ["b"]], weights=[1.0])


def test_bm25_ranks_the_document_with_the_query_terms_first():
    docs = {
        "leave": "年次有給休暇は、６か月間継続勤務した労働者に与える。",
        "wage": "賃金は、毎月末日に締め切って翌月２５日に支払う。",
        "side": "労働者は、勤務時間外において副業に従事することができる。",
    }
    index = BM25Index(list(docs), list(docs.values()), CharNgramTokenizer(2))
    assert index.search("有給休暇は何日？", k=1)[0][0] == "leave"
    assert index.search("給料の支払日", k=1)[0][0] == "wage"
    assert index.search("社員食堂", k=3) == []  # no shared terms → nothing


def test_bm25_unknown_term_gets_max_idf():
    index = BM25Index(["a", "b"], ["賞与", "退職金"], CharNgramTokenizer(2))
    assert index.term_idf("食堂") == index.max_idf
    assert index.term_idf("賞与") < index.max_idf
