"""Shared fixtures. Everything here runs offline: the HashingEmbedder replaces
the real e5 model, so the unit suite never downloads anything."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from knowledge_ai.answer.abstain import AbstentionPolicy
from knowledge_ai.answer.extractive import ExtractiveProvider
from knowledge_ai.config import PROJECT_ROOT, Settings
from knowledge_ai.ingest.pipeline import ingest_directory
from knowledge_ai.retrieval.embeddings import HashingEmbedder
from knowledge_ai.retrieval.retriever import HybridRetriever
from knowledge_ai.service import AnswerService
from knowledge_ai.store.sqlite import SQLiteStore

FIXTURES = Path(__file__).parent / "fixtures"
RAW_DIR = PROJECT_ROOT / "data" / "raw"
MODEL_PDF = RAW_DIR / "mhlw_model_shugyo_kisoku_r0712.pdf"


@pytest.fixture
def raw_dir(tmp_path: Path) -> Path:
    d = tmp_path / "raw"
    d.mkdir()
    shutil.copy(FIXTURES / "sample_rules.md", d / "sample_rules.md")
    (d / "manifest.json").write_text(
        '{"sample_rules.md": {"doc_id": "test-rules", "title": "テスト用就業規則",'
        ' "source_url": "https://example.invalid/rules", "license": "test",'
        ' "attribution": "テスト用"}}',
        encoding="utf-8",
    )
    return d


@pytest.fixture
def index_path(tmp_path: Path, raw_dir: Path) -> Path:
    path = tmp_path / "index.sqlite"
    store = SQLiteStore(path)
    ingest_directory(raw_dir, store, HashingEmbedder(), max_chars=300)
    store.close()
    return path


@pytest.fixture
def settings(tmp_path: Path, raw_dir: Path, index_path: Path) -> Settings:
    return Settings(
        raw_dir=raw_dir,
        index_path=index_path,
        model_cache_dir=tmp_path / "models",
        embedder="hashing",
        glossary_path=FIXTURES / "missing-glossary.json",
        llm_provider="extractive",
        # the hashing embedder's cosine scale differs from e5's, so the retrieval
        # gate is disabled here; tests that exercise the gate set their own policy
        abstain_threshold=-1e9,
        rate_limit_per_minute=1000,
        per_ip_daily_cap=1000,
        daily_cap=1000,
    )


@pytest.fixture
def service(settings: Settings) -> AnswerService:
    return AnswerService.from_settings(settings)


@pytest.fixture
def retriever(service: AnswerService) -> HybridRetriever:
    return service.retriever


@pytest.fixture
def make_service(service: AnswerService):
    """Build an AnswerService over the fixture index with a custom provider/policy."""

    def _make(provider=None, threshold: float = 0.0, fallback=None) -> AnswerService:
        retriever = service.retriever
        extractive = ExtractiveProvider.for_retriever(retriever)
        return AnswerService(
            retriever,
            provider or extractive,
            AbstentionPolicy(threshold=threshold, dense_weight=0.0),
            service.documents,
            top_k=3,
            fallback=fallback,
        )

    return _make
