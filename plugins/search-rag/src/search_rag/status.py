"""CLI: report index health as JSON to stdout.

Schema:
  {
    "active": bool,            # whether .search-rag.json was found
    "indexed_files": int,
    "total_chunks": int,
    "last_sync": float,        # epoch seconds (0 if never)
    "model": str,
    "project_root": str | null
  }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import lancedb

from search_rag.config import ConfigError, load_config
from search_rag.embedder import MODEL_NAME
from search_rag.indexer import TABLE_NAME
from search_rag.sync import _find_project_root


def _gather_status(cfg) -> dict:  # type: ignore[no-untyped-def]
    indexed_files = 0
    total_chunks = 0
    last_sync = 0.0
    model = MODEL_NAME

    if cfg.index_dir.exists():
        meta_path = cfg.index_dir / "meta.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text())
                last_sync = float(meta.get("last_sync", 0.0))
                model = str(meta.get("model", MODEL_NAME))
            except (json.JSONDecodeError, ValueError):
                pass

        try:
            db = lancedb.connect(str(cfg.index_dir))
            tbl = db.open_table(TABLE_NAME)
            arrow = tbl.to_arrow()
            total_chunks = arrow.num_rows
            paths = arrow.column("path").to_pylist() if total_chunks else []
            indexed_files = len(set(paths))
        except (FileNotFoundError, ValueError):
            pass

    return {
        "active": True,
        "indexed_files": indexed_files,
        "total_chunks": total_chunks,
        "last_sync": last_sync,
        "model": model,
        "project_root": str(cfg.project_root),
    }


def main(argv: list[str] | None = None) -> int:
    root = _find_project_root(Path.cwd())
    if root is None:
        print(json.dumps({
            "active": False,
            "indexed_files": 0,
            "total_chunks": 0,
            "last_sync": 0.0,
            "model": MODEL_NAME,
            "project_root": None,
        }))
        return 0

    try:
        cfg = load_config(root)
    except ConfigError as exc:
        print(f"[search-rag] config error: {exc}", file=sys.stderr)
        return 2

    if cfg is None:
        print(json.dumps({
            "active": False,
            "indexed_files": 0,
            "total_chunks": 0,
            "last_sync": 0.0,
            "model": MODEL_NAME,
            "project_root": None,
        }))
        return 0

    print(json.dumps(_gather_status(cfg)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
