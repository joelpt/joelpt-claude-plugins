"""Cross-encoder reranker.

Wraps a small cross-encoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`,
~22M params) that scores (query, candidate) pairs jointly. This is more
accurate than the bi-encoder used for dense retrieval but ~70ms-slower per
batch of 25, so we run it only on the top-N candidates from dense retrieval.

Lazy-loaded: importing this module is cheap; the model is only fetched when
`rerank()` is first called with a non-empty candidate list.
"""

from __future__ import annotations

import sys

RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class Reranker:
    def __init__(self, model_name: str = RERANKER_MODEL) -> None:
        self.model_name = model_name
        self._model = None  # type: ignore[var-annotated]

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        from sentence_transformers import CrossEncoder

        print(
            f"[search-rag] Loading reranker model {self.model_name} (downloads ~80MB on first run)…",
            file=sys.stderr,
            flush=True,
        )
        self._model = CrossEncoder(self.model_name)

    def rerank(
        self,
        question: str,
        candidates: list[dict],
        *,
        top_k: int | None = None,
    ) -> list[dict]:
        """Rescore candidates by joint relevance to `question`. Returns reordered list.

        Each result has a `rerank_score` field appended (raw cross-encoder logit).
        """
        if not candidates:
            return []
        self._ensure_model()
        assert self._model is not None
        pairs = [(question, c["text"]) for c in candidates]
        scores = self._model.predict(pairs, show_progress_bar=False)
        scored = [
            {**c, "rerank_score": float(s)}
            for c, s in zip(candidates, scores, strict=True)
        ]
        scored.sort(key=lambda x: x["rerank_score"], reverse=True)
        if top_k is not None:
            scored = scored[:top_k]
        return scored
