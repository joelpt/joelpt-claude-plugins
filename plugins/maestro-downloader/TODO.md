# TODO: maestro-downloader Plugin

## v2 — Plex-Compatible Library + Standalone TUI Tool (IN PROGRESS)

**Plan file**: `/Users/joelthor/.claude/plans/i-want-to-change-robust-lampson.md`

### Why this rewrite

Current layout (`~/xfer/maestro/courses/<slug>/videos/<cat>/<idx>-<title>.webm`) works for the bespoke SPA but is opaque to Plex/Jellyfin.
The user wants `~/xfer/maestro` to mount as a Plex **TV Shows** library where each course is a show and each leaf category is a season with a custom name (e.g. Eric Vetro's *Lessons*, *Vocal Exercises → Breathing Fundamentals*, *Vocal Exercises → Articulation* each as their own named season).

Three additional concerns layer on:

1. **Scraper is broken on multi-category courses**: Eric Vetro indexed as `Lessons (1)` + `Eric Vetro (30)` — the scraper mis-read the instructor name as a category heading and missed Vocal Exercises entirely. Owen O'Kane has 21 single-video "categories". 5 of 48 courses have >1 category recorded, some right, some wrong.
1. **Backfill required**: 556 already-downloaded videos (≈39 GB, days of ffmpeg work) must reorganize WITHOUT re-encoding.
1. **Convert to standalone tool with Ink TUI**: `just run` opens a TUI for managing subscriptions, content types, rescans, and downloads.

### Architectural decision: TV-Shows-with-named-seasons (NFO Series agent), NOT TVDB matching

Research confirmed BBC Maestro is in TVDB as series 419867 with 47 seasons (each course = one season).
That would give free episode metadata via the standard TV Series agent, BUT it doesn't match the user's mental model ("each course as a show, each category as a season").
Sticking with custom NFO Series agent + `<namedseason>` per the plan.
Plex's TV Series Scanner is upstream and non-bypassable — `sXXeYY` filenames are mandatory even with the NFO agent.

### Tournament-vetted plan refinements (12 load-bearing fixes from /think round)

1. **Phase −1 preflight** (NEW): verify PMS ≥ **1.43.1.10512** (not just 1.43.1); lessonUrl-stability spot-check; fresh `index.json.pre-v2-migration` backup before any mutation. Cited evidence: forums.plex.tv/t/plex-nfo-agent-forum-preview/936104.
1. **Phase 0**: POC must enable BOTH "Use local Assets" AND **"Use Season Titles"** library checkboxes — the second is load-bearing and was missing from initial plan. Source: forums.plex.tv/t/nfo-scanner-agent-should-respect-the-season-title-if-present/937977 (2026-04-14 dev confirmation).
1. **Phase 1.2 mergeCourses fix**: rewrite to recurse into `subcategories[].videos`; explicit user-state vs scraper-state field-classification table; preserves new `subscribed` field. Existing code at `lib/index-utils.js:34-39` is the highest-impact data-loss bug.
1. **Phase 1.3**: fresh backup as first step; required schema fields (`completed`/`downloadedAt`/`localPath`); post-migration `count(completed)==556` assertion.
1. **Phase 1.4**: fixtures captured via `await page.content()` (post-render serialization), NOT raw HTTP response — must mirror what the in-browser `page.evaluate()` actually sees.
1. **Phase 1.9** (NEW): automated post-fetch completion-count gate; aborts + restores on regression.
1. **Phase 2.1 `legacyDeriveOutputPath`**: keep OLD sanitization (`:` → `-`, strip `&`) in layout.js for source-path reconstruction during migration. Do NOT delete the old function.
1. **Phase 2.2**: `renderSeasonNfo` MUST NOT emit `<seasonnumber>` — Jellyfin issue #11656/#11709 documents that this causes rescan to overwrite the season title. `renderEpisodeNfo` MUST emit stable `<uniqueid type="bbcmaestro">slug/sNNeMM</uniqueid>` per PMS .10512 fix.
1. **Phase 2.5** (NEW): mechanical refactor — move `dotenvConfig()` and `process.exit(1)` calls in lib/*.js OUT of module top level INTO `main()` / `runFromCli()`. Prerequisite for TUI imports.
1. **Phase 3.2**: pre-flight per-course assertion (`completed && localPath && file exists`) aborts on regression; `.copying` staging name + atomic rename for fs.copyFile correctness.
1. **Phase 3.3** (NEW): migration lockfile (`~/xfer/maestro/.migration/in-progress.lock`); `recordCompletion` refuses to write while migration in progress.
1. **Phase 5 trimmed**: subprocess-only TUI architecture (no in-process download → no stdout/Ink conflict); single home screen; FOUR features only (list, toggle subscribed, change content type, trigger rescan, trigger download). Cut: drill-in episode view, in-TUI playback, modals.

### Scope cuts applied

1. Don't materialize `episodeNumber`/`seasonNumber`/`extras` on disk — derive in `layout.js`.
1. SHA-256 only on 5% random sample during migration verify (size + `hasCompletionCues` cover the rest).
1. `ink-multi-select` dropped — checkbox toggle is just text + space-key handler.

### Scope kept (user-confirmed)

1. Artwork (poster.jpg, fanart.jpg) scraped during fetch — user said yes.
1. Two-phase re-fetch (5 known-buggy courses first, then all 48).
1. Web SPA updated for new layout.
1. Plex setup guide (one short checklist).
1. Dual-life plugin + standalone tool.

### User decisions captured

- Show folder format: `<Course Title> - <Instructor>/` (e.g. `Sing Like the Stars - Eric Vetro/`).
- Backfill mode: copy → verify CAREFULLY → delete originals (user emphasized "days of dl and encode results there").
- Web SPA: keep, update for new layout.
- Artwork: yes, scrape during fetch.
- TUI framework: Ink (Node.js) — same library Claude Code itself uses; staying in Node because Playwright is a hard requirement.

### Critical files to modify

| File | Action | Phase |
|---|---|---|
| `schema/index.schema.json` | NEW (Ajv) | 1 |
| `lib/schema.js` | NEW | 1 |
| `lib/index-utils.js:13-67` | REWRITE `mergeCourses` (subcategory recursion) | 1 |
| `lib/fetch-list.js:119-196` | REWRITE `scrapeCoursePage` (proper selectors, post-render fixtures) | 1 |
| `lib/layout.js` | NEW (pure functions: enumerateSeasons, deriveOutputPath, legacyDeriveOutputPath) | 2 |
| `lib/nfo.js` | NEW (xmlbuilder2 — tvshow.nfo/season.nfo/episode.nfo) | 2 |
| `lib/artwork.js` | NEW | 2 |
| `lib/download.js` | MODIFY (use layout.js; write episode.nfo on completion) | 2 |
| `lib/fetch-list.js`, `lib/queue.js`, `lib/setup.js`, `lib/list.js` | REFACTOR (remove import-time side effects) | 2.5 |
| `lib/migrate.js` | NEW (plan/copy/verify/cleanup with lockfile) | 3 |
| `ui/index.html`, `lib/serve.js` | MODIFY for new layout | 4 |
| `lib/tui/*.js` | NEW (Ink TUI, subprocess-only) | 5 |
| `lib/queue.js` | REFACTOR `runQueue` export | 5 |
| `Justfile` | `just run` → TUI | 5 |
| `package.json` | ADD ajv, ajv-formats, xmlbuilder2, ink, ink-select-input, ink-progress-bar, ink-spinner, ink-text-input | 1,2,5 |
| `docs/PLEX_SETUP.md` | NEW (short checklist) | 6 |
| `README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json` | UPDATE; bump to 0.2.0 | 6 |

### Pre-implementation state snapshot (verified 2026-05-13)

- 48 courses; 1,204 videos; 556 completed; **556/556 completed have valid `localPath` AND files exist on disk** ✓
- `mergeCourses` at `lib/index-utils.js:43` already preserves `contentType` at course level; does NOT preserve `subscribed` (new field) NOR recurse into subcategories (existing bug)
- Eric Vetro's course currently captured as just 2 categories: `Lessons (1)` (consent video) + `Eric Vetro (30)` — Vocal Exercises subcategories never scraped

### Open questions (resolve during implementation, not blockers)

1. PDF / "Class Guide" attachments — detect during Phase 1.6 fetch if present; defer if not trivial.
1. Instructor headshot for `<actor><thumb>` — best-effort during fetch.
1. WebVTT subtitles → `.eng.srt` sidecars — defer to v2 unless trivially available.
1. Episode `.jpg` thumbnails via ffmpeg frame-extraction — defer to v2.

### Goal state

Entire series of changes completed, vetted, tested. `just run` opens the Ink TUI. Plex library at `~/xfer/maestro` shows 48 courses as TV shows with custom-named seasons. 556 already-downloaded videos preserved across migration. JSON Schema validates `index.json` on every read/write. Web SPA still works as a no-Plex fallback.

### Progress log

Autonomous /yolo run on branch `worktree-maestro-v2-yolo`. Human-input gates tracked in `USER_TODO.md`.

- [x] Phase −1.4: fresh `index.json.pre-v2-migration.<ISO8601>` backup verified byte-identical to live `index.json` (2026-05-13).
- [x] Phase 1.1: `schema/index.schema.json` + `lib/schema.js` (Ajv 2020-12). 23 unit tests cover valid/invalid round-trips, contentType enum, slug pattern, video field requireds, oneOf mutex for `videos` XOR `subcategories`, subcategory recursion, `completed:true ⇒ localPath/downloadedAt non-null` invariant.
- [x] Phase 2.5: removed import-time side effects from 8 lib/*.js files — `dotenvConfig()` moved into each `main()`; `debugEnabled` in download.js became lazy `isDebugEnabled()`; `lib/fix-index.js` and `lib/tag-courses.js` gained the missing `if (process.argv[1] === fileURLToPath(import.meta.url))` CLI guard so their `main()` no longer runs unconditionally on import. Reviewer caught `lib/reconcile.js` (transitively imported by queue.js) was missed in the first pass — fixed. New `tst/no-import-side-effects.test.js` uses a tripwire `.env` (in a tempdir HOME with MAESTRO_TRIPWIRE=1) to definitively prove dotenv is NOT called at import time across all 8 lib modules. 215 tests pass.
- [x] Phase 2.1: `lib/layout.js` — pure functions: `sanitizeFilename`, `legacySanitizeFilename`, `legacySanitizeFilenamePreAmpStrip`, `pad2`, `showFolderName`, `episodeFileName`, `enumerateSeasons` (DFS-pre-order leaf walk with "X → Y" titles for subcategories; Specials detection via title regex OR `video.extras:true`), `deriveOutputPath` (full v2 path), `showDirPath`/`seasonDirPath`, `legacyDeriveOutputPath` (single path, current rule), `legacyDeriveOutputPathCandidates` (returns both post-fix and pre-amp-strip candidates — required because the sanitize rule changed mid-life; some files on disk have `&`, others don't). 32 unit tests including a golden test that passes against the real `~/xfer/maestro` index.json (verified: every recorded `localPath` is one of the candidates). 247 tests pass.
- [ ] Phase −1.1: PMS ≥ 1.43.1.10512 — BLOCKING in USER_TODO.md (needs your Plex UI).
- [ ] Phase −1.2: lessonUrl stability spot-check — pending (autonomous; needs Playwright).
- [ ] Phase 0: Plex `<namedseason>` POC — partially BLOCKING in USER_TODO.md (autonomous run will generate the artifacts; manual Plex config + screenshot is on you).
- [ ] Phase 1.4: live BBC Maestro DOM capture — moved to BLOCKING in USER_TODO.md after advisor flagged that autonomously crawling the live account is not safe. Autonomous run will write `lib/capture-fixtures.js`; you run it yourself.
- [ ] Phase 1.3 execution: schema v2 migration of live `index.json` — moved to BLOCKING in USER_TODO.md. Autonomous run writes `lib/migrate-schema-v2.js` with backup + assertion safety nets; you run it.
- [x] Phase 2.2: `lib/nfo.js` — `renderTvShowNfo` (with `<namedseason>` per season, course `<uniqueid type="bbcmaestro" default="true">slug</uniqueid>`, `<actor>` block with optional headshot, `<studio>BBC Maestro</studio>`), `renderSeasonNfo` (title + optional plot ONLY — explicit regression guard against emitting `<seasonnumber>` per Jellyfin #11656), `renderEpisodeNfo` (stable `<uniqueid type="bbcmaestro">slug/sNNeMM</uniqueid>`, `<aired>` from downloadedAt, `<season>`/`<episode>`). xmlbuilder2 ^4.0.3 (audit-clean). 17 unit tests covering well-formedness, escape, uniqueid stability, season-nfo regression guard. 264 tests pass.
- [x] Phase 2.3: `lib/artwork.js` — `downloadImage(url, destPath, {timeoutMs, fetchImpl})` (idempotent via content-length match; mkdir-p; AbortController timeout) and `downloadArtwork(course, showDir, opts)` (writes `poster.jpg`/`fanart.jpg` when URLs present; both skipped with reason='no-url' otherwise). 10 unit tests use stub-fetch fixtures; covers fresh download, idempotent skip, re-download on size mismatch, mkdir-p, HTTP error, network failure, full+partial artwork combos. 274 tests pass.
- [x] Phase 1.2: `mergeCourses` rewritten with recursive `walkVideos` + `mergeCategoryTree` helpers. Preserves user-state (`subscribed`, `contentType`, `completed`, `downloadedAt`, `localPath`, `actualResolution`) across cat↔subcat relocations at any depth; defaults `subscribed:false` and `contentType:'default'` on freshly-discovered courses so post-migration v2 writes don't reject. Duplicate-`lessonUrl` dedup prefers the completed entry. New `loadIndex(path)` and updated `atomicWriteJson` conditionally validate when `schemaVersion === 2` (pre-v2 writes pass through to avoid breaking the live system before Phase 1.3 migration runs). 11 new tests + 14 existing v1 tests all green. **Opus reviewer caught the forward-looking subscribed-undefined regression that would have broken the first post-migration write.** 285 tests pass.
- [x] Phase 2.4: wired `lib/layout.js` into `lib/download.js`. `runCourse` now iterates via `enumerateSeasons(course)` (picks up subcategories); computes output paths via `layout.deriveOutputPath` (new v2 layout); writes per-episode `.nfo` via `writeEpisodeNfoSidecar` after each successful download; calls `ensureShowMetadata(root, course, seasons)` once per course-run to idempotently write `tvshow.nfo` + per-season `season.nfo` + download `poster.jpg`/`fanart.jpg`. `recordCompletion` now recurses into subcategories via `findAndUpdateVideo`. **Removed deprecated `sanitizeFilename` + `deriveOutputPath` from `lib/index-utils.js`** — callers (reconcile.js, two test files) updated to use `layout.legacy*` aliases. New downloads land at v2 paths; old completed downloads stay at v1 paths in `localPath` until Phase 3 migration copies them. 285 tests pass.
- [WIP] Phase 3: lib/migrate.js (multi-commit). Landed so far:
  - `lib/migration-lock.js` + 12 tests — acquire/release with stale-PID detection via `process.kill(pid, 0)`; `blockedBecauseMigrating()` helper for `recordCompletion` integration.
  - `lib/migrate.js --plan` + 11 tests — pure planner: walks `enumerateSeasons` for each course; resolves sources via `video.localPath` (preferred) → `legacyDeriveOutputPathCandidates` (fallback); emits MISSING_SOURCE / TARGET_COLLISION problems for human review; formats a readable plan with a prominent warning that running --copy against pre-1.5-scraper data will land files in wrong season folders. **Live `--plan` against ~/xfer/maestro: 556 COPY actions, 0 problems, 40.92 GB — exactly matches the documented 556 completed videos.** Output saved at `poc/06-migrate-plan/initial-plan.txt`.
  - `lib/migrate.js --copy` + 7 tests — per-course atomic copy with `.copying` staging + fsync + size + `hasCompletionCues` + 5% SHA-256 sample receipts; pre-flight aborts on MISSING_SOURCE; idempotent (skip on existing receipt); writes `tvshow.nfo` + `season.nfo` + per-episode `.nfo`; updates `localPath` in index.json per course (resumable). **Refuses to run unless `--i-have-re-fetched` is set** while `MIGRATION_REQUIRES_REFETCH_AFTER === null` (Phase 1.5 placeholder); after Phase 1.5 ships the sentinel auto-checks `lastFetched`. Acquires migration lock; installs SIGINT/SIGTERM release handler.
  - `lib/migrate.js --verify` + `--cleanup` + 10 tests — verify re-checks every receipt action (existence + size + cues + 5% SHA-256 re-hash) and stamps `verifiedAt` on success. Cleanup only deletes v1 sources for courses whose `verifiedAt` is within 24h; once ALL receipts are clean, renames legacy `courses/` → `courses.deleted-YYYY-MM-DD/` (NOT `rm -rf` — user removes manually). Cleanup skips with NOT_VERIFIED / VERIFY_STALE / NO_RECEIPT reasons.
  - **Deferred**: lockfile→`recordCompletion` wire-up (one-line guard in download.js, will land in a follow-up commit when the user is preparing to actually run migrations). Opus review across all of migrate.js also deferred.

---

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
- [x] Structured logging (debug for segment fetches, info for per-video progress, warn/error for failures)
- [x] Register plugin in parent repo's `marketplace.json`
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
