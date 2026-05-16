# USER_TODO: maestro-downloader v2

Items the autonomous /yolo run cannot safely decide alone — these need your hands or judgment.

Format key: `[BLOCKING]` = no meaningful forward progress on related work; `[NON-BLOCKING]` = autonomous run is continuing with a documented assumption/stub.

---

- [x] [BLOCKING] **Phase −1.1: Verify Plex Media Server build is ≥ 1.43.1.10512** — ✅ RESOLVED 2026-05-15

      RESOLUTION: User reported build `1.43.1.10611-1e34174b1`. Build counter `10611 ≥ 10512` → satisfied. The NFO Series agent `<namedseason>` + `season.nfo` `<title>`/`<plot>` reading and the "episodes without ids get no metadata" fix are both present on this build. Phase 0 POC may proceed against the live server.

      Context: This is the load-bearing PMS version that (a) made the NFO Series agent read `<namedseason>` + `season.nfo` `<title>`/`<plot>`, and (b) fixed the "episodes without ids get no metadata" bug.
      Build .10512 specifically — being on a 1.43.1.x build older than .10512 silently breaks the metadata behavior the whole v2 layout depends on.
      Source: forums.plex.tv/t/plex-nfo-agent-forum-preview/936104.

- [x] [BLOCKING] **Phase 0: Plex POC — verify `<namedseason>` surfaces custom season titles** — ✅ GO, RESOLVED 2026-05-16

      RESOLUTION: Verified live on the user's PMS (build 1.43.1.10611). Every `<namedseason>` title surfaced — Specials, Lessons, and the two hierarchical `Vocal Exercises → Breathing Fundamentals` / `→ Articulation` subcategory titles — plus show title, episode titles, Specials routing, and `poster.jpg`, all from local NFO/assets. No degraded path needed. Full record + the agent-default config gotcha in `poc/04-plex-nfo/findings.md`; gotcha baked into `docs/PLEX_SETUP.md`.

      KEY GOTCHA for the real Phase 3 migration: a new Plex TV library defaults to the non-NFO agent. The scanner still parses filenames so it *looks* half-working, but metadata comes from folder names. You MUST set Agent = **Plex NFO Series** AND run **Refresh All Metadata** (not "Scan Library Files") after changing it. Documented in `docs/PLEX_SETUP.md`.

- [ ] [BLOCKING] **Phase 1.7/1.8: Approve live `/fetch-list` re-crawl after scraper fix lands**

      Context (revised 2026-05-14 after Phase 1.5 landed): The empirical finding from the captured fixtures was that BBC Maestro course pages **do not expose category structure** for downloadable lessons — every course page is a single flat playlist.
      The old scraper's "multi-category" output for 5 courses was pure noise from h2/h3/h4 tags in unrelated page chrome (related-courses sidebar, instructor bio, customer reviews).
      The Phase 1.5 fix replaces the heading-walk heuristic with "always emit one `Lessons` category"; running `/fetch-list` against any course will now yield a 1-cat tree.

      The re-crawl is still rate-limited, browses your live account, and touches your live `index.json` (39 GB / 556 completed downloads).
      The merge logic in `mergeCourses` keys video preservation by `lessonUrl`, so completion state survives the category-count change for the 5 affected courses.

      You explicitly said "verify CAREFULLY" — autonomous run will not trigger the live re-fetch.

      What you'll need to do:

      1. Run `/fetch-list` against the 5 affected courses first (eric-vetro, mark-ronson, oliver-burkeman, owen-o-kane, alan-moore/storytelling).
      2. Confirm each lands in `index.json` as a single `Lessons` category with the correct lesson count (31, 18, 22, 22, 33 respectively).
      3. If OK: run `/fetch-list` for the rest. Phase 1.9's automated completion-count gate will abort + restore if `count(completed) != 556`.

      Out of scope for this phase: `eric-vetro/singing` has a separate `<div id="practices">` tab containing 18 sub-grouped practice videos (URL pattern `/courses/<slug>/practices/<group>/<item>`).
      The current scraper does not capture practices and the live index has 0 such entries — adding practices support is Phase 1.6 (a feature decision, not a fix).

      Why human: live network operation against your account with rate-limit risk + irreversible-merge risk on the 39 GB of existing data.

- [x] [BLOCKING] **Phase 1.4: capture DOM fixtures from live BBC Maestro yourself** — ✅ RESOLVED 2026-05-15

      RESOLUTION: Five post-render fixtures were captured and committed in `da1c0e0` (`tst/fixtures/{agatha-christie_writing, eric-vetro_singing, mark-ronson_music-production, oliver-burkeman_time-management, owen-o-kane_a-life-less-anxious}.post-render.html` + `tst/fixtures/README.md`). Phase 1.5's scraper rewrite shipped against them with 5 fixture-driven golden tests. Nothing further needed here.

      Context: Phase 1.5 (the scraper rewrite) needed HTML fixtures captured via `page.content()` after the BBC Maestro page renders. The helper script `lib/capture-fixtures.js` remains available for future re-captures if BBC Maestro changes their DOM.

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

- [ ] [NON-BLOCKING] **Phase 4: scope "user-friendly error messages for common failure modes"**

      Context: TODO.md Phase 4 carries this as a single unspecified bullet — no list of modes, no tone/detail target, no acceptance criteria. The autonomous run deliberately did NOT sweep it: mid-v2-transition is a poor time to rewrite v1 error paths that the v2 cutover may obsolete, and "user-friendly" / "which modes" are preference calls only you can make.

      What you'll need to decide:

      1. Which failure modes are worth polishing NOW vs. deferring until after the v2 migration lands. Suggested narrow first cut: missing/invalid env vars (`MAESTRO_ROOT`, `MAESTRO_EMAIL`/`MAESTRO_PASSWORD`), ffmpeg-not-on-PATH, BBC Maestro auth failure.
      2. Defer CDN/network/disk-full messages — those churn with the download/migration code and are better done post-v2.
      3. Tone/detail target (terse one-liner vs. actionable remediation hint).

      Why human: open-ended scope + tone is a personal-preference / external-context choice; no safe single autonomous interpretation. No code stub left — nothing was changed.
