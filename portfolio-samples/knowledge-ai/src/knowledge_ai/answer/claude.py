"""Claude answer provider (official ``anthropic`` Python SDK).

Default model: ``claude-haiku-4-5-20251001`` (fast, cheapest); set
``KAI_CLAUDE_MODEL=claude-sonnet-5-5`` for harder corpora. The response is
constrained with structured outputs (``output_config.format``) and then
validated with pydantic; citations are verified by the service afterwards.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from knowledge_ai import ABSTAIN_MESSAGE
from knowledge_ai.answer.base import DraftCitation, ProviderAnswer, ProviderError
from knowledge_ai.answer.prompts import ANSWER_SCHEMA, SYSTEM_PROMPT, build_user_message
from knowledge_ai.retrieval.retriever import Hit

log = logging.getLogger(__name__)

# USD per million tokens (input, output). Anthropic list prices, checked 2026-09.
# Used only to *estimate* cost from the token usage the API reports.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-5-5": (4.00, 20.00),
}


def price_for(model: str) -> tuple[float, float] | None:
    base = re.sub(r"-\d{8}$", "", model)  # strip a dated snapshot suffix
    return PRICES_PER_MTOK.get(base)


class _Citation(BaseModel):
    source_id: str
    quote: str


class _Answer(BaseModel):
    answerable: bool
    answer: str
    citations: list[_Citation]


class ClaudeProvider:
    name = "claude"

    def __init__(
        self,
        model: str,
        *,
        api_key: str | None = None,
        max_tokens: int = 1024,
        timeout: float = 30.0,
        titles: dict[str, str] | None = None,
        client: Any | None = None,
    ) -> None:
        self.model = model
        self.max_tokens = max_tokens
        self.titles = titles or {}
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=2)
        self.client = client

    def request_params(self, question: str, hits: Sequence[Hit]) -> dict[str, Any]:
        return {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": build_user_message(question, hits, self.titles)}
            ],
            "output_config": {"format": {"type": "json_schema", "schema": ANSWER_SCHEMA}},
        }

    def answer(self, question: str, hits: Sequence[Hit]) -> ProviderAnswer:
        import anthropic

        params = self.request_params(question, hits)
        try:
            response = self.client.messages.create(**params)
        except anthropic.RateLimitError as e:
            raise ProviderError("Claude API rate limit reached") from e
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Claude API error {e.status_code}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("could not reach the Claude API") from e

        usage = self._usage(response)
        stop = getattr(response, "stop_reason", None)
        if stop == "refusal":
            return ProviderAnswer(
                False, ABSTAIN_MESSAGE, model=self.model, usage=usage, reason="llm_refusal"
            )
        if stop == "max_tokens":
            raise ProviderError("Claude response was truncated (max_tokens)")

        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        parsed = self.parse(text)
        citations: list[DraftCitation] = []
        for c in parsed.citations:
            m = re.fullmatch(r"\s*S(\d+)\s*", c.source_id)
            if not m or not (1 <= int(m.group(1)) <= len(hits)):
                log.warning("dropping citation with unknown source id %r", c.source_id)
                citations.append(DraftCitation(source_index=-1, quote=c.quote))
                continue
            citations.append(DraftCitation(source_index=int(m.group(1)) - 1, quote=c.quote))
        return ProviderAnswer(
            answerable=parsed.answerable,
            text=parsed.answer if parsed.answerable else ABSTAIN_MESSAGE,
            citations=citations if parsed.answerable else [],
            model=getattr(response, "model", self.model),
            usage=usage,
            reason=None if parsed.answerable else "llm_abstained",
        )

    @staticmethod
    def parse(text: str) -> _Answer:
        try:
            return _Answer.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as e:
            raise ProviderError("Claude returned output that does not match the schema") from e

    def _usage(self, response: Any) -> dict[str, float] | None:
        u = getattr(response, "usage", None)
        if u is None:
            return None
        inp, out = int(u.input_tokens), int(u.output_tokens)
        usage: dict[str, float] = {"input_tokens": inp, "output_tokens": out}
        price = price_for(self.model)
        if price:
            usage["cost_usd"] = round(inp / 1e6 * price[0] + out / 1e6 * price[1], 6)
        return usage
