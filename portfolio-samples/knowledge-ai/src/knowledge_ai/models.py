"""Core data types: documents, pages and chunks.

Offsets (``start``/``end``) are character offsets into ``Document.text``; a
chunk's ``text`` is always exactly ``document.text[start:end]``. This invariant
is what makes citations point at verifiable spans.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field


@dataclass(frozen=True)
class PageSpan:
    number: int  # 1-based page number as printed / as in the PDF viewer
    start: int
    end: int


@dataclass
class Document:
    doc_id: str
    title: str
    kind: str  # "pdf" | "markdown"
    text: str
    pages: list[PageSpan]
    source_path: str
    sha256: str
    source_url: str | None = None
    license: str | None = None
    attribution: str | None = None

    def page_at(self, offset: int) -> int | None:
        """Page number that contains character ``offset`` (None for page-less docs)."""
        for p in self.pages:
            if p.start <= offset < p.end:
                return p.number
        if self.pages and offset >= self.pages[-1].end:
            return self.pages[-1].number
        return None


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    ordinal: int
    kind: str  # "article" | "commentary" | "section" | "intro" | "reference"
    heading: str  # breadcrumb, e.g. "第５章 休暇等 > 第２３条（年次有給休暇）"
    text: str
    start: int
    end: int
    page_start: int | None = None
    page_end: int | None = None
    article: int | None = None
    variant: str | None = None
    content_hash: str = field(default="")

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = hashlib.sha256(self.text.encode("utf-8")).hexdigest()[:16]

    @property
    def index_text(self) -> str:
        """Text used for BM25 and embeddings: breadcrumb + body ("contextual header")."""
        return f"{self.heading}\n{self.text}" if self.heading else self.text
