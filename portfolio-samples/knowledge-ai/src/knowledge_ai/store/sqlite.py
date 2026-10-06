"""SQLite implementation of :class:`~knowledge_ai.store.base.ChunkStore`.

One file holds documents (with their canonical text, so citations can be
re-rendered), chunks and float32 embedding blobs. Writes for one document are
a single transaction, so a crashed ingest never leaves half a document.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from knowledge_ai.models import Chunk, Document, PageSpan

SCHEMA_VERSION = "1"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_url TEXT,
  license TEXT,
  attribution TEXT,
  sha256 TEXT NOT NULL,
  text TEXT NOT NULL,
  pages_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  heading TEXT NOT NULL,
  article INTEGER,
  variant TEXT,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id, ordinal);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL
);
"""


class SQLiteStore:
    """``readonly=True`` is used by the API: the serving process can never modify
    the index, and the container can run with a read-only filesystem."""

    def __init__(self, path: Path | str, *, readonly: bool = False) -> None:
        self.path = Path(path)
        if readonly:
            uri = f"file:{self.path.resolve()}?mode=ro"
            self.conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            return
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(_SCHEMA)
        self._set_meta_if_missing("schema_version", SCHEMA_VERSION)

    # ----------------------------------------------------------------- meta
    def _set_meta_if_missing(self, key: str, value: str) -> None:
        self.conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", (key, value))
        self.conn.commit()

    def get_meta(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))

    def embedder_name(self) -> str | None:
        return self.get_meta("embedder")

    # ---------------------------------------------------------------- write
    def upsert_document(
        self, doc: Document, chunks: Sequence[Chunk], vectors: np.ndarray, embedder_name: str
    ) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("one vector per chunk is required")
        current = self.embedder_name()
        if current is not None and current != embedder_name:
            raise ValueError(
                f"index was built with embedder {current!r}; re-ingest with --rebuild "
                f"to switch to {embedder_name!r}"
            )
        now = datetime.now(UTC).isoformat(timespec="seconds")
        pages = json.dumps([[p.number, p.start, p.end] for p in doc.pages])
        with self.conn:  # one transaction per document
            self.conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc.doc_id,))
            self.conn.execute(
                "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    doc.doc_id,
                    doc.title,
                    doc.kind,
                    doc.source_path,
                    doc.source_url,
                    doc.license,
                    doc.attribution,
                    doc.sha256,
                    doc.text,
                    pages,
                    now,
                ),
            )
            self.conn.executemany(
                "INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        c.chunk_id,
                        c.doc_id,
                        c.ordinal,
                        c.kind,
                        c.heading,
                        c.article,
                        c.variant,
                        c.start,
                        c.end,
                        c.page_start,
                        c.page_end,
                        c.text,
                        c.content_hash,
                    )
                    for c in chunks
                ],
            )
            self.conn.executemany(
                "INSERT INTO embeddings VALUES (?,?,?)",
                [
                    (c.chunk_id, int(v.shape[0]), np.asarray(v, dtype=np.float32).tobytes())
                    for c, v in zip(chunks, vectors, strict=True)
                ],
            )
            self.conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('embedder', ?)", (embedder_name,)
            )

    def delete_missing(self, keep_doc_ids: set[str]) -> list[str]:
        existing = [r[0] for r in self.conn.execute("SELECT doc_id FROM documents")]
        gone = [d for d in existing if d not in keep_doc_ids]
        with self.conn:
            self.conn.executemany("DELETE FROM documents WHERE doc_id = ?", [(d,) for d in gone])
            self.conn.executemany(
                "DELETE FROM meta WHERE key = ?", [(f"fingerprint:{d}",) for d in gone]
            )
        return gone

    def clear(self) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM documents")
            self.conn.execute("DELETE FROM meta WHERE key = 'embedder' OR key LIKE 'fingerprint:%'")

    # ----------------------------------------------------------------- read
    def document_sha(self, doc_id: str) -> str | None:
        row = self.conn.execute(
            "SELECT sha256 FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        return row[0] if row else None

    @staticmethod
    def _row_to_doc(row: tuple) -> Document:
        (
            doc_id,
            title,
            kind,
            source_path,
            source_url,
            license_,
            attribution,
            sha,
            text,
            pages_json,
            _ingested,
        ) = row
        pages = [PageSpan(n, s, e) for n, s, e in json.loads(pages_json)]
        return Document(
            doc_id=doc_id,
            title=title,
            kind=kind,
            text=text,
            pages=pages,
            source_path=source_path,
            sha256=sha,
            source_url=source_url,
            license=license_,
            attribution=attribution,
        )

    def documents(self) -> list[Document]:
        rows = self.conn.execute("SELECT * FROM documents ORDER BY doc_id").fetchall()
        return [self._row_to_doc(r) for r in rows]

    def get_document(self, doc_id: str) -> Document | None:
        row = self.conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
        return self._row_to_doc(row) if row else None

    def chunks(self) -> list[Chunk]:
        rows = self.conn.execute(
            "SELECT chunk_id, doc_id, ordinal, kind, heading, article, variant, start_offset, "
            "end_offset, page_start, page_end, text, content_hash FROM chunks "
            "ORDER BY doc_id, ordinal"
        ).fetchall()
        return [
            Chunk(
                chunk_id=r[0],
                doc_id=r[1],
                ordinal=r[2],
                kind=r[3],
                heading=r[4],
                article=r[5],
                variant=r[6],
                start=r[7],
                end=r[8],
                page_start=r[9],
                page_end=r[10],
                text=r[11],
                content_hash=r[12],
            )
            for r in rows
        ]

    def vectors(self) -> tuple[list[str], np.ndarray]:
        rows = self.conn.execute(
            "SELECT e.chunk_id, e.dim, e.vector FROM embeddings e "
            "JOIN chunks c USING (chunk_id) ORDER BY c.doc_id, c.ordinal"
        ).fetchall()
        if not rows:
            return [], np.zeros((0, 0), dtype=np.float32)
        ids = [r[0] for r in rows]
        matrix = np.stack([np.frombuffer(r[2], dtype=np.float32, count=r[1]) for r in rows])
        return ids, matrix

    def close(self) -> None:
        self.conn.close()
