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
8. **Save → Scan now.**

## Expected result

- Each course appears as a TV show (e.g. *Sing Like the Stars – Eric Vetro*).
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
