---
description: List all available BBC Maestro courses, grouped by category, using stored credentials.
---

# /list

Fetch and display the current BBC Maestro course catalogue.

## Steps

1. Load credentials from `~/.claude/plugins/maestro-downloader/.env`.
   If `.env` does not exist, tell the user to run `/setup` first.

2. Run `node lib/list.js` which:
   - Launches a headless Playwright browser
   - Logs in to BBC Maestro with the stored credentials
   - Scrapes the course listing page
   - Returns a JSON array of courses: `{ title, category, instructor, duration?, url }`

3. Display results grouped by category, formatted as:

   ```text
   ## <Category Name>

   - <Course Title> — <Instructor> (<Duration>)
   - ...
   ```

4. After listing, note how many total courses were found and remind the user they can
   run `/download <course title>` to download any course.

## Notes

- Course titles shown here are used as the `<ConciseCourseTitle>` argument for `/download`.
- The list is fetched live each time; there is no persistent cache.
