## search-rag

**This repository is the `search-rag` Claude Code plugin.**
It's a local-first plugin that indexes project documentation with LanceDB and lets Claude search it semantically — no cloud APIs, no daemons, no telemetry.

The plugin ships:

- a `SessionStart` hook that auto-syncs the index on every Claude Code session,
- a `search-rag` skill that teaches Claude to query the index when you ask documentation questions,
- an `init-search-rag` skill that scaffolds `.search-rag.json` in a new project.

There are intentionally no slash commands — the hook and skill are the entire user-facing surface.

## How it works

1. Drop a `.search-rag.json` at your project root listing globs to index.
2. Each Claude Code session start syncs the index (mtime-aware, incremental).
3. When you ask Claude to find something in docs, it runs the bundled `search_rag.query` CLI per the `search-rag` skill.
4. No cloud APIs, no daemons, no telemetry.

### Two-stage retrieval

- **Stage 1 (dense)**: bi-encoder `BAAI/bge-small-en-v1.5` (~130MB) embeds every chunk. Per query, we pull the top 25 candidates via cosine similarity in LanceDB.
- **Stage 2 (rerank)**: cross-encoder `cross-encoder/ms-marco-MiniLM-L-6-v2` (~80MB) rescores the top 25 by feeding (query, candidate) jointly into a transformer. Final top-k is sorted by this score.

The cross-encoder adds ~70ms per query but is the single biggest quality lever — it commonly surfaces relevant chunks that the bi-encoder ranked below the cutoff. Disable with `--no-rerank` if you want pure dense speed.

## Per-project config (`.search-rag.json`)

Create this at your project root:

```json
{
  "globs": ["docs/**/*.md", "*.md"],
  "chunk_size": 400,
  "chunk_overlap": 50
}
```

Without this file, the plugin no-ops silently in that project.

`chunk_size` and `chunk_overlap` are measured in *words*. Defaults shown.

## Install

### 1. Install dependencies

```bash
cd ~/code/search-rag
uv sync
```

This pulls LanceDB + sentence-transformers (~700MB total because of PyTorch).
First run of `sync` will additionally download the 130MB embedding model.

### 2. Register the plugin in your `local` marketplace

Claude Code 2.x reconciles `cache/local/` against your local marketplace on every session start.
Plugins not registered in the marketplace get garbage-collected, regardless of `installed_plugins.json`.
So we register through the marketplace, not by direct cache symlink.

If you don't already have a `local` marketplace, set one up:

```bash
mkdir -p ~/.claude/plugins/marketplaces/local/.claude-plugin
mkdir -p ~/.claude/plugins/marketplaces/local/plugins
cat > ~/.claude/plugins/marketplaces/local/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "local",
  "owner": { "name": "You" },
  "plugins": []
}
EOF
```

Then add this plugin to it:

```bash
# Symlink your working copy into the marketplace's plugins dir
ln -sfn ~/code/search-rag ~/.claude/plugins/marketplaces/local/plugins/search-rag
```

Edit `~/.claude/plugins/marketplaces/local/.claude-plugin/marketplace.json` and add an entry under `plugins`:

```json
{
  "name": "search-rag",
  "source": "./plugins/search-rag",
  "description": "Local-first LanceDB RAG over project documentation."
}
```

### 3. Install and enable

```bash
claude plugin marketplace update local
claude plugin install search-rag@local
claude plugin enable search-rag@local
```

### 4. Restart Claude Code

The `SessionStart` hook will fire on the next session start.
With a `.search-rag.json` in your project, you'll see a `[search-rag] sync complete: ...` line.
Without one, you'll see `[search-rag] no .search-rag.json found in tree above ..., skipping`.

## CLIs

```bash
just sync                            # rebuild index (incremental, mtime-aware)
just query Q="stall detection"       # JSON results to stdout
just status                          # index health to stdout
just test                            # run pytest
just lint                            # ruff check
```

The CLIs walk up from `$PWD` to find `.search-rag.json`, so they work from any subdirectory of your project.

## Verify it's working

In Claude Code, in a project with a `.search-rag.json`:

1. Run `just status` — should show `active: true` and a recent `last_sync`.
2. Ask Claude something like "find <topic> in our docs" — Claude should invoke the `search-rag` skill and return results with file:line citations.

If you don't see expected behavior, check:

- `.search-rag/meta.json` exists and has a recent `last_sync`
- `claude plugin list` shows `search-rag@local`
- The plugin is registered in `~/.claude/plugins/marketplaces/local/.claude-plugin/marketplace.json`
- The hook fired on session start: `claude -p --output-format=stream-json --include-hook-events --verbose "hi" | grep lance`

## Stack

- LanceDB ≥ 0.20 (local vector store, no daemon)
- sentence-transformers `BAAI/bge-small-en-v1.5` (384-dim, normalized)
- Python 3.12+, uv, pytest, ruff

## License

MIT
