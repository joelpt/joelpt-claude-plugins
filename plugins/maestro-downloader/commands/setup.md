---
description: Initialize BBC Maestro credentials and set the root download folder. Stores config in ~/.claude/plugins/maestro-downloader/.env
---

# /setup

Initialize the maestro-downloader plugin configuration.

## Steps

1. Check whether `~/.claude/plugins/maestro-downloader/.env` already exists.
   If it does, show the current values (masking the password) and ask the user if they want to update.

2. Prompt the user for their BBC Maestro credentials:
   - Email address
   - Password (remind them it will be stored locally in `.env`)

3. Prompt the user for a root download folder path (e.g. `~/Videos/maestro`).
   Expand `~` to an absolute path.

4. Create the directory structure under `<root>/`:
   - `courses/` — one subfolder per downloaded course
   - `index.html` — master UI page (placeholder if not present)
   - `index.json` — master course index (empty object `{"lastFetched": null, "courses": []}` if not present)

5. Reduce background load from system indexers on the courses dir (macOS only — safe to skip on other platforms):
   - `touch "<root>/courses/.metadata_never_index"` — Apple's documented per-directory Spotlight opt-out
     (no sudo required, unlike `mdutil -i off` which needs a volume mountpoint or root).
   - `tmutil addexclusion "<root>/courses"` — exclude from Time Machine backups so TM doesn't scan mid-encode.

   Both are reversible (`rm .metadata_never_index` / `tmutil removeexclusion`). Report results;
   if either errors (e.g. on a non-macOS host), continue without failing setup.

6. Write `~/.claude/plugins/maestro-downloader/.env` with:

   ```text
   MAESTRO_EMAIL=<email>
   MAESTRO_PASSWORD=<password>
   MAESTRO_ROOT=<absolute-root-path>
   ```

7. Run `node lib/setup.js --validate` from the plugin directory to do a test login.
   The script reads credentials from the `.env` file written in step 6.
   Report success or failure clearly.

## Notes

- Never commit `.env` to git.
- If the root folder already contains a `courses/` directory, do not delete existing downloaded content.
