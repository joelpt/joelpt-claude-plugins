# TODO: maestro-downloader Plugin

## Phase 1: Plugin Infrastructure & POCs (Foundation)

### Setup
- [x] Create `.claude-plugin/plugin.json` with metadata
- [x] Create `commands/setup.md`, `commands/list.md`, `commands/download.md` stubs
- [x] Create `hooks/hooks.json` if needed (likely for session init) — skipped: no hooks needed at this phase
- [x] Set up basic project structure: `src/`, `lib/`, `ui/`
- [x] Install dependencies (Playwright/Puppeteer, ffmpeg-fluent, express for local server, etc.)

### POC: BBC Maestro Browser Automation
**Blocker risk: HIGH** — ✅ RESOLVED — No DRM, CDN fully open.
- [x] POC: Log in to BBC Maestro with credentials (Playwright headless) — works; reCAPTCHA present but session set before it; stealth mode recommended
- [x] POC: Extract course list from main page (DOM scraping or network inspection) — `vc-poster` cards, pattern: `/courses/{instructor}/{slug}`
- [x] POC: Navigate to a single course and extract video categories + video metadata — lesson links at `/courses/.../lessons/{slug}`
- [x] POC: Verify `.ts` fragment URLs are accessible and downloadable via browser context — CDN is public S3/CloudFront, `Access-Control-Allow-Origin: *`, no auth needed
- [x] Document findings: How many .ts fragments per video? Auth/session reqs? Any anti-bot measures? — see `poc/01-findings.md`

### POC: Video Processing Pipeline
**Blocker risk: MEDIUM** — ✅ RESOLVED — Direct HLS → AV1 WebM confirmed; see `poc/02-findings.md`.
- [x] POC: Merge a sample .ts file sequence with `ffmpeg -concat` demuxer — superseded; direct HLS is simpler
- [x] POC: Transcode merged file to AV1 with high-fidelity settings; measure quality vs. file size tradeoff — CRF 28 recommended (~3 Mbps 4K)
- [x] Document findings: ffmpeg CLI params, transcoding time, file size deltas — see `poc/02-findings.md`

### POC: Browser Playback
**Blocker risk: LOW** — ✅ RESOLVED — `.webm` (AV1+Opus) plays natively; no player lib needed.
- [x] POC: Test HTML5 `<video>` playback of local `.webm` file in major browsers — Chrome 70+, Firefox 67+, Edge, Safari 17+ all support AV1 in WebM natively
- [x] POC: If native support lacking, evaluate lightweight player lib — not needed
- [x] Document findings: Browser compatibility, player choice if needed — `.webm`+AV1 is the answer; spec updated

### POC: Rate Limiting Strategy
**Blocker risk: MEDIUM** — If exponential backoff doesn't prevent throttling, need alternative.
- [ ] POC: Implement exponential backoff + jitter; stress-test against BBC Maestro (or test endpoint)
- [ ] POC: Monitor 429/503 responses; verify backoff adapts correctly
- [ ] Document findings: Safe download rate, optimal backoff params

---

## Phase 2: Core Commands

### `/setup` Command
- [ ] Create command handler in `commands/setup.md` and `lib/setup.js`
- [ ] Prompt for BBC Maestro credentials (username, password)
- [ ] Prompt for root download folder path
- [ ] Create folder structure: `<root>/courses/`, `<root>/index.html`, `<root>/index.json`
- [ ] Generate/save `.env` in `~/.claude/plugins/maestro-downloader/` (use dotenv)
- [ ] Validate credentials with test login
- [ ] Output success/error messaging

### `/list` Command
- [ ] Create command handler in `commands/list.md` and `lib/list.js`
- [ ] Load credentials from `.env`
- [ ] Launch headless browser, log in, fetch course list
- [ ] Format output: Group courses by category; include course name, duration, instructor (if available)
- [ ] Cache course list (optional: in memory for session, or short-lived JSON file)

### `/download` Command
- [ ] Create command handler in `commands/download.md` and `lib/download.js`
- [ ] Accept course name argument (auto-complete from `/list` output)
- [ ] Load/create `config.json` for the course
- [ ] Main loop:
  - [ ] For each category:
    - [ ] For each video (skip if already marked complete):
      - [ ] Download .ts fragments
      - [ ] Merge fragments with ffmpeg
      - [ ] Transcode to AV1
      - [ ] Save to `videos/<category>/<index-title>.av1`
      - [ ] Update `config.json` (mark video complete, update progress metadata)
      - [ ] Apply rate limiting (exponential backoff + jitter)
  - [ ] After all videos complete, populate `index.json` for UI
- [ ] Support resume: Rerunning `/download` for same course skips completed videos
- [ ] Progress reporting: Log per-video status, ETA, error recovery

---

## Phase 3: UI & Integration

### HTML UI (`ui/index.html`)
- [ ] Master course index: Fetch `index.json`, render course tiles (name, thumbnail, completion %)
- [ ] Query param routing:
  - [ ] `?course=<ConciseCourseTitle>` → Show course detail page (categories + videos list)
  - [ ] `?video=<ConciseCourseTitle>/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.av1>` → Show video player with `<video>` element
- [ ] Navigation: Links between master index → course view → video player
- [ ] Styling: Clean, responsive layout (mobile-friendly for viewing on tablets)

### Local Server
- [ ] Create simple HTTP server (Express or Node's http) to serve UI and video files
- [ ] Serve static files from `<root>/` with appropriate MIME types for `.av1`
- [ ] Handle relative paths for video playback

### Integration Testing
- [ ] End-to-end: `/setup` → `/list` → `/download` → verify folder structure and UI
- [ ] Test resume on `/download` rerun
- [ ] Test UI navigation and video playback
- [ ] Error handling: Invalid credentials, network failures, incomplete downloads

---

## Phase 4: Polish & Deployment

- [ ] Error messages: User-friendly errors for common failure modes (login failed, network timeout, disk full, etc.)
- [ ] Logging: Structured logs for debugging download issues
- [ ] Documentation: Update README with setup/usage instructions
- [ ] Register plugin in parent repo's `marketplace.json` (see parent CLAUDE.md for workflow)
- [ ] Test on macOS and Linux (Windows compatibility TBD)

---

## Notes

- **Dependency lock**: Confirm Playwright/Puppeteer version before committing (npm/yarn.lock)
- **Secrets**: `.env` must never be committed; add to `.gitignore`
- **Browser reuse**: Consider keeping a persistent headless browser session across `/list` and `/download` to avoid repeated login overhead
- **Logging levels**: Debug logs for .ts downloads, info for per-video progress, warn/error for failures

