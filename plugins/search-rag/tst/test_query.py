"""Subprocess-level tests for the query CLI."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def _run(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["LANCE_RAG_FAKE_EMBEDDER"] = "1"
    env["LANCE_RAG_DISABLE_RERANKER"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "search_rag.query", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
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


@pytest.fixture
def populated_project(tmp_path: Path) -> Path:
    (tmp_path / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
    (tmp_path / "alpha.md").write_text("alpha document about cats and felines")
    (tmp_path / "beta.md").write_text("beta document about dogs and canines")
    (tmp_path / "gamma.md").write_text("gamma document about programming languages")
    sync_result = _run_sync(tmp_path)
    assert sync_result.returncode == 0, sync_result.stderr
    return tmp_path


class TestQueryCli:
    def test_returns_empty_when_no_config(self, tmp_path: Path) -> None:
        result = _run(["--question", "anything"], tmp_path)
        assert result.returncode == 0
        assert json.loads(result.stdout) == []

    def test_returns_top_k_results(self, populated_project: Path) -> None:
        result = _run(["--question", "cats", "--top-k", "2"], populated_project)
        assert result.returncode == 0, result.stderr
        results = json.loads(result.stdout)
        assert isinstance(results, list)
        assert len(results) <= 2
        assert len(results) >= 1
        # Check shape of each result
        for r in results:
            assert "text" in r
            assert "file" in r
            assert "score" in r
            assert "line_start" in r
            assert "line_end" in r
            assert isinstance(r["score"], float)

    def test_default_top_k_is_5(self, populated_project: Path) -> None:
        result = _run(["--question", "document"], populated_project)
        assert result.returncode == 0, result.stderr
        results = json.loads(result.stdout)
        assert len(results) <= 5

    def test_top_k_respected(self, populated_project: Path) -> None:
        result = _run(["--question", "document", "--top-k", "1"], populated_project)
        assert result.returncode == 0, result.stderr
        results = json.loads(result.stdout)
        assert len(results) == 1

    def test_empty_index_returns_empty_list(self, tmp_path: Path) -> None:
        # Config exists but no files indexed
        (tmp_path / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        sync = _run_sync(tmp_path)
        assert sync.returncode == 0, sync.stderr
        result = _run(["--question", "anything"], tmp_path)
        assert result.returncode == 0
        assert json.loads(result.stdout) == []

    def test_question_required(self, tmp_path: Path) -> None:
        result = _run([], tmp_path)
        assert result.returncode != 0

    def test_empty_question_rejected(self, populated_project: Path) -> None:
        result = _run(["--question", "  "], populated_project)
        assert result.returncode != 0

    def test_walks_up_to_find_config(self, populated_project: Path) -> None:
        nested = populated_project / "deep"
        nested.mkdir()
        result = _run(["--question", "cats"], nested)
        assert result.returncode == 0, result.stderr
        results = json.loads(result.stdout)
        assert len(results) >= 1

    def test_score_is_normalized(self, populated_project: Path) -> None:
        result = _run(["--question", "cats"], populated_project)
        assert result.returncode == 0, result.stderr
        for r in json.loads(result.stdout):
            assert 0.0 <= r["score"] <= 1.0

    def test_no_rerank_flag_disables_reranker(self, populated_project: Path) -> None:
        """--no-rerank should skip the cross-encoder stage and return pure dense results."""
        result = _run(["--question", "cats", "--no-rerank"], populated_project)
        assert result.returncode == 0, result.stderr
        results = json.loads(result.stdout)
        # No rerank_score field when reranker is disabled
        for r in results:
            assert "rerank_score" not in r

    def test_default_includes_rerank_score(self, populated_project: Path) -> None:
        """By default, results should include a rerank_score from the cross-encoder."""
        # We use the FAKE_EMBEDDER for retrieval, but the real reranker is exercised here.
        # Skip if the reranker model isn't already cached locally — slow first run.
        env = os.environ.copy()
        env["LANCE_RAG_FAKE_EMBEDDER"] = "1"
        proc = subprocess.run(
            [sys.executable, "-m", "search_rag.query", "--question", "cats"],
            cwd=str(populated_project),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        assert proc.returncode == 0, proc.stderr
        results = json.loads(proc.stdout)
        if results:
            assert "rerank_score" in results[0]
            assert isinstance(results[0]["rerank_score"], float)
