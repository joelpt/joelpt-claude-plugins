# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## maestro-downloader plugin

A Claude Code plugin that downloads BBC Maestro courses for offline viewing with AV1 video optimization. The plugin manages course discovery, intelligent rate-limited downloading via ffmpeg direct HLS, transcoding to AV1+Opus WebM, and serves a local HTML UI for playback.

## Project Status

**Pre-alpha**: The README.md contains full specifications. Implementation is in progress.

## Architecture

The plugin exposes three CLI commands (`/setup`, `/list`, `/download`) and maintains course state via `config.json` files.

### Data & State

- **Root folder**: User-specified via `/setup`; structure is `<root>/courses/<ConciseCourseTitle>/`
- **Course metadata**: Each course has a `config.json` at `<course-folder>/config.json` tracking:
  - Video index (categories → videos)
  - Download progress (marking videos complete as they're processed)
  - Category structure (varies per course)
- **Downloaded videos**: Stored in `<course-folder>/videos/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.webm`
- **UI index**: Master index at `<root>/index.html` and per-course indices; index.json lists completed courses

### Download Pipeline

Sequential processing per video (single ffmpeg call — no intermediate files):
1. Playwright logs in and extracts HLS manifest URLs from lesson pages
2. CDN is fully public — no auth needed for actual download
3. `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -i <m3u8_url> -map 0:v:0 -map 0:a:0 -c:v libsvtav1 -crf 28 -preset 6 -c:a libopus -b:a 128k <output>.webm`
4. Save as `.webm` (AV1+Opus) and mark complete in `config.json`
5. Rate limiting: exponential backoff with jitter between videos to avoid throttling
6. Encoding speed: ~1× realtime for 4K on Apple Silicon (preset 6)

### Command Structure

- **`/setup`**: Initialize `.env` in plugin folder with BBC Maestro credentials and root download folder; create folder structure
- **`/list`**: Fetch available courses from BBC Maestro, categorize, and display to user
- **`/download`**: Main orchestrator; resumes on rerun if incomplete; extracts manifest URL → ffmpeg encode → mark complete, per video in sequence

### UI

- **`index.html`**: Master course index; uses query params (`?course=...` for course view, `?video=...` for video viewer)
- **`index.json`**: Auto-populated only after all videos in a course are downloaded
- Single-page navigation; video viewer embeds playback of local `.webm` files via HTML5 `<video>` (AV1+Opus, supported natively in Chrome 70+, Firefox 67+, Edge, Safari 17+)

## Development Quickstart

### Prerequisites
- Node.js (TBD version; likely 18+)
- ffmpeg (video transcoding)
- Browser automation library (Puppeteer or Playwright; TBD)

### Plugin Scaffolding

The plugin needs a `.claude-plugin/` directory structure:
```
.claude-plugin/
  plugin.json          # plugin metadata
commands/
  setup.md             # command definition for /setup
  list.md              # command definition for /list
  download.md          # command definition for /download
hooks/
  hooks.json           # if any session/startup hooks needed
```

### Key Implementation Notes

- **Browser automation**: Playwright (confirmed working) handles login and HLS manifest URL extraction. No browser involvement during the actual download — ffmpeg pulls segments directly from the public CDN.
- **ffmpeg integration**: Single subprocess per video; flags: `-protocol_whitelist file,http,https,tcp,tls,crypto -map 0:v:0 -map 0:a:0 -c:v libsvtav1 -crf 28 -preset 6 -c:a libopus -b:a 128k`. Output format: `.webm`.
- **Rate limiting**: Exponential backoff + jitter; implement as async delays between video processing
- **Resumability**: `config.json` must be saved after each successful video, allowing `/download` reruns to skip completed videos
- **Environment**: `.env` stored in `~/.claude/plugins/maestro-downloader/` (not git-tracked), loaded by commands

## Testing Strategy

- Unit: Mock BBC Maestro API responses; test download state tracking and config.json updates
- Integration: Test against a staging BBC Maestro account (or test course if available)
- Manual: Verify `/setup` creates expected folder structure, `/list` returns courses, `/download` completes at least one video end-to-end

## References

See README.md for full feature spec, download mechanism details, and UI mockup notes.
