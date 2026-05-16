# Plex setup for the maestro-downloader v2 library

This is the short checklist for adding `~/xfer/maestro` to your Plex Media Server as a TV Shows library with custom-named seasons.

## Prerequisites

1. **Plex Media Server build ≥ 1.43.1.10512.** Older 1.43.1.x builds silently ignore the NFO Series agent's `<namedseason>` tags and don't honour per-episode `<uniqueid>`. Check your build in Plex Web → Settings → General → About.
2. Phase 3 migration complete (or in-flight). Files must be at v2 paths under `~/xfer/maestro/<Course Title> - <Instructor>/Season NN/...`.
3. `tvshow.nfo` + `season.nfo` written for each course (the autonomous run writes these as part of `--copy`).

## Library configuration

1. Plex Web → **Settings → Library → Add Library**.
2. Type = **TV Shows**.
3. Add the folder `~/xfer/maestro`.
4. Click **Advanced**.
5. Agent = **Plex NFO Series**.
6. Scanner = **Plex TV Series Scanner**.
7. **Enable both checkboxes** (these are load-bearing):
   - **"Use local Assets"** — picks up `poster.jpg`, `fanart.jpg`, per-episode `.jpg` thumbnails.
   - **"Use Season Titles"** — without this, `<namedseason>` is silently ignored and Plex shows seasons as "Season 1", "Season 2", … instead of the custom titles. Source: <https://forums.plex.tv/t/nfo-scanner-agent-should-respect-the-season-title-if-present/937977> (April 2026 dev confirmation).
8. **Save**, then on the library run **Refresh All Metadata** — NOT "Scan Library Files".

## ⚠️ The agent gotcha (verified the hard way, 2026-05-16)

A new TV library defaults to Plex's **non-NFO** TV agent. The Plex TV Series *Scanner* still finds your files and parses `sNNeMM`/Specials correctly from the filenames, so episodes appear and **everything looks like it half-works** — but the show title comes from the *folder name*, episodes show as "Episode 1/2/3", and seasons show as "Season 1/2/3". This reads like a `<namedseason>` failure when it is actually just the wrong agent.

Two rules that make it work:

1. Agent **must** be explicitly set to **Plex NFO Series** (step 5). If that agent is not in the dropdown on your Plex build, NFO TV metadata is unavailable and you are on the degraded path below.
2. After changing the agent, you **must** run **Refresh All Metadata**. Changing the agent does *not* retroactively re-match already-scanned items, and a plain "Scan Library Files" will not fix them. (Removing and re-adding the library also works.)

Phase 0 POC confirmed: with the agent set correctly and metadata refreshed, all `<namedseason>` titles — including the two-level `Vocal Exercises → Breathing Fundamentals` form — surface correctly on PMS 1.43.1.10611.

## Expected result

- Each course appears as a TV show titled from `tvshow.nfo` `<title>` — the course title only (e.g. *Sing Like the Stars*), NOT the `<Course> - <Instructor>` folder name. The instructor appears via the `<actor>` credit, and the disk folder is still `Sing Like the Stars - Eric Vetro/` (Plex's scanner requirement); only the displayed title is NFO-driven. Confirmed in the Phase 0 POC.
- Seasons display with their leaf-category names, NOT "Season 1/2/3" — e.g. *Lessons*, *Vocal Exercises → Breathing Fundamentals*, *Vocal Exercises → Articulation*.
- Each episode's title and plot come from its `.nfo` sidecar.
- Course intro / consent / trailer videos appear under the **Specials** season (season 00).
- Per-episode `<uniqueid type="bbcmaestro">slug/sNNeMM</uniqueid>` keeps watch state stable across rescans.

## Jellyfin / Kodi cross-compatibility

The `season.nfo` files write `<title>` (and optional `<plot>`) but deliberately **omit `<seasonnumber>`** — Jellyfin issues [#11656](https://github.com/jellyfin/jellyfin/issues/11656) and [#11709](https://github.com/jellyfin/jellyfin/issues/11709) document that emitting `<seasonnumber>` causes rescan to overwrite the custom season title. The `tvshow.nfo`'s `<namedseason>` tags are Plex-specific; Jellyfin/Kodi pick the season title up from `season.nfo` instead.

## Degraded path (if `<namedseason>` doesn't work on your server)

If Plex shows your seasons as "Season 1/2/3" despite both checkboxes being enabled and PMS being ≥ 1.43.1.10512:

- The folders themselves CAN'T be renamed away from `Season NN` — Plex's TV Series Scanner requires that literal format.
- Jellyfin and Kodi will still show the correct names via `season.nfo`.
- File this as a Plex agent regression and document the workaround.

## Watch-state stability

Each episode `.nfo` carries `<uniqueid type="bbcmaestro" default="true">course.slug/sNNeMM</uniqueid>`. These IDs are deterministic from the course slug + leaf-category walk, so re-running migration or future scrapes produces the same IDs and your watched flags survive rescans (on the same Plex server).

Cross-server sync of watch state is a Plex feature that depends on its account-level metadata service. NFO-derived libraries inherit whatever Plex does for the underlying IDs.
