"""Subprocess-level tests for the status CLI."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _run(cwd: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["LANCE_RAG_FAKE_EMBEDDER"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "search_rag.status"],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _run_sync(cwd: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["LANCE_RAG_FAKE_EMBEDDER"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "search_rag.sync"],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


class TestStatusCli:
    def test_no_config_returns_inactive_status(self, tmp_path: Path) -> None:
        result = _run(tmp_path)
        assert result.returncode == 0
        out = json.loads(result.stdout)
        assert out["active"] is False

    def test_after_sync_returns_populated_status(self, tmp_path: Path) -> None:
        (tmp_path / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        (tmp_path / "a.md").write_text("first doc")
        (tmp_path / "b.md").write_text("second doc")
        sync = _run_sync(tmp_path)
        assert sync.returncode == 0, sync.stderr

        result = _run(tmp_path)
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)
        assert out["active"] is True
        assert out["indexed_files"] == 2
        assert out["total_chunks"] >= 2
        assert out["last_sync"] > 0
        assert out["model"] == "BAAI/bge-small-en-v1.5"

    def test_config_present_but_index_missing(self, tmp_path: Path) -> None:
        (tmp_path / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        # No sync run yet
        result = _run(tmp_path)
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)
        assert out["active"] is True
        assert out["indexed_files"] == 0
        assert out["total_chunks"] == 0
        assert out["last_sync"] == 0
