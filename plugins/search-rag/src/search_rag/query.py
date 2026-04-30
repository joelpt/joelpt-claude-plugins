"""CLI: semantic query against the project's LanceDB index.

Outputs a JSON list of results to stdout. Always exits 0 if config + index
are valid, even when results are empty. Diagnostics (model load notice, etc.)
go to stderr.

Two-stage retrieval:
  1. Dense bi-encoder (`Embedder`) → top-N candidates from LanceDB
  2. Cross-encoder (`Reranker`) → rescore (query, candidate) pairs jointly,
     return top-k

Stage 2 can be disabled with `--no-rerank` or `LANCE_RAG_DISABLE_RERANKER=1`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import lancedb

from search_rag.config import ConfigError, load_config
from search_rag.indexer import TABLE_NAME
from search_rag.sync import _find_project_root, _make_embedder

# Pull this many dense candidates per query when reranking is enabled.
RERANK_CANDIDATE_POOL = 25


def _dense_search(cfg, embedder, question: str, limit: int) -> list[dict]:  # type: ignore[no-untyped-def]
    if not cfg.index_dir.exists():
        return []
    db = lancedb.connect(str(cfg.index_dir))
    try:
        tbl = db.open_table(TABLE_NAME)
    except (FileNotFoundError, ValueError):
        return []

    if tbl.to_arrow().num_rows == 0:
        return []

    qvec = embedder.embed([question])[0].tolist()
    df = tbl.search(qvec).limit(limit).to_arrow()

    paths = df.column("path").to_pylist()
    texts = df.column("text").to_pylist()
    line_starts = df.column("line_start").to_pylist()
    line_ends = df.column("line_end").to_pylist()
    distances = df.column("_distance").to_pylist()

    out: list[dict] = []
    for i in range(len(paths)):
        d = float(distances[i])
        score = max(0.0, min(1.0, 1.0 - d / 2.0))
        out.append(
            {
                "text": texts[i],
                "file": paths[i],
                "score": score,
                "line_start": int(line_starts[i]),
                "line_end": int(line_ends[i]),
            }
        )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="search_rag.query",
        description="Semantic search over the project's LanceDB index.",
    )
    parser.add_argument("--question", required=True, help="natural-language query")
    parser.add_argument("--top-k", type=int, default=5, help="max results (default 5)")
    parser.add_argument(
        "--no-rerank",
        action="store_true",
        help="skip the cross-encoder rerank stage (faster, lower quality)",
    )
    args = parser.parse_args(argv)

    if not args.question or not args.question.strip():
        print("[search-rag] --question must be non-empty", file=sys.stderr)
        return 2

    if args.top_k <= 0:
        print("[search-rag] --top-k must be positive", file=sys.stderr)
        return 2

    root = _find_project_root(Path.cwd())
    if root is None:
        print(json.dumps([]))
        return 0

    try:
        cfg = load_config(root)
    except ConfigError as exc:
        print(f"[search-rag] config error: {exc}", file=sys.stderr)
        return 2

    if cfg is None:
        print(json.dumps([]))
        return 0

    rerank_disabled = args.no_rerank or os.environ.get("LANCE_RAG_DISABLE_RERANKER") == "1"

    embedder = _make_embedder()
    pool = args.top_k if rerank_disabled else max(RERANK_CANDIDATE_POOL, args.top_k)
    candidates = _dense_search(cfg, embedder, args.question.strip(), pool)

    if rerank_disabled or not candidates:
        results = candidates[: args.top_k]
    else:
        from search_rag.reranker import Reranker

        reranker = Reranker()
        results = reranker.rerank(args.question.strip(), candidates, top_k=args.top_k)

    print(json.dumps(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
