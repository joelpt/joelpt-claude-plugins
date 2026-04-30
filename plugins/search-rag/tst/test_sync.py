"""Subprocess-level tests for the sync CLI."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _run_sync(
    cwd: Path,
    env_extra: dict[str, str] | None = None,
    args: list[str] | None = None,
) -> subprocess.CompletedProcess:
    import os

    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    cmd = [sys.executable, "-m", "search_rag.sync"]
    if args:
        cmd.extend(args)
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.fixture
def project(tmp_path: Path) -> Path:
    return tmp_path


HOOK_ARGS = ["--from-hook"]


class TestSyncHookMode:
    """--from-hook: emits systemMessage JSON on stdout, exit 0 always.

    This is what the SessionStart hook config invokes. systemMessage is the
    documented user-visible channel for Claude Code SessionStart hooks
    (see https://docs.claude.com/en/docs/claude-code/hooks).
    """

    def test_exits_zero_with_skip_message_when_no_config(self, project: Path) -> None:
        result = _run_sync(project, args=HOOK_ARGS)
        assert result.returncode == 0
        payload = _parse_system_message(result.stdout)
        assert payload is not None, f"expected JSON systemMessage on stdout, got: {result.stdout!r}"
        assert "[search-rag]" in payload["systemMessage"]
        assert "no .search-rag.json" in payload["systemMessage"].lower()
        assert not (project / ".search-rag").exists()

    def test_emits_user_visible_summary_on_success(self, project: Path) -> None:
        (project / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        (project / "doc.md").write_text("hello")
        result = _run_sync(project, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"}, args=HOOK_ARGS)
        assert result.returncode == 0, result.stderr
        payload = _parse_system_message(result.stdout)
        assert payload is not None, f"expected systemMessage on stdout, got: {result.stdout!r}"
        msg = payload["systemMessage"]
        assert "[search-rag]" in msg
        assert "1" in msg
        assert "indexed" in msg.lower() or "files" in msg.lower()

    def test_handles_malformed_config(self, project: Path) -> None:
        (project / ".search-rag.json").write_text("{ not valid json")
        result = _run_sync(project, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"}, args=HOOK_ARGS)
        assert result.returncode == 0
        payload = _parse_system_message(result.stdout)
        assert payload is not None, f"expected systemMessage on stdout, got: {result.stdout!r}"
        msg = payload["systemMessage"].lower()
        assert "[search-rag]" in payload["systemMessage"]
        assert "parse" in msg or "json" in msg or "config error" in msg


class TestSyncCliMode:
    """No flag (default): plain text on stderr, original exit codes.

    This is what `just sync` invokes. Avoids dumping JSON envelopes into the
    user's terminal and preserves programmatic exit codes (2 = config error,
    1 = unexpected sync failure, 0 = success or recoverable lock).
    """

    def test_exits_zero_silently_when_no_config(self, project: Path) -> None:
        result = _run_sync(project)
        assert result.returncode == 0
        # Default CLI mode keeps original silent behavior — no diagnostic shown.
        # Don't reuse the hook-mode systemMessage diagnostic in CLI mode.
        assert result.stdout.strip() == ""
        assert "systemMessage" not in result.stderr
        assert not (project / ".search-rag").exists()

    def test_emits_summary_to_stderr_on_success(self, project: Path) -> None:
        (project / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        (project / "doc.md").write_text("hello")
        result = _run_sync(project, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"})
        assert result.returncode == 0, result.stderr
        # Plain text in stderr — no JSON envelope when running interactively
        assert "systemMessage" not in result.stderr
        assert "[search-rag]" in result.stderr
        assert "1" in result.stderr  # one file indexed
        assert "indexed" in result.stderr.lower() or "files" in result.stderr.lower()

    def test_handles_malformed_config_with_nonzero_exit(self, project: Path) -> None:
        (project / ".search-rag.json").write_text("{ not valid json")
        result = _run_sync(project, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"})
        assert result.returncode == 2  # CLI mode preserves the original exit-2 contract
        assert "systemMessage" not in result.stderr
        msg = result.stderr.lower()
        assert "[search-rag]" in result.stderr
        assert "parse" in msg or "json" in msg or "config error" in msg


class TestSyncShared:
    """Behaviors that don't depend on output mode."""

    def test_exits_zero_with_config_and_creates_index(self, project: Path) -> None:
        (project / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        (project / "doc.md").write_text("hello world this is a doc")
        result = _run_sync(project, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"})
        assert result.returncode == 0, result.stderr
        assert (project / ".search-rag").is_dir()

    def test_walks_up_to_find_config(self, tmp_path: Path) -> None:
        (tmp_path / ".search-rag.json").write_text(json.dumps({"globs": ["*.md"]}))
        (tmp_path / "top.md").write_text("hello")
        nested = tmp_path / "deep" / "deeper"
        nested.mkdir(parents=True)
        result = _run_sync(nested, env_extra={"LANCE_RAG_FAKE_EMBEDDER": "1"})
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".search-rag").is_dir()


def _parse_system_message(stdout: str) -> dict | None:
    for line in stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("{") and "systemMessage" in stripped:
            return json.loads(stripped)
    return None
