# USER_TODO: maestro-downloader v2

Items the autonomous /yolo run cannot safely decide alone — these need your hands or judgment.

Format key: `[BLOCKING]` = no meaningful forward progress on related work; `[NON-BLOCKING]` = autonomous run is continuing with a documented assumption/stub.

---

- [ ] [BLOCKING] **Phase −1.1: Verify Plex Media Server build is ≥ 1.43.1.10512**

      Context: This is the load-bearing PMS version that (a) made the NFO Series agent read `<namedseason>` + `season.nfo` `<title>`/`<plot>`, and (b) fixed the "episodes without ids get no metadata" bug.
      Build .10512 specifically — being on a 1.43.1.x build older than .10512 silently breaks the metadata behavior the whole v2 layout depends on.
      Source: forums.plex.tv/t/plex-nfo-agent-forum-preview/936104.

      How to check: open Plex Web → Settings → General → "About" → confirm the build number.
      If older: update PMS before any Phase 0 POC work runs against your live server.

      Why human: requires looking at your Plex server's settings UI; autonomous run has no remote into Plex.

- [ ] [BLOCKING] **Phase 0: Plex POC — verify `<namedseason>` actually surfaces custom season titles on your server**

      Context: Phase 0 is a load-bearing POC that confirms Plex's behavior matches the docs *before* any production NFO writing.
      Autonomous run will produce the test artifacts in `poc/04-plex-nfo/` (hand-crafted minimal show with three `<namedseason>` tags + `Specials/` season + per-episode `<uniqueid>` tags), but the actual Plex library configuration + scan + visual verification must be done by you.

      What you'll need to do:

      1. Add `poc/04-plex-nfo/` as a new TV library in Plex.
      2. Set agent = **Plex NFO Series**, scanner = Plex TV Series Scanner.
      3. Enable BOTH checkboxes in Library → Advanced:
         - **"Use local Assets"** (topmost in agent order)
         - **"Use Season Titles"** ← *load-bearing; without this, `<namedseason>` is silently ignored*
         Source: forums.plex.tv/t/nfo-scanner-agent-should-respect-the-season-title-if-present/937977 (April 14, 2026 dev confirmation).
      4. Scan the library and check three things:
         - Each season shows its `<namedseason>` text (e.g. "Lessons", "Vocal Exercises → Breathing Fundamentals"), NOT "Season 1/2/3".
         - The Specials season displays + its s00e01 episode metadata reads from the NFO.
         - `poster.jpg` / `fanart.jpg` are picked up.
      5. Screenshot the result; drop it in `poc/04-plex-nfo/findings.md` (autonomous run will create the file skeleton).

      GO/NO-GO: if `<namedseason>` doesn't surface despite both checkboxes enabled, the honest degraded path is that seasons appear as "Season 1"/"Season 2" in Plex, and Jellyfin/Kodi still surface correct names via `season.nfo`. Plan documents the divergence and proceeds.

      Why human: requires hands-on Plex library config + visual screenshot verification. No way to script this end-to-end remotely.

- [ ] [BLOCKING] **Phase 1.7/1.8: Approve live `/fetch-list` re-crawl after scraper fix lands**

      Context: The current scraper is broken on multi-category courses (Eric Vetro indexed as 2 categories instead of 4; Owen O'Kane as 21 single-video pseudo-categories). v2 fixes this and the autonomous run will write the fix + tests against captured HTML fixtures.
      BUT running the live re-crawl against bbcmaestro.com is rate-limited, browses your live account, and touches your live `index.json` (39 GB / 556 completed downloads at risk if the merge logic regresses).

      You explicitly said "verify CAREFULLY" — autonomous run will not trigger the live re-fetch.

      What you'll need to do (after autonomous run signals Phases 1.5 + 1.9 are both implemented in `lib/fetch-list.js` — the new scraper *and* its post-fetch completion-count gate are part of the same file):

      1. Run `/fetch-list` against the 5 known-multi-category courses first (eric-vetro, alan-moore, mark-ronson, oliver-burkeman, owen-o-kane).
      2. Eyeball the resulting `index.json` to confirm the category trees look right.
      3. If OK: run `/fetch-list` for the rest of the 48 courses. Phase 1.9's automated post-fetch completion-count gate will abort + restore if `count(completed) != 556`.

      Why human: live network operation against your account with rate-limit risk + irreversible-merge risk on the 39 GB of existing data.

- [ ] [BLOCKING] **Phase 1.4: capture DOM fixtures from live BBC Maestro yourself**

      Context: Phase 1.5 (the scraper rewrite) needs HTML fixtures captured via `page.content()` after the BBC Maestro page renders. Crawling your live account (login + reCAPTCHA + session cookies + rate-limit risk) is something you trigger when ready, not the autonomous run.

      The helper script `lib/capture-fixtures.js` has shipped. To use it:

      1. Run `MAESTRO_EMAIL=... MAESTRO_PASSWORD=... node lib/capture-fixtures.js` (or rely on `.env` if /setup wrote those values). With no args it captures the 6 default courses (eric-vetro/singing, agatha-christie/writing, owen-o-kane/a-life-less-anxious, mark-ronson/music-production, alan-moore/writing-fiction, oliver-burkeman/time-management).
      2. Captures land at `tst/fixtures/<slug>.post-render.html` plus a `tst/fixtures/README.md`.
      3. Commit those: `git add tst/fixtures/ && /commit-commands:commit`.
      4. Resume the autonomous run; Phase 1.5 will TDD scrapeCoursePage against the captured HTML.

      Why human: live login + crawl against your account.

- [ ] [BLOCKING] **Phase 1.3 execution: run the schema v2 migration against live `~/xfer/maestro/index.json`**

      Context: One-shot migration that renames every `index` → `bbcMaestroIndex`, adds `subscribed`/`contentType` fields, and writes `schemaVersion: 2`. The script `lib/migrate-schema-v2.js` has shipped (with backup + Ajv validation + completion-count assertion). It refuses to run if validation fails or count regresses, and leaves the live file untouched on any error.

      What you'll need to do:

      1. Dry-run first: `MAESTRO_ROOT=~/xfer/maestro node lib/migrate-schema-v2.js --dry-run`. Read its output — it should say "completion count preserved: 556" and "passes v2 schema validation". The backup path it would write is printed.
      2. Real run: `MAESTRO_ROOT=~/xfer/maestro node lib/migrate-schema-v2.js`. Backup is automatic.
      3. Verify: `node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.MAESTRO_ROOT + '/index.json')).schemaVersion)"` should print `2`.

      Why human: the migration writes to the live file. Even with safety nets, mid-context-window-exhaustion would be hard to recover; you press the button.

- [ ] [BLOCKING] **Phase 3 `migrate.js --copy` and `--cleanup`: approve before running**

      Context: This phase reorganizes the 556 already-downloaded videos into the new Plex-compatible layout. Autonomous run will write the full migrate.js (plan/copy/verify/cleanup with lockfile, receipts, .copying staging+atomic-rename, 5% SHA-256 sampling) and run `node lib/migrate.js --plan` (read-only dry-run) so you can review every action.

      You explicitly said "verify CAREFULLY as we have days of dl and encode results there" — autonomous run will not execute `--copy` or `--cleanup`.

      What you'll need to do:

      1. Review the autonomous run's `--plan` output (will be linked from the corresponding commit).
      2. Run `node lib/migrate.js --copy` yourself. Keeps originals; only adds the new tree.
      3. Run `node lib/migrate.js --verify`. Reports per-course pass/fail; expect 100% for completed videos.
      4. Visually confirm in Plex (using Phase 0's library config) that 5 sample courses look right.
      5. ONLY THEN: run `node lib/migrate.js --cleanup`. Renames old `courses/` → `courses.deleted-YYYY-MM-DD/` (NOT `rm -rf`); you remove that manually after a final sanity check.

      Why human: irreversible file ops on 39 GB / 556 completed downloads — multi-day re-download cost if anything goes wrong. The plan was tournament-vetted for safety but the actual go/no-go decision must be yours.
