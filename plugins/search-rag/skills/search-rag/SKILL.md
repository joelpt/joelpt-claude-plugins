---
name: search-rag
description: Semantic search over the user's project documentation. Use when the user asks to find, search, look up, or recall something from project docs/ADRs/markdown files, or when you need design rationale that lives in project documentation.
---

# search-rag: Semantic project documentation search

Use this skill when the user asks any of:

- "find <topic> in our docs"
- "what does the ADR say about <topic>"
- "look up <concept> in the project"
- "where is <thing> documented"
- "search the docs for <query>"

…or when you need to cite project rationale and a literal grep won't find it (because the user used different wording than the docs).

## How to use

Run the bundled query CLI from the plugin root.
Substitute the user's question (rephrased to be specific) for `<question>`:

```bash
uv run --project ${CLAUDE_PLUGIN_ROOT} python -m search_rag.query --question "<question>" --top-k 5
```

The output is a JSON array on stdout, one entry per result:

```json
[
  {
    "text": "…relevant chunk of source text…",
    "file": "/abs/path/to/source.md",
    "score": 0.74,
    "rerank_score": 4.21,
    "line_start": 12,
    "line_end": 28
  }
]
```

The pipeline is two-stage: a fast bi-encoder retrieves ~25 candidates, then a cross-encoder reranks them.

- `score` — dense bi-encoder similarity, normalized 0..1.
  Use this for a quick "is anything in the index relevant" sanity check.
- `rerank_score` — raw cross-encoder logit (typically -10..+10).
  **The output array is already sorted by `rerank_score`**, so the first result is the best.
  A `rerank_score` above ~0 indicates strong relevance; below ~-5 is weak.
- `rerank_score` is absent if the reranker was disabled (`--no-rerank`).

## Interpreting results

- If `rerank_score < -3` (or `score < 0.5` when reranking is disabled) for the top hit, the index probably doesn't contain a direct match.
  Fall back to `Grep` over the configured doc paths and tell the user the RAG hit was weak.
- Always cite results using `file:line_start-line_end` so the user can jump to source.
- If the JSON is `[]`, the project has no `.search-rag.json` (skill is silently inactive)
  or the index is empty. Fall back to `Grep`/`Glob`.

## Index status

If you want to know whether the index is configured for this project:

```bash
uv run --project ${CLAUDE_PLUGIN_ROOT} python -m search_rag.status
```

`active: false` means there's no `.search-rag.json` at the project root.
Suggest the user run the `init-search-rag` skill to create one interactively.

## What this skill does NOT do

- It does not search code symbols. Use `Grep` for that.
- It does not write or update files. Use `Edit`/`Write`.
- It does not search across projects — it's scoped to the current project's `.search-rag.json`.
