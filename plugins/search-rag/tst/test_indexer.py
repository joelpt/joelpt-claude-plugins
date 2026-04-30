"""Tests for search_rag.indexer."""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
import pytest

from search_rag.config import Config
from search_rag.embedder import EMBEDDING_DIM
from search_rag.indexer import LockedError, SyncStats, sync_project


class FakeEmbedder:
    """Deterministic, fast stand-in for the real Embedder."""

    def __init__(self) -> None:
        self.call_count = 0

    def embed(self, texts: list[str]) -> np.ndarray:
        self.call_count += 1
        if not texts:
            return np.empty((0, EMBEDDING_DIM), dtype=np.float32)
        out = np.zeros((len(texts), EMBEDDING_DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            # Hash text → seed for a deterministic random vector.
            h = int(hashlib.sha256(t.encode()).hexdigest()[:8], 16)
            rng = np.random.default_rng(h)
            v = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
            out[i] = v / (np.linalg.norm(v) + 1e-9)
        return out


def _make_project(tmp_path: Path, files: dict[str, str]) -> Path:
    for rel, content in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return tmp_path


def _cfg(project_root: Path, globs: tuple[str, ...] = ("*.md",)) -> Config:
    return Config(project_root=project_root, globs=globs, chunk_size=400, chunk_overlap=50)


class TestSyncProject:
    def test_creates_index_dir(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello world"})
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        assert (tmp_path / ".search-rag").is_dir()

    def test_writes_gitignore(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        gi = tmp_path / ".search-rag" / ".gitignore"
        assert gi.is_file()
        assert gi.read_text().strip() == "*"

    def test_returns_stats(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello world", "b.md": "another file"})
        stats = sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        assert isinstance(stats, SyncStats)
        assert stats.indexed_files == 2
        assert stats.total_chunks >= 2
        assert stats.skipped_files == 0
        assert stats.removed_files == 0

    def test_indexes_only_matching_globs(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "yes", "b.txt": "no", "docs/c.md": "deep"})
        cfg = _cfg(tmp_path, globs=("*.md",))
        stats = sync_project(cfg, embedder=FakeEmbedder())
        # Only top-level a.md matches "*.md", not docs/c.md or b.txt
        assert stats.indexed_files == 1

    def test_recursive_glob(self, tmp_path: Path) -> None:
        _make_project(
            tmp_path,
            {"a.md": "yes", "docs/b.md": "yes", "docs/sub/c.md": "yes"},
        )
        cfg = _cfg(tmp_path, globs=("**/*.md",))
        stats = sync_project(cfg, embedder=FakeEmbedder())
        assert stats.indexed_files == 3

    def test_skips_unchanged_files_on_resync(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        emb = FakeEmbedder()
        sync_project(_cfg(tmp_path), embedder=emb)
        first_calls = emb.call_count
        # Re-sync with no changes
        stats2 = sync_project(_cfg(tmp_path), embedder=emb)
        assert stats2.indexed_files == 0
        assert stats2.skipped_files == 1
        # Should not have re-embedded (only initial call counted)
        assert emb.call_count == first_calls

    def test_reindexes_when_mtime_changes(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        emb = FakeEmbedder()
        sync_project(_cfg(tmp_path), embedder=emb)
        # Bump mtime
        time.sleep(0.05)
        (tmp_path / "a.md").write_text("hello world updated")
        stats2 = sync_project(_cfg(tmp_path), embedder=emb)
        assert stats2.indexed_files == 1
        assert stats2.skipped_files == 0

    def test_removes_orphaned_files(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello", "b.md": "world"})
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        # Remove b.md
        (tmp_path / "b.md").unlink()
        stats = sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        assert stats.removed_files == 1

    def test_persists_across_calls(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello world"})
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())

        # Open the table directly to verify it persists
        import lancedb

        db = lancedb.connect(str(tmp_path / ".search-rag"))
        tbl = db.open_table("chunks")
        arrow_tbl = tbl.to_arrow()
        assert arrow_tbl.num_rows >= 1
        names = arrow_tbl.schema.names
        assert "text" in names
        assert "path" in names
        assert "vector" in names

    def test_lockfile_prevents_concurrent_sync(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        cfg = _cfg(tmp_path)
        # Simulate a held lock by creating the lockfile with a fresh PID
        lock_dir = tmp_path / ".search-rag"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock = lock_dir / ".lock"
        lock.write_text(json.dumps({"pid": os.getpid(), "ts": time.time()}))

        with pytest.raises(LockedError):
            sync_project(cfg, embedder=FakeEmbedder())

    def test_stale_lock_is_broken(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        cfg = _cfg(tmp_path)
        lock_dir = tmp_path / ".search-rag"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock = lock_dir / ".lock"
        # Stale: 10 minutes old, dead PID
        lock.write_text(json.dumps({"pid": 999999, "ts": time.time() - 600}))

        # Should succeed by breaking the stale lock.
        stats = sync_project(cfg, embedder=FakeEmbedder())
        assert stats.indexed_files == 1

    def test_lockfile_released_on_completion(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        # After successful sync, lockfile should be gone
        assert not (tmp_path / ".search-rag" / ".lock").exists()

    def test_records_last_sync_timestamp(self, tmp_path: Path) -> None:
        _make_project(tmp_path, {"a.md": "hello"})
        before = time.time()
        sync_project(_cfg(tmp_path), embedder=FakeEmbedder())
        meta_path = tmp_path / ".search-rag" / "meta.json"
        assert meta_path.is_file()
        meta = json.loads(meta_path.read_text())
        assert meta["last_sync"] >= before
        assert meta["model"]
