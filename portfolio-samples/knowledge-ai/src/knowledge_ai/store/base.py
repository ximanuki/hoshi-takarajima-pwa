"""Storage interfaces.

The app depends only on these two protocols. Today they are implemented by
:class:`~knowledge_ai.store.sqlite.SQLiteStore` (documents, chunks and vectors
in one SQLite file) and :class:`NumpyVectorIndex` (exact cosine search in
memory), which is the right trade-off up to roughly 10^5 chunks.

**pgvector seam.** A Postgres implementation would provide the same methods:
``ChunkStore`` maps 1:1 onto ``documents``/``chunks`` tables, and
``VectorIndex.search`` becomes
``SELECT chunk_id, 1 - (embedding <=> %s) FROM chunks ORDER BY embedding <=> %s LIMIT %s``
with an HNSW index. Nothing above this module would change.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

import numpy as np

from knowledge_ai.models import Chunk, Document


class ChunkStore(Protocol):
    def upsert_document(
        self, doc: Document, chunks: Sequence[Chunk], vectors: np.ndarray, embedder_name: str
    ) -> None: ...

    def document_sha(self, doc_id: str) -> str | None: ...

    def documents(self) -> list[Document]: ...

    def get_document(self, doc_id: str) -> Document | None: ...

    def chunks(self) -> list[Chunk]: ...

    def vectors(self) -> tuple[list[str], np.ndarray]: ...

    def embedder_name(self) -> str | None: ...

    def delete_missing(self, keep_doc_ids: set[str]) -> list[str]: ...


class VectorIndex(Protocol):
    def search(self, query: np.ndarray, k: int) -> list[tuple[str, float]]: ...


class NumpyVectorIndex:
    """Exact cosine similarity over L2-normalised vectors (a single mat-vec)."""

    def __init__(self, ids: Sequence[str], matrix: np.ndarray) -> None:
        if len(ids) != matrix.shape[0]:
            raise ValueError("ids and matrix rows differ")
        self.ids = list(ids)
        self.matrix = matrix.astype(np.float32, copy=False)

    def __len__(self) -> int:
        return len(self.ids)

    def search(self, query: np.ndarray, k: int) -> list[tuple[str, float]]:
        if not self.ids:
            return []
        sims = self.matrix @ query.astype(np.float32)
        k = min(k, len(self.ids))
        top = np.argpartition(-sims, k - 1)[:k]
        top = top[np.lexsort((top, -sims[top]))]  # by score desc, then index (deterministic)
        return [(self.ids[i], float(sims[i])) for i in top]
