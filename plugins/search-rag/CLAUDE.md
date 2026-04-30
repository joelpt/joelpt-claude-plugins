# search-rag

This repository **is** the `search-rag` Claude Code plugin.
Everything here — `src/`, `hooks/`, `skills/`, `.claude-plugin/plugin.json` — exists to ship that plugin.
It is not a library that happens to live in a Claude project; the plugin is the product.

## What the plugin does

Local-first semantic search over project documentation, backed by LanceDB and `BAAI/bge-small-en-v1.5` embeddings, with a cross-encoder rerank stage.
A `SessionStart` hook auto-syncs the index on each Claude Code session.
The `search-rag` skill teaches Claude to call the bundled `search_rag.query` CLI when the user asks documentation questions.

## Plugin surface (what's exposed to Claude Code)

- **Hook**: `hooks/hooks.json` registers a `SessionStart` (`startup|resume`) command that runs `python -m search_rag.sync --from-hook`.
- **Skills**: `skills/search-rag/` (query the index) and `skills/init-search-rag/` (scaffold `.search-rag.json` in a new project).
- **No slash commands by design.** If you ever feel one is needed, add `commands/` and update README + this file.
- **Plugin manifest**: `.claude-plugin/plugin.json` (name, version, author).

## Code layout

- `src/search_rag/` — the Python package the hook and skills shell out to.
  - `sync.py` — incremental, mtime-aware index build (entrypoint for the hook)
  - `query.py` — two-stage retrieval CLI (dense → cross-encoder rerank)
  - `status.py` — health/`last_sync` reporter
  - `chunker.py`, `embedder.py`, `reranker.py`, `indexer.py`, `config.py`
- `tst/` — pytest suite. **All tests live here, never under `src/`.**
- `Justfile` — `just test`, `just sync`, `just query Q=...`, `just status`, `just lint`, `just smoke`.
- `.search-rag.json` (per consumer-project, not in this repo) — globs + chunk config.

## Conventions for this repo

- TDD is mandatory for changes to `src/search_rag/**`. Build/infra (Justfile, plugin.json, hooks.json, README, this file) is exempt.
- Module name is `search_rag` (underscore). If you see `lance_rag` anywhere, it's a stale rename — fix it.
- Don't add cloud calls, telemetry, or background daemons. Local-first is a hard constraint, not a preference.
- Keep model footprint small: bi-encoder ≤ ~150MB, cross-encoder ≤ ~100MB. If you want to swap models, justify it against this budget.

## Verifying the plugin is actually loaded

A common failure mode: edits land in this repo but Claude Code never picks them up because the plugin isn't installed/enabled.
Check, in order:

1. `claude plugin list` shows `search-rag@local` enabled.
2. `~/.claude/plugins/marketplaces/local/.claude-plugin/marketplace.json` lists `search-rag` with `source: ./plugins/search-rag`.
3. `~/.claude/plugins/marketplaces/local/plugins/search-rag` is a symlink to this directory.
4. Session start in a project with `.search-rag.json` prints a `[search-rag] sync ...` line.

If any step fails, see "Install" in `README.md` — don't paper over it by manually editing `installed_plugins.json` or symlinking into `cache/local/`; Claude Code 2.x reconciles those from the marketplace on every session.
