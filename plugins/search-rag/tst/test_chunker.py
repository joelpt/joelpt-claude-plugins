"""Tests for search_rag.chunker."""

from __future__ import annotations

from pathlib import Path

import pytest

from search_rag.chunker import Chunk, chunk_file


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content)
    return p


class TestChunkFile:
    def test_empty_file_returns_no_chunks(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "empty.md", "")
        assert chunk_file(path, chunk_size=400, chunk_overlap=50) == []

    def test_whitespace_only_returns_no_chunks(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "ws.md", "   \n\n  \t  \n")
        assert chunk_file(path, chunk_size=400, chunk_overlap=50) == []

    def test_short_file_yields_one_chunk(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "tiny.md", "Hello world.\n\nThis is short.")
        chunks = chunk_file(path, chunk_size=400, chunk_overlap=50)
        assert len(chunks) == 1
        assert "Hello world" in chunks[0].text
        assert "This is short" in chunks[0].text

    def test_chunk_metadata(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "tiny.md", "Hello world.")
        chunks = chunk_file(path, chunk_size=400, chunk_overlap=50)
        c = chunks[0]
        assert isinstance(c, Chunk)
        assert c.path == str(path)
        assert c.line_start == 1
        assert c.line_end >= 1
        assert c.mtime > 0

    def test_long_file_yields_multiple_chunks(self, tmp_path: Path) -> None:
        # 20 paragraphs of 30 words each ≈ 600 words → multiple chunks at chunk_size=100 words
        paragraphs = [" ".join(["lorem"] * 30) for _ in range(20)]
        content = "\n\n".join(paragraphs)
        path = _write(tmp_path, "long.md", content)
        chunks = chunk_file(path, chunk_size=100, chunk_overlap=20)
        assert len(chunks) >= 5

    def test_chunks_have_overlap(self, tmp_path: Path) -> None:
        # Use distinct words so we can verify overlap
        words = [f"word{i:04d}" for i in range(300)]
        content = " ".join(words)
        path = _write(tmp_path, "overlap.md", content)
        chunks = chunk_file(path, chunk_size=100, chunk_overlap=20)
        assert len(chunks) >= 2
        # The last 20 words of chunk[0] should appear in chunk[1]
        first_words = chunks[0].text.split()
        second_words = chunks[1].text.split()
        overlap_tail = first_words[-20:]
        assert overlap_tail[0] in second_words, "expected overlap between consecutive chunks"

    def test_no_mid_word_split(self, tmp_path: Path) -> None:
        words = [f"distinctword{i}" for i in range(200)]
        content = " ".join(words)
        path = _write(tmp_path, "words.md", content)
        chunks = chunk_file(path, chunk_size=50, chunk_overlap=10)
        for c in chunks:
            for token in c.text.split():
                # Each token, if it began life as a "distinctword{i}", must remain whole
                if "distinctword" in token:
                    assert token.startswith("distinctword") and any(ch.isdigit() for ch in token)

    def test_line_numbers_track_source(self, tmp_path: Path) -> None:
        lines = [f"Line {i} has some content." for i in range(1, 51)]
        content = "\n".join(lines)
        path = _write(tmp_path, "lines.md", content)
        chunks = chunk_file(path, chunk_size=50, chunk_overlap=5)
        assert chunks[0].line_start == 1
        # later chunks should have higher line_start
        if len(chunks) > 1:
            assert chunks[-1].line_start > 1
            assert chunks[-1].line_end <= 50

    def test_large_file_does_not_oom(self, tmp_path: Path) -> None:
        # 200KB file — should still work
        content = ("foo bar baz qux quux corge " * 100 + "\n\n") * 100
        path = _write(tmp_path, "big.md", content)
        chunks = chunk_file(path, chunk_size=400, chunk_overlap=50)
        assert len(chunks) > 0
        # Each chunk should be bounded
        for c in chunks:
            assert len(c.text.split()) <= 400 + 50  # tolerate small overshoot for word boundaries

    def test_unreadable_file_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "nope.md"
        with pytest.raises(FileNotFoundError):
            chunk_file(path, chunk_size=400, chunk_overlap=50)
