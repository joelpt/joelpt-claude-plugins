# TODO: maestro-downloader Plugin

## Phase 1: Plugin Infrastructure & POCs (Foundation) ✅ COMPLETE

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
- [x] POC: Transcode merged file to AV1 with high-fidelity settings; measure quality vs. file size tradeoff — CRF 28 / 1080p default confirmed
- [x] Document findings: ffmpeg CLI params, transcoding time, file size deltas — see `poc/02-findings.md`

### POC: Browser Playback
**Blocker risk: LOW** — ✅ RESOLVED — `.webm` (AV1+Opus) plays natively; no player lib needed.
- [x] POC: Test HTML5 `<video>` playback of local `.webm` file in major browsers — Chrome 70+, Firefox 67+, Edge, Safari 17+ all support AV1 in WebM natively
- [x] POC: If native support lacking, evaluate lightweight player lib — not needed
- [x] Document findings: Browser compatibility, player choice if needed — `.webm`+AV1 is the answer; spec updated

### POC: Rate Limiting Strategy
**Blocker risk: MEDIUM** — ✅ RESOLVED — CDN has no rate governing; conservative scraping delay sufficient. See `poc/03-findings.md`.
- [x] POC: Analyse CDN infrastructure for rate limiting mechanisms — CloudFront + S3, no WAF, no signed URLs, no watch-rate detection
- [x] POC: Determine safe inter-page delay for `/fetch-list` scraping — 1.5–3.5 s per lesson page, 3–6 s between courses
- [x] Document findings: CDN architecture, risk surface, recommended params — see `poc/03-findings.md`

---

## Phase 2: Core Commands

### `/setup` Command
- [x] Implement `lib/setup.js`: prompt for BBC Maestro email + password + root folder
- [x] Write `.env` to `~/.claude/plugins/maestro-downloader/` (MAESTRO_EMAIL, MAESTRO_PASSWORD, MAESTRO_ROOT)
- [x] Create folder structure: `<root>/courses/`, `<root>/index.html`, `<root>/index.json` (empty)
- [x] Validate credentials: attempt Playwright login, report success or error
- [x] Update `commands/setup.md` to reflect final implementation

### `/fetch-list` Command

- [x] Implement `lib/fetch-list.js`:
  - [x] Playwright login (stealth user-agent, 2-step email→password flow)
  - [x] Scrape `/courses` for all accessible course URLs (`vc-poster` cards)
  - [x] For each course: visit course page, extract title/instructor/categories/lesson links
  - [x] For each lesson: navigate to lesson page, intercept `.m3u8` network request to get `manifestUrl`
  - [x] Apply inter-page delay: `1500 + Math.random() * 2000` ms between lessons
  - [x] Apply inter-course delay: `3000 + Math.random() * 3000` ms between courses
  - [x] Exponential backoff on HTTP 429/503: 10s → 20s → 40s → 80s → skip + warn
- [x] Merge logic: load existing `index.json`; preserve `completed`/`downloadedAt`/`localPath` on known videos; insert new videos with `completed: false`
- [x] Atomic write: write to `index.json.tmp`, rename to `index.json`
- [x] Update `commands/fetch-list.md` to reflect final implementation
- [x] Create `commands/fetch-list.md` stub in `.claude-plugin/plugin.json` command list — N/A: auto-discovered

### `/list` Command

- [x] Implement `lib/list.js`: read `index.json`, check `lastFetched` age
- [x] Stale cache warning if `lastFetched` absent or >30 days old
- [x] Empty cache error if `courses` is absent or empty → instruct user to run `/fetch-list`
- [x] Format output: course title + instructor, category breakdown with video count and completion count
- [x] Update `commands/list.md` to reflect final implementation

### `/download` Command

- [x] Implement `lib/download.js`:
  - [x] Accept course slug argument; look up course in `index.json`
  - [x] For each video (skip if `completed: true`):
    - [x] Derive 1080p variant URL: replace `.m3u8` → `_1080.m3u8` in `manifestUrl`
    - [x] Spawn ffmpeg: `-protocol_whitelist file,http,https,tcp,tls,crypto -i <url> -map 0:v:0 -map 0:a:0 -c:v libsvtav1 -crf 28 -preset 6 -c:a libopus -b:a 128k <output>.webm`
    - [x] On ffmpeg exit 0: set `completed: true`, `downloadedAt`, `localPath`; write `index.json`
    - [x] On ffmpeg HTTP error (429/503): exponential backoff 10s → 20s → 40s → abort
    - [x] Progress: log per-video status and running count
  - [x] `--quality 4k` flag: use master manifest directly (ffmpeg selects highest variant)
- [x] Support resume: load `index.json` before starting; skip `completed: true` entries
- [x] Update `commands/download.md` to reflect final implementation

### Register `/fetch-list` in plugin.json
- [x] Add `fetch-list` to the commands list in `.claude-plugin/plugin.json` — N/A: commands auto-discovered from `commands/*.md`; no commands array needed in plugin.json

---

## Phase 3: UI & Integration

### HTML UI (`ui/index.html`)
- [x] Master course index: read `index.json`, render course tiles with completion %
- [x] Query param routing:
  - [x] `?course=<slug>` → course detail (categories + video list with download status)
  - [x] `?video=<path>` → video player with HTML5 `<video>` element (`.webm`)
- [x] Navigation: master index → course view → video player
- [x] Styling: clean, responsive layout (tablet-friendly)

### Local Server
- [x] Simple Express server (`lib/serve.js`) serving `<root>/` with correct MIME type for `.webm`; `/serve` command added

### Integration Testing
- [ ] End-to-end: `/setup` → `/fetch-list` → `/list` → `/download` single video → open in browser (requires live BBC Maestro account; manual smoke only)
- [ ] Test resume: interrupt `/download`, rerun, verify only incomplete videos are downloaded (live account)
- [ ] Test `/fetch-list` additive merge: manually add a fake video to `index.json`, rerun, verify it's preserved (live account)
- [ ] Error handling: invalid credentials, network timeout, disk full (live account)

---

## Phase 4: Polish & Deployment

- [ ] User-friendly error messages for common failure modes
- [ ] Structured logging (debug for segment fetches, info for per-video progress, warn/error for failures)
- [ ] Register plugin in parent repo's `marketplace.json`
- [ ] Test on macOS and Linux

---

## Future (far-future, no timeline)

- [ ] Convert from a Claude Code plugin to a standalone locally-installed project (npm package or
  single binary). The plugin architecture was a convenient way to bootstrap, but the tool has no
  real dependency on the Claude Code runtime and would be more portable as a regular CLI.

---

## Notes

- **Secrets**: `.env` must never be committed; verify `.gitignore`
- **Browser session**: Keep Playwright browser open across all lesson page loads within a `/fetch-list` run to avoid repeated login
- **Logging levels**: debug for HTTP requests, info for per-video progress, warn/error for failures
- **`manifestUrl` never expires**: URLs captured during `/fetch-list` remain valid indefinitely (confirmed by POC — March 2026 URLs still valid in May 2026)
