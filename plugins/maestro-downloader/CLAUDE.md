# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## maestro-downloader plugin

A Claude Code plugin that downloads BBC Maestro courses for offline viewing with AV1 video optimization. The plugin manages course discovery, intelligent rate-limited downloading of .ts video fragments, merging, transcoding, and serves a local HTML UI for playback.

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
- **Downloaded videos**: Stored in `<course-folder>/videos/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.av1`
- **UI index**: Master index at `<root>/index.html` and per-course indices; index.json lists completed courses

### Download Pipeline

Sequential processing per video:
1. BBC Maestro delivers videos as .ts fragment sequences
2. Download .ts series using a headless browser (Puppeteer or Playwright expected)
3. Merge .ts fragments into a single file
4. Transcode to AV1 with ffmpeg (high fidelity, minimal practical loss)
5. Save as `.av1` file and mark complete in `config.json`
6. Rate limiting: exponential backoff with jitter between videos to avoid throttling

### Command Structure

- **`/setup`**: Initialize `.env` in plugin folder with BBC Maestro credentials and root download folder; create folder structure
- **`/list`**: Fetch available courses from BBC Maestro, categorize, and display to user
- **`/download`**: Main orchestrator; resumes on rerun if incomplete; downloads → merges → transcodes each video in sequence

### UI

- **`index.html`**: Master course index; uses query params (`?course=...` for course view, `?video=...` for video viewer)
- **`index.json`**: Auto-populated only after all videos in a course are downloaded
- Single-page navigation; video viewer embeds playback of local .av1 files

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

- **Browser automation**: Headless browser must handle login and in-page video download controls (likely using Puppeteer/Playwright with event listeners for file downloads)
- **ffmpeg integration**: Subtask-level; call `ffmpeg` subprocess with AV1 codec params; output format `.av1`
- **Rate limiting**: Exponential backoff + jitter; implement as async delays between video processing
- **Resumability**: `config.json` must be saved after each successful video, allowing `/download` reruns to skip completed videos
- **Environment**: `.env` stored in `~/.claude/plugins/maestro-downloader/` (not git-tracked), loaded by commands

## Testing Strategy

- Unit: Mock BBC Maestro API responses; test download state tracking and config.json updates
- Integration: Test against a staging BBC Maestro account (or test course if available)
- Manual: Verify `/setup` creates expected folder structure, `/list` returns courses, `/download` completes at least one video end-to-end

## References

See README.md for full feature spec, download mechanism details, and UI mockup notes.
