---
description: Display the cached BBC Maestro course catalogue from index.json.
---

# /list

Display the BBC Maestro course catalogue from the local cache.

## Steps

1. Load `.env` from `~/.claude/plugins/maestro-downloader/`.
   If absent, tell the user to run `/setup` first and stop.

2. Run `node lib/list.js` which reads `<root>/index.json` and:

   a. If `index.json` does not exist or `courses` is empty → print:
      `No course catalogue found. Run /fetch-list to build the catalogue.`
      Then stop.

   b. If `lastFetched` is absent or older than 30 days → print a staleness warning before the list.

   c. Display courses with completion breakdown:

   ```text
   Course Title — Instructor Name
     instructor/course-slug  [N/M downloaded]
       Category Name: K/N videos
   ```

3. Remind the user:
   - `/fetch-list` — refresh the catalogue
   - `/download <course-slug>` — download a course for offline viewing

## Notes

- This command never opens a browser — it only reads the local `index.json` cache.
- To update the catalogue (new courses, new lessons added to existing courses), run `/fetch-list`.
