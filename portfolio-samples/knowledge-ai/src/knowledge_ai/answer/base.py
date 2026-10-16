"""Answer-provider interface.

A provider receives the question and the retrieved hits and returns a
*draft*: answer text with ``[n]`` markers and citations given as
``(source index, verbatim quote)``. The service — not the provider — verifies
every quote against the source text and computes exact offsets, so an LLM can
never cite something that is not in the documents.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from knowledge_ai.retrieval.retriever import Hit


@dataclass
class DraftCitation:
    source_index: int  # 0-based index into the hits passed to the provider
    quote: str


@dataclass
class ProviderAnswer:
    answerable: bool
    text: str
    citations: list[DraftCitation] = field(default_factory=list)
    model: str | None = None
    usage: dict[str, float] | None = None
    reason: str | None = None  # why the provider declined, if it did


class ProviderError(RuntimeError):
    """The provider could not produce an answer (network, quota, malformed output…)."""


class AnswerProvider(Protocol):
    name: str

    def answer(self, question: str, hits: Sequence[Hit]) -> ProviderAnswer: ...
