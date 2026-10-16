"""Evaluation metrics and the integrity of data/eval/qa.jsonl."""

import math
from collections import Counter
from pathlib import Path

import pytest

from knowledge_ai.evaluation import (
    QAItem,
    Span,
    abstention_metrics,
    auroc,
    citation_hits_evidence,
    contains_answer,
    first_relevant_rank,
    load_qa,
    locate_evidence,
    relevant_chunks,
    retrieval_metrics,
)
from knowledge_ai.ingest.loaders import discover, load_document, load_manifest
from knowledge_ai.models import Chunk

ROOT = Path(__file__).parents[1]
QA = ROOT / "data" / "eval" / "qa.jsonl"


def test_retrieval_metrics():
    m = retrieval_metrics([1, 2, None, 6])
    assert m["recall@1"] == 0.25
    assert m["recall@3"] == 0.5
    assert m["recall@5"] == 0.5
    assert math.isclose(m["mrr@10"], (1 + 0.5 + 1 / 6) / 4)
    assert first_relevant_rank(["a", "b", "c"], {"c"}) == 3
    assert first_relevant_rank(["a"], set()) is None


def test_abstention_metrics_positive_class_is_should_abstain():
    m = abstention_metrics(
        pred_abstain=[True, True, False, False], unanswerable=[True, False, True, False]
    )
    assert (m["tp"], m["fp"], m["fn"], m["tn"]) == (1, 1, 1, 1)
    assert m["precision"] == 0.5 and m["recall"] == 0.5
    assert m["false_abstention_rate"] == 0.5


def test_auroc():
    assert auroc([0.9, 0.8, 0.1, 0.2], [True, True, False, False]) == 1.0
    assert auroc([0.5, 0.5], [True, False]) == 0.5
    assert math.isnan(auroc([0.1], [True]))


def test_relevance_requires_half_of_the_evidence():
    chunks = [
        Chunk("d#a", "d", 0, "article", "", "x" * 100, 0, 100),
        Chunk("d#b", "d", 1, "article", "", "x" * 100, 100, 200),
    ]
    assert relevant_chunks([Span("d", 90, 130)], chunks) == {"d#b"}  # 30 of 40 chars in b
    assert relevant_chunks([Span("d", 80, 120)], chunks) == {"d#a", "d#b"}  # exactly half each
    assert relevant_chunks([Span("other", 0, 10)], chunks) == set()


def test_contains_answer_and_citation_overlap():
    item = QAItem("q", "?", True, "dev", "rule", answer="１０日", answer_aliases=["十日"])
    assert contains_answer("有給は10日です", item)
    assert not contains_answer("有給は11日です", item)
    assert citation_hits_evidence([("d", 10, 30)], [Span("d", 25, 60)])
    assert not citation_hits_evidence([("d", 10, 30)], [Span("d", 29, 60)])


# ------------------------------------------------------------- dataset integrity
@pytest.fixture(scope="module")
def corpus():
    raw = ROOT / "data" / "raw"
    manifest = load_manifest(raw)
    docs = [load_document(p, manifest.get(p.name)) for p in discover(raw)]
    return {d.doc_id: d for d in docs}


def test_dataset_shape():
    items = load_qa(QA)
    assert 60 <= len(items) <= 100
    unanswerable = [i for i in items if not i.answerable]
    assert len(unanswerable) >= 15
    splits = Counter(i.split for i in items)
    assert abs(splits["dev"] - splits["test"]) <= 2
    for i in items:
        if i.answerable:
            assert i.answer and i.gold_ref and i.doc_id
        else:
            assert i.evidence == []


def test_every_gold_evidence_quote_exists_verbatim(corpus):
    for item in load_qa(QA):
        if item.answerable:
            spans = locate_evidence(item, corpus)  # raises if a quote is missing
            assert spans and all(s.doc_id == item.doc_id for s in spans)


def test_unanswerable_questions_mention_nothing_the_corpus_answers(corpus):
    # guard against "unanswerable" items that are actually answered verbatim
    text = "".join(d.text for d in corpus.values())
    for word in ["社員食堂", "駐車場", "制服", "社員旅行", "誕生日", "忘年会", "ペット"]:
        assert word not in text
