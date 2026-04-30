"""Tests for search_rag.embedder."""

from __future__ import annotations

import os

import numpy as np
import pytest

from search_rag.embedder import EMBEDDING_DIM, MODEL_NAME, Embedder

# Real model download is ~130MB. Gate with env var so the basic suite stays fast.
RUN_SLOW = os.environ.get("LANCE_RAG_RUN_SLOW") == "1"


class TestEmbedderUnit:
    """Pure unit tests — no model load."""

    def test_constants_exposed(self) -> None:
        assert MODEL_NAME == "BAAI/bge-small-en-v1.5"
        assert EMBEDDING_DIM == 384

    def test_lazy_load(self) -> None:
        """Constructing an Embedder must not load the model."""
        e = Embedder()
        assert e._model is None  # type: ignore[attr-defined]

    def test_embed_empty_returns_empty(self) -> None:
        e = Embedder()
        result = e.embed([])
        assert isinstance(result, np.ndarray)
        assert result.shape == (0, EMBEDDING_DIM)
        # still no model load for empty input
        assert e._model is None  # type: ignore[attr-defined]


@pytest.mark.skipif(not RUN_SLOW, reason="set LANCE_RAG_RUN_SLOW=1 to run real-model tests")
class TestEmbedderReal:
    """Slow tests that exercise the real sentence-transformers model."""

    def test_embed_batch_shape(self) -> None:
        e = Embedder()
        texts = ["hello world", "another sentence", "third one"]
        out = e.embed(texts)
        assert out.shape == (3, EMBEDDING_DIM)

    def test_embeddings_are_normalized(self) -> None:
        e = Embedder()
        out = e.embed(["hello world"])
        norm = float(np.linalg.norm(out[0]))
        assert abs(norm - 1.0) < 0.01, f"expected unit-norm embedding, got {norm}"

    def test_deterministic(self) -> None:
        e = Embedder()
        a = e.embed(["the quick brown fox"])
        b = e.embed(["the quick brown fox"])
        assert np.allclose(a, b)

    def test_semantic_similarity(self) -> None:
        e = Embedder()
        out = e.embed(
            [
                "the cat sat on the mat",
                "a feline rested on a rug",
                "I am compiling code",
            ]
        )
        sim_related = float(np.dot(out[0], out[1]))
        sim_unrelated = float(np.dot(out[0], out[2]))
        assert sim_related > sim_unrelated, "semantically related text should score higher"
