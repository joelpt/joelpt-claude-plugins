---
description: Display the cached BBC Maestro course catalogue from index.json.
---

# /list

Display the BBC Maestro course catalogue from the local cache.

## Steps

1. Load `.env` from `~/.claude/plugins/maestro-downloader/`.
   If absent, tell the user to run `/setup` first and stop.

2. Run `node lib/list.js` which reads `<root>/index.json` and print its **full stdout verbatim** in the conversation inside a fenced code block — do not summarize, paraphrase, or truncate it:

   a. If `index.json` does not exist or `courses` is empty → print:
      `No course catalogue found. Run /fetch-list to build the catalogue.`
      Then stop.

   b. If `lastFetched` is absent or older than 30 days → print a staleness warning before the list.

   c. Display all courses as a table sorted by category then title:

   ```text
   Category      Title                    Author        Type     Lessons  Done
   ------------  -----------------------  ------------  -------  -------  ----
   Art & Design  An Introduction to Ph…   Rankin        visual        35  No
   Cooking       Bread Making             R. Bertinet   visual        27  Yes
   ```

   Columns: Category, Title (truncated at 45 chars), Author, Type (contentType),
   Lessons (total video count), Done (Yes = all downloaded, No = partial or none).

3. Remind the user:
   - `/fetch-list` — refresh the catalogue
   - `/download <course-slug>` — download a course for offline viewing

## Notes

- This command never opens a browser — it only reads the local `index.json` cache.
- To update the catalogue (new courses, new lessons added to existing courses), run `/fetch-list`.
