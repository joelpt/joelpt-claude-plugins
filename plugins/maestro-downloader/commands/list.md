---
description: Display the cached BBC Maestro course catalogue from index.json.
---

# /list

Display the BBC Maestro course catalogue from the local cache.

## Steps

1. Load `.env` from `~/.claude/plugins/maestro-downloader/`.
   If absent, tell the user to run `/setup` first and stop.

2. Read `<root>/index.json` (root folder is specified in `.env`).

3. Check cache validity:
   - If `index.json` does not exist or `courses` is empty → print:
     > "No course catalogue found. Run `/fetch-list` to scan your BBC Maestro account."
     Then stop.
   - If `lastFetched` is absent or older than 30 days → print a warning at the top:
     > "⚠ Course list was last updated on <date> — it may be out of date. Run `/fetch-list` to refresh."
     Then continue displaying the cached data.

4. Run `node lib/list.js` which reads `index.json` and displays results grouped by course,
   showing categories and video counts:

   ```text
   ## <Course Title> — <Instructor>
   <N> videos across <M> categories
   Last fetched: <date>

   Categories:
     - <Category Name> (<video count> videos, <completed count> downloaded)
   ```

5. After listing, remind the user:
   - `/fetch-list` — refresh the catalogue
   - `/download <course title>` — download a course for offline viewing

## Notes

- This command never opens a browser — it only reads the local `index.json` cache.
- To update the catalogue (new courses, new lessons added to existing courses), run `/fetch-list`.
