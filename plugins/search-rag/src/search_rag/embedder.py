"""Local sentence-transformers embedder.

Wraps `BAAI/bge-small-en-v1.5` (~130MB, 384-dim, normalized). Model is loaded
lazily so importing this module is cheap.
"""

from __future__ import annotations

import sys

import numpy as np

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384


class Embedder:
    def __init__(self, model_name: str = MODEL_NAME) -> None:
        self.model_name = model_name
        self._model = None  # type: ignore[var-annotated]

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        # Lazy import: keeps module import cheap and avoids loading torch
        # in test runs that only exercise pure-function modules.
        from sentence_transformers import SentenceTransformer

        print(
            f"[search-rag] Loading embedding model {self.model_name} (downloads ~130MB on first run)…",
            file=sys.stderr,
            flush=True,
        )
        self._model = SentenceTransformer(self.model_name)

    def embed(self, texts: list[str]) -> np.ndarray:
        """Return an (N, EMBEDDING_DIM) float32 array of unit-norm embeddings."""
        if not texts:
            return np.empty((0, EMBEDDING_DIM), dtype=np.float32)
        self._ensure_model()
        assert self._model is not None
        out = self._model.encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return out.astype(np.float32)
