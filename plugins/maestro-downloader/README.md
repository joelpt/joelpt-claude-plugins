This is a Claude Code plugin which provides a video downloader functionality for BBC Maestro.

## v2 in flight

A v2 rewrite is in progress on `main` (the original yolo worktree was merged 2026-05-16) that converts the on-disk layout to a Plex-/Jellyfin-compatible TV Shows library while preserving the bespoke SPA as a no-Plex fallback. New code already shipped:

- JSON Schema validator for `index.json` (Ajv 2020-12).
- Pure layout functions in `lib/layout.js` (path & season derivation; idempotent legacy-path candidates for migration).
- NFO writers in `lib/nfo.js` (Plex `<namedseason>` + per-episode `<uniqueid>`; Jellyfin-safe season.nfo per issue #11656).
- Artwork downloader in `lib/artwork.js` (poster/fanart, idempotent).
- `mergeCourses` rewrite that recurses into `subcategories[].videos` (fixes the documented data-loss bug on multi-category courses) and preserves a new `subscribed` user-state field.
- Migration tooling in `lib/migrate.js` with `--plan / --copy / --verify / --cleanup` subcommands, per-course receipts under `.migration/`, atomic `.copying` staging, 5% SHA-256 sampling, and a lockfile.
- `download.js` writes to v2 paths and emits per-episode `.nfo` sidecars on completion.
- `serve.js` rewrites absolute `localPath` fields in the served `index.json` to URL-relative paths so the SPA works against both v1 and v2 layouts transparently.

Pending work and BLOCKING human-input items are tracked in `USER_TODO.md`. See `docs/PLEX_SETUP.md` for the Plex library configuration once migration is complete.

## Supported commands

### `/setup`

Initializes a `.env` file in the plugin's folder (`~/.claude/plugins/maestro-downloader/`).
Prompts for BBC Maestro credentials (email, password) and the root download folder.
Creates the folder structure: `<root>/courses/`, `<root>/index.html`, `<root>/index.json`.

### `/fetch-list`

Performs a full crawl of the user's BBC Maestro account.
Logs in via headless browser (Playwright), visits every accessible course page and each
lesson page sequentially, and writes the complete course/category/video catalogue —
including CDN manifest URLs — to `<root>/index.json`.

Key behaviours:

- Sequential page loads only; random 1.5–3.5 s inter-page delay and 3–6 s inter-course
  delay to stay within normal browsing patterns.
- **Additive / non-destructive update:** existing records in `index.json` are merged, not
  replaced. Completion status, `downloadedAt`, and `localPath` fields on already-known
  videos are preserved. Newly discovered videos (e.g. a course that added a bonus lesson)
  are inserted with `completed: false`.
- Overwrites `lastFetched` timestamp on each run.
- Intended to be run rarely — on first use and when the library may have changed.

### `/list`

Reads `index.json` from the root folder and displays the course catalogue.
If `index.json` is absent, empty, or older than 30 days, instructs the user to run
`/fetch-list` first.

### `/download <course>`

Downloads and transcodes all videos in a named course for offline playback.
Reads manifest URLs from `index.json` (no browser required during download).
Resumes automatically if rerun — already-completed videos are skipped.

---

## index.json schema

`index.json` lives at `<root>/index.json` and is the single source of truth for the
course catalogue and download state.

```json
{
  "lastFetched": "2026-05-04T08:00:00Z",
  "courses": [
    {
      "slug": "owen-o-kane/a-life-less-anxious",
      "title": "A Life Less Anxious",
      "instructor": "Owen O'Kane",
      "courseUrl": "https://www.bbcmaestro.com/courses/owen-o-kane/a-life-less-anxious",
      "categories": [
        {
          "title": "Lessons",
          "videos": [
            {
              "index": 22,
              "title": "Dare to Dream",
              "lessonUrl": "https://www.bbcmaestro.com/courses/owen-o-kane/a-life-less-anxious/lessons/dare-to-dream",
              "manifestUrl": "https://videos.cdn.bbcmaestro.com/.../HLS/....m3u8",
              "completed": false,
              "downloadedAt": null,
              "localPath": null
            }
          ]
        }
      ]
    }
  ]
}
```

`manifestUrl` is the HLS master manifest URL intercepted from the lesson page network
traffic during `/fetch-list`. This is the only CDN URL stored — ffmpeg resolves and
downloads the individual `.ts` segments at encode time. No segment URLs are stored.

---

## Download pipeline

For each video in a course (reads from `index.json`):

1. Skip if `completed: true`.
2. Call `ffmpeg` with the cached `manifestUrl` — downloads + merges + transcodes in one
   pass, no intermediate files on disk.
   - Default quality: 1080p, CRF 28, libsvtav1 preset 6, Opus 128k audio → `.webm`
   - Optional: `--quality 4k` selects the 2160p HLS variant (~3× larger, ~3× slower)
3. On success: set `completed: true`, `downloadedAt`, `localPath` in `index.json`.
4. Exponential backoff (10s → 20s → 40s → abort) on ffmpeg HTTP errors (429/503).

Encoding performance (Apple Silicon, M-series):

- 1080p: ~3× realtime — 9-min lesson encodes in ~3 min, ~67 MB output
- 4K: ~1× realtime — 9-min lesson encodes in ~9 min, ~198 MB output

---

## UI features

1. `<root>/index.html` — master course index; reads `/index.json` (served from `<root>/index.json` with absolute `localPath` fields rewritten to URL-relative paths so it works against both v1 and v2 layouts).
2. `?course=<slug>` — course detail page showing categories (and subcategories, rendered as `Parent → Child`) with video list.
3. `?video=<url-path>` — video player using HTML5 `<video>` element. WebM (AV1+Opus) plays natively in Chrome 70+, Firefox 67+, Edge, and Safari 17+.
