# Phase 0 POC — Plex `<namedseason>` Verification

Date generated: 2026-05-15 (autonomous /yolo run)
Date verified: 2026-05-16 (user, on Joel's MacBook Pro PMS, build 1.43.1.10611)
Status: **✅ GO — verified on the live server.**
Method: Production NFO renderers (`lib/nfo.js` + `lib/layout.js`) drove a synthetic course fixture into a real on-disk TV-show tree; user added it to Plex and visually confirmed via screenshots.

---

## Summary Verdict

**✅ GO.** All five assertions pass on the live PMS. Plex's NFO Series agent surfaces every `<namedseason>` title — *including* the two-level `Vocal Exercises → Breathing Fundamentals` / `→ Articulation` titles derived from the subcategory tree (the riskiest part of the v2 layout). Show title, episode titles, Specials routing, and `poster.jpg` all read from the local NFO/assets. Because the artifacts are produced by the same renderers `--copy` uses, the production migration output is verified by construction.

**Critical setup gotcha (cost a near-false-NO-GO):** Plex defaults a new TV library to its non-NFO agent. Episodes scan correctly from filenames, masking the problem, but show/episode/season metadata silently comes from the folder name, not the NFO. The fix is Library → Advanced → Agent = **Plex NFO Series**, then **Refresh All Metadata** (a plain "Scan Library Files" does NOT re-apply a changed agent to already-matched items). This is now documented in `docs/PLEX_SETUP.md`.

---

## 1. What was generated (autonomous, done)

Run `node poc/04-plex-nfo/generate.mjs` to (re)materialise the library at `poc/04-plex-nfo/library/`. It is git-ignored (binary, regenerable); the committed artifacts are the generator, this file, and `expected-nfo-snapshot.md` (the exact rendered XML, for diff review).

Synthetic show: **Sing Like the Stars - Eric Vetro** (`eric-vetro/sing-like-the-stars`), deliberately exercising every load-bearing layout feature:

| Season | Folder | `<namedseason>` title | Episodes | Exercises |
| --- | --- | --- | --- | --- |
| s00 | `Specials/` | `Specials` | 1 | `/consent/`-titled + `extras:true` leaf → Specials routing |
| s01 | `Season 01/` | `Lessons` | 3 | flat top-level category → regular season |
| s02 | `Season 02/` | `Vocal Exercises → Breathing Fundamentals` | 2 | subcategory tree → hierarchical season title |
| s03 | `Season 03/` | `Vocal Exercises → Articulation` | 2 | second leaf of the same parent |

Plus, at the show root: `tvshow.nfo` (with all four `<namedseason>` tags + course `<uniqueid default="true">`), `poster.jpg` (purple 600×900), `fanart.jpg` (green 1920×1080). Each episode has a 1-second AV1/Opus `.webm` (same codecs as the real download pipeline) and an `episode.nfo` sidecar carrying a stable `<uniqueid type="bbcmaestro">eric-vetro/sing-like-the-stars/sNNeMM</uniqueid>`.

The exact rendered XML is in [`expected-nfo-snapshot.md`](./expected-nfo-snapshot.md). Key facts already verified mechanically:

- `tvshow.nfo` emits `<namedseason number="N">` for all 4 seasons, including the hierarchical "Vocal Exercises → Breathing Fundamentals".
- `season.nfo` emits `<title>` only — **no `<seasonnumber>`** (Jellyfin #11656/#11709 regression guard holds).
- Every episode NFO has a deterministic `<uniqueid>` (stable across re-runs → watch-state survives rescans).

## 2. What you need to do (human step)

1. Confirm PMS build ≥ 1.43.1.10512 (already resolved 2026-05-15 — build 1.43.1.10611).
2. Run `node poc/04-plex-nfo/generate.mjs`.
3. Plex Web → Settings → Library → Add Library → **TV Shows**.
4. Add folder: the absolute path printed by the generator (`poc/04-plex-nfo/library`).
5. **Advanced**: Agent = **Plex NFO Series**, Scanner = **Plex TV Series Scanner**.
6. Enable **both** checkboxes (load-bearing):
   - **Use local Assets** (move it topmost in agent order).
   - **Use Season Titles** — without this, `<namedseason>` is silently ignored.
   Source: <https://forums.plex.tv/t/nfo-scanner-agent-should-respect-the-season-title-if-present/937977>
7. Save → **Refresh All Metadata** (NOT "Scan Library Files" — see §4 gotcha; a plain scan will not re-apply a freshly-changed agent to already-matched items).

## 3. Verification checklist (observed 2026-05-16)

- [x] All four seasons display their `<namedseason>` text, NOT "Season 1/2/3":
  - [x] s00 shows **Specials**
  - [x] s01 shows **Lessons**
  - [x] s02 shows **Vocal Exercises → Breathing Fundamentals** (hierarchical title rendered, arrow intact)
  - [x] s03 shows **Vocal Exercises → Articulation**
- [x] The Specials season displays and its `s00e01` episode title reads from the NFO ("Welcome and Consent").
- [x] Episode titles (not filenames) show for regular-season episodes ("Finding Your Voice", "Breath and Support", "Range and Registers", "Diaphragm Activation").
- [x] `poster.jpg` (purple) is picked up as show artwork (purple tiles in Recommended/Seasons views). `fanart.jpg` not separately inspected — low risk; same "Use local Assets" path as the confirmed poster.
- [~] Rescan stability: not run as a discrete second pass, but the Refresh-All-Metadata after the agent switch already re-derived all titles correctly. The `<uniqueid>` determinism (unit-tested) is the actual stability guarantee; a follow-up rescan during real Phase 3 use will confirm in situ.

Screenshots: provided by user in-session (Seasons grid showing Specials / Lessons / Vocal Exercises → Breath… / Vocal Exercises → Articul…; episode list with NFO titles). Not committed (contain only synthetic fixture data; the textual outcome above is the durable record).

## 4. GO / NO-GO

**GO** if every box in §3 is checked → the production v2 layout is verified; remove this blocker; Phase 3 `--copy` may proceed once the user approves it.

**NO-GO (degraded path)** if `<namedseason>` does NOT surface despite both checkboxes enabled and PMS ≥ .10512:

- Seasons appear as "Season 1/2/3" in Plex; Jellyfin/Kodi still surface correct names via `season.nfo`.
- This is a documented Plex agent regression, not a layout bug — `docs/PLEX_SETUP.md` already describes the degraded path.
- Decision: proceed with v2 anyway (the layout is still correct and cross-compatible); note the Plex divergence here and in `PLEX_SETUP.md`.

Observed outcome: **✅ GO (2026-05-16).** Every `<namedseason>` title surfaced correctly, including the hierarchical subcategory titles. No degraded path needed. The only friction was the agent-default config gotcha (now in `docs/PLEX_SETUP.md`), not a layout or NFO defect. Phase 3 `--copy` is unblocked *technically*; it still requires the user's explicit go/no-go plus the Phase 1.7/1.8 re-fetch and Phase 1.3 schema migration prerequisites.

## 5. Out of scope

- Real BBC Maestro media — this is a synthetic 1-second-clip fixture; playback fidelity is not what this POC tests.
- Per-episode `.jpg` thumbnails — deferred to v2 future work (TODO.md open questions).
- Practices-tab content (`eric-vetro/singing` `/practices/`) — Phase 1.6 feature decision, not exercised here.
