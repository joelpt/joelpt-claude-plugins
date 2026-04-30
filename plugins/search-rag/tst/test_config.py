"""Tests for search_rag.config."""

import json
from pathlib import Path

import pytest

from search_rag.config import Config, ConfigError, load_config


def _write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data))


class TestLoadConfig:
    def test_returns_none_when_file_absent(self, tmp_path: Path) -> None:
        assert load_config(tmp_path) is None

    def test_loads_valid_file(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": ["docs/**/*.md"]})
        cfg = load_config(tmp_path)
        assert cfg is not None
        assert cfg.globs == ("docs/**/*.md",)
        assert cfg.project_root == tmp_path

    def test_applies_defaults(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": ["*.md"]})
        cfg = load_config(tmp_path)
        assert cfg is not None
        assert cfg.chunk_size == 400
        assert cfg.chunk_overlap == 50

    def test_respects_overrides(self, tmp_path: Path) -> None:
        _write(
            tmp_path / ".search-rag.json",
            {"globs": ["*.md"], "chunk_size": 200, "chunk_overlap": 25},
        )
        cfg = load_config(tmp_path)
        assert cfg is not None
        assert cfg.chunk_size == 200
        assert cfg.chunk_overlap == 25

    def test_rejects_missing_globs(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"chunk_size": 100})
        with pytest.raises(ConfigError, match="globs"):
            load_config(tmp_path)

    def test_rejects_empty_globs(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": []})
        with pytest.raises(ConfigError, match="globs"):
            load_config(tmp_path)

    def test_rejects_non_string_glob(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": [123]})
        with pytest.raises(ConfigError, match="glob"):
            load_config(tmp_path)

    def test_rejects_empty_string_glob(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": [""]})
        with pytest.raises(ConfigError, match="glob"):
            load_config(tmp_path)

    def test_rejects_malformed_json(self, tmp_path: Path) -> None:
        (tmp_path / ".search-rag.json").write_text("{not json")
        with pytest.raises(ConfigError, match="parse"):
            load_config(tmp_path)

    def test_rejects_negative_chunk_size(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": ["*.md"], "chunk_size": -1})
        with pytest.raises(ConfigError, match="chunk_size"):
            load_config(tmp_path)

    def test_rejects_negative_overlap(self, tmp_path: Path) -> None:
        _write(tmp_path / ".search-rag.json", {"globs": ["*.md"], "chunk_overlap": -1})
        with pytest.raises(ConfigError, match="chunk_overlap"):
            load_config(tmp_path)

    def test_overlap_must_be_less_than_chunk_size(self, tmp_path: Path) -> None:
        _write(
            tmp_path / ".search-rag.json",
            {"globs": ["*.md"], "chunk_size": 100, "chunk_overlap": 100},
        )
        with pytest.raises(ConfigError, match="chunk_overlap"):
            load_config(tmp_path)


class TestConfigDataclass:
    def test_is_frozen(self, tmp_path: Path) -> None:
        cfg = Config(project_root=tmp_path, globs=("*.md",), chunk_size=400, chunk_overlap=50)
        with pytest.raises((AttributeError, TypeError)):
            cfg.chunk_size = 999  # type: ignore[misc]

    def test_index_dir_path(self, tmp_path: Path) -> None:
        cfg = Config(project_root=tmp_path, globs=("*.md",), chunk_size=400, chunk_overlap=50)
        assert cfg.index_dir == tmp_path / ".search-rag"
