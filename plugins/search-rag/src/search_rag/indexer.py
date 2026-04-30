"""Per-project LanceDB indexer with mtime-aware incremental sync."""

from __future__ import annotations

import glob as glob_module
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

import lancedb
import pyarrow as pa

from search_rag.chunker import chunk_file
from search_rag.config import INDEX_DIRNAME, Config
from search_rag.embedder import EMBEDDING_DIM, MODEL_NAME

TABLE_NAME = "chunks"
LOCK_STALE_SECONDS = 300


class LockedError(RuntimeError):
    """Raised when another sync holds an active lock."""


@dataclass(frozen=True)
class SyncStats:
    indexed_files: int
    skipped_files: int
    removed_files: int
    total_chunks: int
    elapsed_ms: int


def _schema() -> pa.Schema:
    return pa.schema(
        [
            pa.field("id", pa.string()),
            pa.field("path", pa.string()),
            pa.field("mtime", pa.float64()),
            pa.field("line_start", pa.int64()),
            pa.field("line_end", pa.int64()),
            pa.field("text", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), EMBEDDING_DIM)),
        ]
    )


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _acquire_lock(lock: Path) -> None:
    if lock.exists():
        try:
            data = json.loads(lock.read_text())
            pid = int(data.get("pid", -1))
            ts = float(data.get("ts", 0.0))
        except (json.JSONDecodeError, ValueError, TypeError):
            pid, ts = -1, 0.0
        stale = (time.time() - ts) > LOCK_STALE_SECONDS
        alive = _pid_alive(pid)
        if alive and not stale:
            raise LockedError(f"sync already running (pid {pid})")
        lock.unlink(missing_ok=True)
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text(json.dumps({"pid": os.getpid(), "ts": time.time()}))


def _discover_files(cfg: Config) -> set[Path]:
    """Collect files matching any configured glob, relative to project_root."""
    found: set[Path] = set()
    for pattern in cfg.globs:
        for raw in glob_module.glob(str(cfg.project_root / pattern), recursive=True):
            p = Path(raw)
            if not p.is_file():
                continue
            try:
                rel = p.relative_to(cfg.project_root)
            except ValueError:
                continue
            # Never index files inside our own index dir.
            if rel.parts and rel.parts[0] == INDEX_DIRNAME:
                continue
            found.add(p.resolve())
    return found


def _escape_sql(s: str) -> str:
    return s.replace("'", "''")


def sync_project(cfg: Config, *, embedder) -> SyncStats:  # type: ignore[no-untyped-def]
    """Run an mtime-aware incremental sync. Returns counts."""
    start = time.time()
    cfg.index_dir.mkdir(parents=True, exist_ok=True)

    gi = cfg.index_dir / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n")

    lock = cfg.index_dir / ".lock"
    _acquire_lock(lock)

    try:
        db = lancedb.connect(str(cfg.index_dir))
        try:
            tbl = db.open_table(TABLE_NAME)
        except (FileNotFoundError, ValueError):
            tbl = db.create_table(TABLE_NAME, schema=_schema())

        # Snapshot existing path → max(mtime) so we can diff
        existing: dict[str, float] = {}
        arrow_tbl = tbl.to_arrow()
        if arrow_tbl.num_rows > 0:
            paths = arrow_tbl.column("path").to_pylist()
            mtimes = arrow_tbl.column("mtime").to_pylist()
            for p, m in zip(paths, mtimes, strict=True):
                if p in existing:
                    existing[p] = max(existing[p], float(m))
                else:
                    existing[p] = float(m)

        discovered = _discover_files(cfg)
        discovered_paths = {str(p) for p in discovered}

        indexed_files = 0
        skipped_files = 0
        total_chunks = 0

        for path in sorted(discovered, key=lambda p: str(p)):
            mtime = path.stat().st_mtime
            path_str = str(path)
            stored = existing.get(path_str)
            if stored is not None and mtime <= stored + 1e-6:
                skipped_files += 1
                continue

            # Replace any prior chunks for this path
            if stored is not None:
                tbl.delete(f"path = '{_escape_sql(path_str)}'")

            chunks = chunk_file(path, chunk_size=cfg.chunk_size, chunk_overlap=cfg.chunk_overlap)
            if chunks:
                vectors = embedder.embed([c.text for c in chunks])
                rows = [
                    {
                        "id": f"{c.path}#{c.line_start}-{c.line_end}-{i}",
                        "path": c.path,
                        "mtime": float(c.mtime),
                        "line_start": int(c.line_start),
                        "line_end": int(c.line_end),
                        "text": c.text,
                        "vector": vectors[i].tolist(),
                    }
                    for i, c in enumerate(chunks)
                ]
                tbl.add(rows)
                total_chunks += len(chunks)
            indexed_files += 1

        removed_files = 0
        for stored_path in existing:
            if stored_path not in discovered_paths:
                tbl.delete(f"path = '{_escape_sql(stored_path)}'")
                removed_files += 1

        meta = {"last_sync": time.time(), "model": MODEL_NAME}
        (cfg.index_dir / "meta.json").write_text(json.dumps(meta))

        elapsed_ms = int((time.time() - start) * 1000)
        return SyncStats(
            indexed_files=indexed_files,
            skipped_files=skipped_files,
            removed_files=removed_files,
            total_chunks=total_chunks,
            elapsed_ms=elapsed_ms,
        )
    finally:
        lock.unlink(missing_ok=True)
