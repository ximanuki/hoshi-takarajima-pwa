"""Dense text embeddings.

``E5Embedder`` runs ``intfloat/multilingual-e5-small`` (MIT licence, 118M
params, 384-d) on CPU through fastembed/ONNX Runtime — no PyTorch. The model is
downloaded once from Hugging Face at a pinned commit.

``HashingEmbedder`` is a deterministic, dependency-free stand-in used by unit
tests so that the test suite never downloads a model.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
from collections.abc import Sequence
from pathlib import Path
from typing import ClassVar, Protocol

import numpy as np

from knowledge_ai.retrieval.tokenizer import CharNgramTokenizer

log = logging.getLogger(__name__)
# huggingface_hub reads this at import time; keep CLI/server logs free of progress bars.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")


class Embedder(Protocol):
    name: str
    dim: int

    def embed_documents(self, texts: Sequence[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


def _l2_normalize(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=-1, keepdims=True)
    norms[norms == 0] = 1.0
    return (m / norms).astype(np.float32)


class HashingEmbedder:
    """Feature-hashed character bigrams → L2-normalised vector (tests only)."""

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim
        self.name = f"hashing-bigram-{dim}"
        self._tok = CharNgramTokenizer(2)

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for tok in self._tok(text):
            h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "little")
            v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        return v

    def embed_documents(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        return _l2_normalize(np.stack([self._vec(t) for t in texts]))

    def embed_query(self, text: str) -> np.ndarray:
        return _l2_normalize(self._vec(text)[None, :])[0]


class E5Embedder:
    """multilingual-e5 via fastembed (ONNX). Adds the e5 "query: "/"passage: " prefixes."""

    _REGISTERED: ClassVar[set[str]] = set()

    def __init__(
        self,
        model: str,
        revision: str,
        cache_dir: Path,
        dim: int = 384,
        threads: int | None = None,
    ) -> None:
        from fastembed import TextEmbedding
        from fastembed.common.model_description import ModelSource, PoolingType
        from huggingface_hub import snapshot_download

        files = {"allow_patterns": ["onnx/model.onnx", "onnx/*.json"], "cache_dir": str(cache_dir)}
        try:  # offline first: a pinned commit never changes once cached
            local = snapshot_download(model, revision=revision, local_files_only=True, **files)
        except Exception:  # not cached yet → download once
            log.info("downloading %s@%s to %s", model, revision[:12], cache_dir)
            local = snapshot_download(model, revision=revision, **files)
        alias = f"kai/{model}@{revision[:12]}"
        if alias not in E5Embedder._REGISTERED:
            with contextlib.suppress(ValueError):  # already registered in this process
                TextEmbedding.add_custom_model(
                    model=alias,
                    pooling=PoolingType.MEAN,
                    normalization=True,
                    sources=ModelSource(hf=model),
                    dim=dim,
                    model_file="model.onnx",
                )
            E5Embedder._REGISTERED.add(alias)
        self._model = TextEmbedding(
            alias, specific_model_path=str(Path(local) / "onnx"), threads=threads or None
        )
        self.dim = dim
        self.name = f"{model}@{revision[:12]}"

    def embed_documents(self, texts: Sequence[str], batch_size: int = 16) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        vecs = self._model.embed([f"passage: {t}" for t in texts], batch_size=batch_size)
        return _l2_normalize(np.stack(list(vecs)))

    def embed_query(self, text: str) -> np.ndarray:
        vec = next(iter(self._model.embed([f"query: {text}"])))
        return _l2_normalize(np.asarray(vec)[None, :])[0]


def build_embedder(
    kind: str, *, model: str, revision: str, cache_dir: Path, threads: int = 0
) -> Embedder:
    if kind == "hashing":
        return HashingEmbedder()
    if kind == "fastembed":
        return E5Embedder(model, revision, cache_dir, threads=threads or None)
    raise ValueError(f"unknown embedder: {kind!r} (expected 'fastembed' or 'hashing')")
