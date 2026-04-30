"""Load and validate `.search-rag.json` from a project root."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

CONFIG_FILENAME = ".search-rag.json"
INDEX_DIRNAME = ".search-rag"
DEFAULT_CHUNK_SIZE = 400
DEFAULT_CHUNK_OVERLAP = 50


class ConfigError(ValueError):
    """Raised when `.search-rag.json` is malformed or invalid."""


@dataclass(frozen=True)
class Config:
    project_root: Path
    globs: tuple[str, ...]
    chunk_size: int
    chunk_overlap: int

    @property
    def index_dir(self) -> Path:
        return self.project_root / INDEX_DIRNAME


def load_config(project_root: Path) -> Config | None:
    """Load `.search-rag.json` from project_root. Returns None if absent."""
    path = project_root / CONFIG_FILENAME
    if not path.is_file():
        return None

    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ConfigError(f"failed to parse {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a JSON object")

    globs = raw.get("globs")
    if not isinstance(globs, list) or not globs:
        raise ConfigError(f"{path}: 'globs' must be a non-empty list of strings")
    for g in globs:
        if not isinstance(g, str) or not g.strip():
            raise ConfigError(f"{path}: each glob must be a non-empty string (got {g!r})")

    chunk_size = raw.get("chunk_size", DEFAULT_CHUNK_SIZE)
    chunk_overlap = raw.get("chunk_overlap", DEFAULT_CHUNK_OVERLAP)

    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise ConfigError(f"{path}: chunk_size must be a positive int (got {chunk_size!r})")
    if not isinstance(chunk_overlap, int) or chunk_overlap < 0:
        raise ConfigError(f"{path}: chunk_overlap must be a non-negative int (got {chunk_overlap!r})")
    if chunk_overlap >= chunk_size:
        raise ConfigError(f"{path}: chunk_overlap ({chunk_overlap}) must be < chunk_size ({chunk_size})")

    return Config(
        project_root=project_root,
        globs=tuple(globs),
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
