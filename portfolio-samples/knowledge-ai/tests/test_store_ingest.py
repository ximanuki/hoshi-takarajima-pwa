import shutil

import numpy as np
import pytest

from knowledge_ai.ingest.pipeline import ingest_directory
from knowledge_ai.retrieval.embeddings import HashingEmbedder
from knowledge_ai.store.base import NumpyVectorIndex
from knowledge_ai.store.sqlite import SQLiteStore


def test_roundtrip_and_incremental_ingest(tmp_path, raw_dir):
    store = SQLiteStore(tmp_path / "i.sqlite")
    emb = HashingEmbedder()
    first = ingest_directory(raw_dir, store, emb, max_chars=300)
    assert first.ingested and not first.skipped
    n_chunks = first.ingested[0][1]

    chunks = store.chunks()
    ids, matrix = store.vectors()
    assert len(chunks) == n_chunks == len(ids) == matrix.shape[0]
    assert matrix.dtype == np.float32
    doc = store.get_document("test-rules")
    assert doc is not None and doc.title == "テスト用就業規則"
    assert all(doc.text[c.start : c.end] == c.text for c in chunks)

    # unchanged files are skipped; chunk ids are stable
    second = ingest_directory(raw_dir, store, emb, max_chars=300)
    assert second.skipped == ["test-rules"] and not second.ingested
    assert [c.chunk_id for c in store.chunks()] == [c.chunk_id for c in chunks]

    # a changed chunking parameter forces re-processing
    third = ingest_directory(raw_dir, store, emb, max_chars=200)
    assert third.ingested


def test_removed_files_are_deleted_from_the_index(tmp_path, raw_dir):
    store = SQLiteStore(tmp_path / "i.sqlite")
    shutil.copy(raw_dir / "sample_rules.md", raw_dir / "second.md")
    ingest_directory(raw_dir, store, HashingEmbedder())
    assert {d.doc_id for d in store.documents()} == {"test-rules", "second"}
    (raw_dir / "second.md").unlink()
    report = ingest_directory(raw_dir, store, HashingEmbedder())
    assert report.removed == ["second"]
    assert all(c.doc_id == "test-rules" for c in store.chunks())


def test_switching_embedder_requires_rebuild(tmp_path, raw_dir):
    store = SQLiteStore(tmp_path / "i.sqlite")
    ingest_directory(raw_dir, store, HashingEmbedder(dim=256))
    with pytest.raises(ValueError, match="re-ingest"):
        ingest_directory(raw_dir, store, HashingEmbedder(dim=128))
    report = ingest_directory(raw_dir, store, HashingEmbedder(dim=128), force=True)
    assert report.ingested


def test_numpy_vector_index_orders_by_cosine():
    m = np.array([[1, 0], [0.6, 0.8], [0, 1]], dtype=np.float32)
    index = NumpyVectorIndex(["a", "b", "c"], m)
    res = index.search(np.array([0, 1], dtype=np.float32), k=2)
    assert [i for i, _ in res] == ["c", "b"]
    assert res[0][1] == pytest.approx(1.0)
    assert NumpyVectorIndex([], np.zeros((0, 2), np.float32)).search(np.ones(2), 3) == []
