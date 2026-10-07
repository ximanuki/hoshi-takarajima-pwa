"""Runtime configuration, read from environment variables (prefix ``KAI_``).

Everything has a safe default so that the app, tests and eval run with no
configuration and no API key.
"""

from __future__ import annotations

import os
from dataclasses import MISSING, dataclass, fields
from pathlib import Path
from typing import Any

# KAI_HOME lets a non-editable install (e.g. Docker) point at the project folder.
PROJECT_ROOT = Path(os.environ.get("KAI_HOME") or Path(__file__).resolve().parents[2])

# Pinned embedding model (Hugging Face repo + exact commit) — see README "Design decisions".
DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
DEFAULT_EMBEDDING_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"

DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001"


def _env(name: str, default: Any) -> Any:
    raw = os.environ.get(f"KAI_{name.upper()}")
    if raw is None:
        return default
    if isinstance(default, bool):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    if isinstance(default, Path):
        return Path(raw)
    return raw


@dataclass(frozen=True)
class Settings:
    # --- paths -------------------------------------------------------------
    raw_dir: Path = PROJECT_ROOT / "data" / "raw"
    index_path: Path = PROJECT_ROOT / "var" / "index.sqlite"
    model_cache_dir: Path = PROJECT_ROOT / "models"

    # --- embeddings ---------------------------------------------------------
    # "fastembed" (real multilingual-e5-small, CPU/ONNX) or "hashing"
    # (deterministic, dependency-free; used by unit tests only).
    embedder: str = "fastembed"
    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    embedding_revision: str = DEFAULT_EMBEDDING_REVISION
    embedding_threads: int = 0  # 0 = let onnxruntime decide

    # --- chunking -----------------------------------------------------------
    chunk_max_chars: int = 600

    # --- retrieval ----------------------------------------------------------
    glossary_path: Path = PROJECT_ROOT / "data" / "glossary.json"
    use_glossary: bool = True
    top_k: int = 5
    candidate_k: int = 30
    rrf_k: int = 60

    # --- abstention ---------------------------------------------------------
    # Abstain when the retrieval support score is below this threshold.
    # Chosen on the *dev* split of data/eval/qa.jsonl (see reports/).
    abstain_threshold: float = 0.40

    # --- answering ----------------------------------------------------------
    # "auto" = Claude when ANTHROPIC_API_KEY is set, otherwise extractive.
    llm_provider: str = "auto"
    claude_model: str = DEFAULT_CLAUDE_MODEL
    claude_max_tokens: int = 1024
    claude_timeout_s: float = 30.0

    # --- public demo guard rails -------------------------------------------
    max_question_chars: int = 300
    rate_limit_per_minute: int = 10
    per_ip_daily_cap: int = 100
    daily_cap: int = 1000  # all clients combined (protects the LLM bill)
    trust_proxy_headers: bool = False
    timezone: str = "Asia/Tokyo"

    @classmethod
    def from_env(cls, **overrides: Any) -> Settings:
        values: dict[str, Any] = {}
        for f in fields(cls):
            if f.default is not MISSING:
                values[f.name] = _env(f.name, f.default)
        values.update(overrides)
        return cls(**values)

    @property
    def anthropic_api_key(self) -> str | None:
        return os.environ.get("ANTHROPIC_API_KEY") or None
