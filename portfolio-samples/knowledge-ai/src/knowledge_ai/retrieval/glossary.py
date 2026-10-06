"""Query expansion from a small, editable glossary (社員の言い方 → 規程の用語).

Employees ask about 「残業」「有給」「給料」「天引き」; rules say 時間外労働,
年次有給休暇, 賃金, 控除. Character bigrams cannot bridge that gap, so the BM25
query is expanded with the formal terms. The dense retriever gets the original
query (e5 already handles many paraphrases). The eval report measures the
effect (with vs. without glossary) instead of assuming it helps.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).lower()


class QueryExpander:
    def __init__(self, mapping: dict[str, list[str]] | None = None) -> None:
        self.mapping = {
            _norm(k): list(v)
            for k, v in (mapping or {}).items()
            if not k.startswith("_") and isinstance(v, list)
        }

    @classmethod
    def from_file(cls, path: Path | None) -> QueryExpander:
        if path is None or not Path(path).exists():
            return cls({})
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def __len__(self) -> int:
        return len(self.mapping)

    def expansions(self, query: str) -> list[str]:
        q = _norm(query)
        out: list[str] = []
        for key, terms in self.mapping.items():
            if key in q:
                out.extend(t for t in terms if _norm(t) not in q and t not in out)
        return out

    def expand(self, query: str) -> str:
        extra = self.expansions(query)
        return f"{query} {' '.join(extra)}" if extra else query
