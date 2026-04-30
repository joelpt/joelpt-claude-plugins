"""Word-bounded, paragraph-aware chunker for plain-text/markdown files.

`chunk_size` and `chunk_overlap` are measured in *words*. A word boundary is
preserved at every chunk edge. Line numbers are tracked so callers can render
results with file:line citations.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Chunk:
    text: str
    path: str
    mtime: float
    line_start: int  # 1-indexed inclusive
    line_end: int  # 1-indexed inclusive


def chunk_file(path: Path, *, chunk_size: int, chunk_overlap: int) -> list[Chunk]:
    """Split a file into overlapping word-bounded chunks.

    Returns [] for empty/whitespace-only files. Raises FileNotFoundError for
    missing files.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    mtime = path.stat().st_mtime

    if not text.strip():
        return []

    # Build a parallel array: each word paired with the source line number.
    words: list[str] = []
    word_lines: list[int] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for w in line.split():
            words.append(w)
            word_lines.append(lineno)

    if not words:
        return []

    chunks: list[Chunk] = []
    step = chunk_size - chunk_overlap  # always > 0 (validated in config)
    i = 0
    n = len(words)
    while i < n:
        j = min(i + chunk_size, n)
        chunk_words = words[i:j]
        chunk_text = " ".join(chunk_words)
        line_start = word_lines[i]
        line_end = word_lines[j - 1]
        chunks.append(
            Chunk(
                text=chunk_text,
                path=str(path),
                mtime=mtime,
                line_start=line_start,
                line_end=line_end,
            )
        )
        if j == n:
            break
        i += step

    return chunks
