# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## maestro-downloader plugin

A Claude Code plugin that downloads BBC Maestro courses for offline viewing with AV1 video
optimization. Manages course discovery via a cached index, intelligent rate-limited crawling,
direct HLS-to-AV1 transcoding via ffmpeg, and a local HTML UI for playback.

## Project Status

**Pre-alpha**: The README.md contains full specifications. Implementation is in progress.

## Architecture

The plugin exposes four CLI commands (`/setup`, `/fetch-list`, `/list`, `/download`) and
maintains all course and download state in a single `index.json` file.

### Data & State

- **Root folder**: User-specified via `/setup`; structure is `<root>/courses/<slug>/`
- **`index.json`**: Lives at `<root>/index.json`. Single source of truth for:
  - Full course/category/video catalogue with CDN manifest URLs (written by `/fetch-list`)
  - Download state per video (`completed`, `downloadedAt`, `localPath`)
  - `lastFetched` timestamp (used by `/list` to detect stale cache)
- **Downloaded videos**: `<root>/courses/<slug>/videos/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.webm`
- **UI index**: `<root>/index.html` reads `index.json` directly; no separate per-course index file

### Commands

- **`/setup`**: Prompt for credentials + root folder; write `.env`; create folder structure
- **`/fetch-list`**: Playwright crawl → writes/merges full catalogue into `index.json`.
  Sequential page loads, random 1.5–3.5 s inter-page delay, 3–6 s inter-course delay.
  Preserves existing `completed`/`downloadedAt`/`localPath` fields on known videos.
  Adds newly discovered videos with `completed: false`.
- **`/list`**: Reads `index.json`; displays course catalogue. If absent/empty or
  `lastFetched` is >30 days ago, prints a warning and instructs user to run `/fetch-list`.
- **`/download`**: For each video in specified course: skip if `completed`, else run ffmpeg
  against cached `manifestUrl` from `index.json`. No browser needed during download.
  On success, updates `completed`, `downloadedAt`, `localPath` in `index.json`.

### Download Pipeline

Single ffmpeg call per video — no intermediate files:

```bash
ffmpeg -y \
  -protocol_whitelist file,http,https,tcp,tls,crypto \
  -i "<manifestUrl_1080p_variant>" \
  -map 0:v:0 -map 0:a:0 \
  -c:v libsvtav1 -crf 28 -preset 6 \
  -c:a libopus -b:a 128k \
  "<output>.webm"
```

Key flags:
- `-protocol_whitelist file,http,https,tcp,tls,crypto` — required for HLS over HTTPS
- `-map 0:v:0 -map 0:a:0` — **mandatory**; without explicit mapping ffmpeg silently drops audio
- Default variant: **1080p** (~3× realtime, ~67 MB/lesson)
- Optional `--quality 4k`: 2160p variant (~1× realtime, ~198 MB/lesson)

### CDN Architecture (confirmed via POC)

- BBC Maestro CDN: CloudFront + S3 origin, no WAF, no signed URLs, no auth tokens
- Videos are publicly accessible once you have the manifest URL
- Rate limiting risk is **only** on `bbcmaestro.com` page scraping (Playwright)
- CDN segment downloads (ffmpeg) are effectively unguarded — no watch-rate detection

### index.json Schema

```json
{
  "lastFetched": "ISO8601 timestamp",
  "courses": [
    {
      "slug": "instructor-slug/course-slug",
      "title": "Course Title",
      "instructor": "Instructor Name",
      "courseUrl": "https://www.bbcmaestro.com/courses/...",
      "categories": [
        {
          "title": "Category Name",
          "videos": [
            {
              "index": 1,
              "title": "Video Title",
              "lessonUrl": "https://www.bbcmaestro.com/courses/.../lessons/...",
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

`manifestUrl` is the HLS master manifest — one URL per video, no segment URLs stored.
The 1080p variant URL is derived by inserting `_1080` before `.m3u8` in the master URL.

### UI

- `index.html`: Master course index; query param routing (`?course=`, `?video=`)
- `<video>` element plays `.webm` (AV1+Opus) natively: Chrome 70+, Firefox 67+, Edge, Safari 17+

## Development Quickstart

### Prerequisites

- Node.js 18+
- ffmpeg with `libsvtav1` and `libopus` (Homebrew: `brew install ffmpeg`)
- Playwright (`npm install` in plugin dir)

### Plugin Structure

```text
.claude-plugin/plugin.json
commands/setup.md
commands/fetch-list.md
commands/list.md
commands/download.md
lib/setup.js
lib/fetch-list.js
lib/list.js
lib/download.js
ui/index.html
```

### Key Implementation Notes

- **`/fetch-list`**: Playwright intercepts `.m3u8` network requests on each lesson page to
  capture the manifest URL. Load existing `index.json` first; merge new data preserving
  completion fields; write atomically (write temp file, rename).
- **`/download`**: Reads `manifestUrl` from `index.json`. Derives 1080p variant by
  replacing `.m3u8` with `_1080.m3u8`. Spawns ffmpeg subprocess. Updates `index.json`
  after each successful video.
- **Rate limiting**: `/fetch-list` uses `setTimeout` with `Math.random()` for jitter.
  `/download` uses exponential backoff (10s → 20s → 40s) on ffmpeg HTTP errors.
- **Resumability**: `index.json` is written after each completed video; reruns skip
  `completed: true` entries.
- **Environment**: `.env` in `~/.claude/plugins/maestro-downloader/` (never committed).

## Testing Strategy

- Unit: Test `index.json` merge logic (preserve completed, add new, update lastFetched)
- Unit: Test manifest URL → 1080p variant URL derivation
- Integration: `/fetch-list` against live account → verify `index.json` structure
- Integration: `/download` single video → verify file created, `index.json` updated
- Manual smoke: `/setup` → `/fetch-list` → `/list` → `/download` one video → open in browser

## References

See README.md for full spec and index.json schema.
See `poc/01-findings.md` through `poc/03-findings.md` for confirmed CDN, pipeline, and rate-limiting findings.
