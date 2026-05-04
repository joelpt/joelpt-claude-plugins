---
description: Crawl the user's BBC Maestro account and write the full course/video catalogue with CDN manifest URLs to index.json.
---

# /fetch-list

Perform a full crawl of the BBC Maestro account and update the local course catalogue.

## Steps

1. Load `.env` from `~/.claude/plugins/maestro-downloader/`.
   If absent, tell the user to run `/setup` first and stop.

2. Load existing `<root>/index.json` if it exists (to preserve completion metadata).

3. Run `node lib/fetch-list.js` which:

   a. Launches a headless Playwright browser with stealth user-agent.

   b. Logs in to BBC Maestro using stored credentials (2-step: email → password).

   c. Navigates to `/courses` and collects all accessible course URLs.

   d. For each course (sequentially):
      - Visit the course page; extract title, instructor, and category structure.
      - **Random delay: 3–6 s before moving to the next course.**

      For each lesson page within the course (sequentially):
      - Navigate to the lesson page.
      - Intercept the first `.m3u8` network request to capture the master manifest URL.
      - Extract lesson index, title, and lesson URL.
      - **Random delay: 1.5–3.5 s before moving to the next lesson.**

   e. Merge results into the existing `index.json` data:
      - For each video already present in `index.json`: preserve `completed`,
        `downloadedAt`, and `localPath` fields unchanged.
      - For each newly discovered video: add with `completed: false`, `downloadedAt: null`,
        `localPath: null`.
      - Set `lastFetched` to the current ISO timestamp.

   f. Write the merged result atomically to `<root>/index.json`
      (write to a temp file, then rename).

4. On HTTP 429 or 503 from `bbcmaestro.com`: apply exponential backoff
   (10 s → 20 s → 40 s → 80 s), then retry. After 4 failures, skip the page,
   log a warning, and continue.

5. Report a summary on completion:
   ```text
   Catalogue updated: <N> courses, <M> total videos (<K> new since last fetch).
   Run /list to browse, or /download <course> to start downloading.
   ```

## Notes

- This command is slow by design (~8–15 min for a full 10-course library) due to
  the inter-page delays. This is intentional — it mimics normal human browsing speed
  to avoid triggering any application-level rate limiting on `bbcmaestro.com`.
- The CDN (`videos.cdn.bbcmaestro.com`) is a public CloudFront distribution with no
  rate limiting. The only governed surface is `bbcmaestro.com` lesson page loads.
- Run this command: on first use, when new courses may have been added to your
  subscription, or when `/list` warns the cache is stale (>30 days old).
- `manifestUrl` stored in `index.json` is the HLS master manifest. It does not expire.
