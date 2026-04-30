"""CLI entry point: discover project root, load config, run sync."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from search_rag.config import CONFIG_FILENAME, ConfigError, load_config
from search_rag.indexer import LockedError, sync_project


def _find_project_root(start: Path) -> Path | None:
    """Walk up from `start` looking for `.search-rag.json`."""
    cur = start.resolve()
    while True:
        if (cur / CONFIG_FILENAME).is_file():
            return cur
        if cur.parent == cur:
            return None
        cur = cur.parent


def _make_embedder():  # type: ignore[no-untyped-def]
    """Pick the embedder. Tests can swap in a fake via env var to skip the model download."""
    if os.environ.get("LANCE_RAG_FAKE_EMBEDDER") == "1":
        import hashlib

        import numpy as np

        from search_rag.embedder import EMBEDDING_DIM

        class FakeEmbedder:
            def embed(self, texts: list[str]) -> np.ndarray:
                if not texts:
                    return np.empty((0, EMBEDDING_DIM), dtype=np.float32)
                out = np.zeros((len(texts), EMBEDDING_DIM), dtype=np.float32)
                for i, t in enumerate(texts):
                    h = int(hashlib.sha256(t.encode()).hexdigest()[:8], 16)
                    rng = np.random.default_rng(h)
                    v = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
                    out[i] = v / (np.linalg.norm(v) + 1e-9)
                return out

        return FakeEmbedder()

    from search_rag.embedder import Embedder

    return Embedder()


def _emit_hook(message: str) -> None:
    """Emit a user-visible message via Claude Code's systemMessage channel.

    SessionStart hook stdout-as-text is invisible to the user — only stdout JSON with
    a `systemMessage` field is surfaced. Used only when --from-hook is set.
    """
    print(json.dumps({"systemMessage": message}))


def _emit_cli(message: str) -> None:
    """Plain-text stderr for interactive `just sync` use."""
    print(message, file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="search_rag.sync",
        description="Sync the LanceDB index for the current project.",
    )
    parser.add_argument(
        "--from-hook",
        action="store_true",
        help="Emit user-visible output as Claude Code systemMessage JSON on stdout "
        "and exit 0 on every path. Default: plain stderr text + exit codes.",
    )
    args = parser.parse_args(argv)

    if args.from_hook:
        emit = _emit_hook
        err_exit = 0  # hook mode: every reportable outcome exits 0
    else:
        emit = _emit_cli
        err_exit = None  # CLI mode: caller-specific exit codes below

    root = _find_project_root(Path.cwd())
    if root is None:
        if args.from_hook:
            emit(f"[search-rag] no .search-rag.json found in tree above {Path.cwd()}, skipping")
        # CLI mode: stay silent on no-config (original behavior)
        return 0

    try:
        cfg = load_config(root)
    except ConfigError as exc:
        emit(f"[search-rag] config error: {exc}")
        return 0 if err_exit == 0 else 2

    if cfg is None:  # belt-and-suspenders
        return 0

    embedder = _make_embedder()
    try:
        stats = sync_project(cfg, embedder=embedder)
    except LockedError as exc:
        emit(f"[search-rag] {exc}")
        return 0  # not a real failure — another sync is running
    except Exception as exc:  # pragma: no cover
        emit(f"[search-rag] sync failed: {exc}")
        return 0 if err_exit == 0 else 1

    emit(
        f"[search-rag] sync complete: "
        f"{stats.indexed_files} indexed, "
        f"{stats.skipped_files} skipped, "
        f"{stats.removed_files} removed, "
        f"{stats.total_chunks} chunks, "
        f"{stats.elapsed_ms}ms"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
