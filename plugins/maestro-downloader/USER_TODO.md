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

      Context: Phase 1.4 needs HTML fixtures captured via `page.content()` after the BBC Maestro page renders, so Phase 1.5 can write the new scraper against real markup. Originally this was tagged "read-only autonomous" — that's wrong. It would crawl your live BBC Maestro account via Playwright (with login + reCAPTCHA + session cookies + rate-limit risk). Better that you trigger it yourself when ready.

      The autonomous run will write the helper script `lib/capture-fixtures.js` for you (commits separately). Then:

      1. Run `node lib/capture-fixtures.js` once — it logs in with your `.env` credentials, visits the 5 known-multi-category courses (eric-vetro, alan-moore, mark-ronson, oliver-burkeman, owen-o-kane) and 1 known-good control course, and saves `tst/fixtures/<slug>.post-render.html` for each.
      2. `git add tst/fixtures/ && /commit-commands:commit` the captured fixtures.
      3. Resume the autonomous run; Phase 1.5 (scrapeCoursePage rewrite) will use the fixtures as its test inputs.

      Why human: live login + crawl against your account, not something the autonomous run should initiate without your knowledge.

- [ ] [BLOCKING] **Phase 1.3 execution: run the schema v2 migration against live `~/xfer/maestro/index.json`**

      Context: Phase 1.3 is a one-shot migration that renames every `index` → `bbcMaestroIndex`, adds `subscribed`/`contentType` fields, and writes `schemaVersion: 2`. The autonomous run will write the migration code (with a built-in backup + post-migration `count(completed)==556` assertion + auto-restore on failure) but won't EXECUTE it on your live file.

      What you'll need to do:

      1. Review the autonomous run's `lib/migrate-schema-v2.js` (will land as part of Phase 1.3 commit).
      2. Run `node lib/migrate-schema-v2.js --dry-run` first; review the diff it prints.
      3. Run `node lib/migrate-schema-v2.js` for real. Backup is automatic; assertion auto-restores if it fails.
      4. Verify by running `node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.MAESTRO_ROOT + '/index.json')).schemaVersion)"` → should print `2`.

      Why human: the migration is one-shot against the live file; a half-applied state would be hard to recover even with backups (e.g., if context window exhausted mid-write). The autonomous run holds the code and the safety nets; you press the button.

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
