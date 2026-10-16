"""Public response models (shared by the service, the API and the CLI)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Citation(BaseModel):
    marker: int = Field(description="Number used in the answer text, e.g. [1]")
    chunk_id: str
    doc_id: str
    doc_title: str
    heading: str
    page: int | None = Field(description="Page of the quoted span (None for page-less docs)")
    quote: str = Field(description="Exact quoted span from the source text")
    doc_start: int = Field(description="Character offset of the quote in the document text")
    doc_end: int
    chunk_text: str = Field(description="Full text of the cited chunk, for context")
    chunk_start: int = Field(description="Quote offset inside chunk_text (for highlighting)")
    chunk_end: int
    source_url: str | None = None


class RetrievedChunk(BaseModel):
    rank: int
    chunk_id: str
    heading: str
    page_start: int | None
    score: float
    bm25_rank: int | None
    dense_rank: int | None
    dense_score: float | None


class AnswerResult(BaseModel):
    question: str
    answer: str
    abstained: bool
    abstain_reason: str | None = None
    citations: list[Citation] = []
    unverified_citations: int = Field(
        default=0, description="Citations returned by the provider that failed verification"
    )
    provider: str
    model: str | None = None
    degraded: bool = Field(
        default=False, description="True if the LLM failed and the extractive fallback answered"
    )
    support: float = Field(description="Retrieval support score used for abstention")
    signals: dict[str, float] = {}
    retrieved: list[RetrievedChunk] = []
    usage: dict[str, float] | None = None
    timings_ms: dict[str, float] = {}


class DocumentInfo(BaseModel):
    doc_id: str
    title: str
    kind: str
    pages: int | None
    chunks: int
    source_url: str | None
    license: str | None
    attribution: str | None
