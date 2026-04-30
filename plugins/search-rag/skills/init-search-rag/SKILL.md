---
name: init-search-rag
description: Create or update the .search-rag.json config file for this project. Use when the user asks to set up, configure, or initialize the search-rag RAG index for their project.
---

# init-search-rag: Set up search-rag for this project

Guides the user through creating or updating the per-project `.search-rag.json` config file using an interactive question flow.

## Schema

The config file must conform to this JSON Schema (also at `${CLAUDE_PLUGIN_ROOT}/src/search_rag/config.schema.json`):

```json
{
  "type": "object",
  "required": ["globs"],
  "additionalProperties": false,
  "properties": {
    "globs": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string", "minLength": 1 }
    },
    "chunk_size":    { "type": "integer", "minimum": 1,  "default": 400 },
    "chunk_overlap": { "type": "integer", "minimum": 0, "default": 50 }
  }
}
```

Constraints enforced beyond the schema:
- `chunk_overlap` must be strictly less than `chunk_size`.

## Procedure

1. **Check for existing config** — read `.search-rag.json` in the current working directory if it exists and show the user the current values.

2. **Ask about globs** — use the `AskUserQuestion` tool:

   > Which files should search-rag index?
   > Common patterns:
   >   docs/**/*.md — all Markdown under docs/
   >   *.md         — root-level Markdown files
   >   src/**/*.py  — all Python source files
   >
   > Enter a comma-separated list of glob patterns (current: <current or "none">):

   Parse the answer as a comma-separated list. Trim whitespace and discard empty entries.

3. **Ask about chunk_size** — use the `AskUserQuestion` tool:

   > Max tokens per chunk? (default 400, current: <current>):

   If the user presses Enter without input, keep the default (400) or existing value.

4. **Ask about chunk_overlap** — use the `AskUserQuestion` tool:

   > Token overlap between chunks? Must be less than chunk_size. (default 50, current: <current>):

   If the user presses Enter without input, keep the default (50) or existing value.

5. **Validate** — before writing, verify the assembled config against the schema above:
   - `globs` is a non-empty array of non-empty strings.
   - `chunk_size` is a positive integer.
   - `chunk_overlap` is a non-negative integer strictly less than `chunk_size`.
   - No extra keys are present.
   If any constraint fails, explain the problem and re-ask only the failing field.

6. **Confirm and write** — show the final JSON to the user and ask for confirmation via `AskUserQuestion` ("Write this to `.search-rag.json`? [Y/n]"). On confirmation, write the file with `Write`.

7. **Report** — confirm the file was written and remind the user that the index will sync on the next session start.

## Defaults

| Field          | Default |
|----------------|---------|
| `chunk_size`   | 400     |
| `chunk_overlap`| 50      |

## Example output

```json
{
  "globs": ["docs/**/*.md", "*.md"],
  "chunk_size": 400,
  "chunk_overlap": 50
}
```
