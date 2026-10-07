"""Ingestion: files in ``data/raw`` → documents → chunks → embeddings → SQLite.

Re-running is incremental: a document is re-processed only when its
fingerprint (file hash + manifest metadata + chunker settings + embedder)
changes. Documents whose files were removed are deleted from the index.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from knowledge_ai.ingest.chunker import CHUNKER_VERSION, chunk_document
from knowledge_ai.ingest.loaders import discover, load_document, load_manifest
from knowledge_ai.retrieval.embeddings import Embedder
from knowledge_ai.store.sqlite import SQLiteStore

log = logging.getLogger(__name__)


@dataclass
class IngestReport:
    ingested: list[tuple[str, int]] = field(default_factory=list)  # (doc_id, n_chunks)
    skipped: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    seconds: float = 0.0


def _fingerprint(file_sha: str, meta: dict, max_chars: int, embedder: str) -> str:
    payload = json.dumps(
        [file_sha, meta, max_chars, embedder, CHUNKER_VERSION], sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def ingest_directory(
    raw_dir: Path,
    store: SQLiteStore,
    embedder: Embedder,
    *,
    max_chars: int = 600,
    force: bool = False,
) -> IngestReport:
    t0 = time.perf_counter()
    report = IngestReport()
    if force:
        store.clear()
    manifest = load_manifest(raw_dir)
    keep: set[str] = set()
    for path in discover(raw_dir):
        meta = manifest.get(path.name, {})
        doc = load_document(path, meta)
        if doc.doc_id in keep:
            raise ValueError(f"duplicate doc_id {doc.doc_id!r} ({path.name})")
        keep.add(doc.doc_id)
        fp = _fingerprint(doc.sha256, meta, max_chars, embedder.name)
        if store.get_meta(f"fingerprint:{doc.doc_id}") == fp:
            report.skipped.append(doc.doc_id)
            continue
        chunks = chunk_document(doc, max_chars=max_chars)
        log.info("embedding %d chunks of %s", len(chunks), doc.doc_id)
        vectors = embedder.embed_documents([c.index_text for c in chunks])
        store.upsert_document(doc, chunks, vectors, embedder.name)
        store.set_meta(f"fingerprint:{doc.doc_id}", fp)
        report.ingested.append((doc.doc_id, len(chunks)))
    report.removed = store.delete_missing(keep)
    report.seconds = time.perf_counter() - t0
    return report
