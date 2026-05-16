#!/usr/bin/env node
/**
 * Phase 0 POC generator — Plex `<namedseason>` verification artifacts.
 *
 * Builds a minimal but structurally-real TV-show library under
 * `poc/04-plex-nfo/library/` that exercises every load-bearing v2 layout
 * feature the production `--copy` path will emit:
 *
 *   - `tvshow.nfo` with three `<namedseason>` tags + a Specials season + the
 *     course `<uniqueid type="bbcmaestro" default="true">`.
 *   - A subcategory tree so two seasons get hierarchical titles
 *     ("Vocal Exercises → Breathing Fundamentals" / "→ Articulation").
 *   - A `Specials/` (s00) season fed from a `/consent/`-titled `extras` leaf.
 *   - Per-episode `.nfo` sidecars with stable `<uniqueid>slug/sNNeMM</uniqueid>`.
 *   - `poster.jpg` + `fanart.jpg` at the show root (for "Use local Assets").
 *
 * CRITICAL: this script calls the SAME renderers production uses
 * (`lib/nfo.js`, `lib/layout.js`). If the POC verifies in Plex, the real
 * migration output is verified by construction — there is no separate
 * hand-written XML that could drift from what `--copy` writes.
 *
 * Media files are 1-second AV1/Opus WebM clips (same codecs as the real
 * download pipeline) so Plex actually ingests them as episodes. They are
 * regenerated on every run and git-ignored — only the generator + the
 * rendered-NFO snapshot are committed.
 *
 * Usage:  node poc/04-plex-nfo/generate.mjs
 * Requires: ffmpeg with libsvtav1 + libopus (the plugin's documented prereq).
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderTvShowNfo, renderSeasonNfo, renderEpisodeNfo } from '../../lib/nfo.js';
import { enumerateSeasons, deriveOutputPath, showDirPath, seasonDirPath } from '../../lib/layout.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(HERE, 'library');

/**
 * Synthetic course modelling the user's exact mental model: one show, with a
 * flat "Lessons" season, a two-deep "Vocal Exercises" subcategory tree, and a
 * consent intro that must land in Specials.
 */
const course = {
  slug: 'eric-vetro/sing-like-the-stars',
  title: 'Sing Like the Stars',
  instructor: 'Eric Vetro',
  description:
    'POC fixture course. Demonstrates custom-named Plex seasons via the NFO '
    + 'Series agent. Not a real BBC Maestro course.',
  category: 'Music',
  categories: [
    {
      // Title matches SPECIALS_TITLE (/consent/) AND videos are extras:true —
      // either alone routes to Specials; both proves the s00 path robustly.
      title: 'Consent',
      videos: [
        {
          title: 'Welcome and Consent',
          description: 'Course introduction and viewing consent. Belongs in Specials (s00).',
          downloadedAt: '2026-05-15T10:00:00Z',
          extras: true,
        },
      ],
    },
    {
      title: 'Lessons',
      videos: [
        { title: 'Finding Your Voice', description: 'Locating your natural vocal placement.', downloadedAt: '2026-05-15T10:01:00Z' },
        { title: 'Breath and Support', description: 'Diaphragmatic breathing for singers.', downloadedAt: '2026-05-15T10:02:00Z' },
        { title: 'Range and Registers', description: 'Chest, head, and mixed voice.', downloadedAt: '2026-05-15T10:03:00Z' },
      ],
    },
    {
      title: 'Vocal Exercises',
      subcategories: [
        {
          title: 'Breathing Fundamentals',
          videos: [
            { title: 'Diaphragm Activation', description: 'Engaging the diaphragm.', downloadedAt: '2026-05-15T10:04:00Z' },
            { title: 'Sustained Exhale', description: 'Controlled airflow drill.', downloadedAt: '2026-05-15T10:05:00Z' },
          ],
        },
        {
          title: 'Articulation',
          videos: [
            { title: 'Consonant Crispness', description: 'Crisp consonant onsets.', downloadedAt: '2026-05-15T10:06:00Z' },
            { title: 'Tongue Twisters', description: 'Diction agility drill.', downloadedAt: '2026-05-15T10:07:00Z' },
          ],
        },
      ],
    },
  ],
};

/** Make a 1-second solid-colour AV1/Opus WebM at `dest` (same codecs as the
 *  real download pipeline). */
function makeRefClip(dest) {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x1f6feb:s=320x180:d=1:r=10',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest',
    '-c:v', 'libsvtav1', '-crf', '50', '-preset', '8',
    '-c:a', 'libopus', '-b:a', '32k',
    dest,
  ]);
}

/** Make a solid-colour JPG (placeholder artwork) at `dest`. Distinct colours
 *  per asset so "Use local Assets" pickup is visually unambiguous in Plex. */
function makeJpg(dest, color, size) {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=1`,
    '-frames:v', '1', dest,
  ]);
}

function main() {
  if (existsSync(LIBRARY)) rmSync(LIBRARY, { recursive: true, force: true });
  mkdirSync(LIBRARY, { recursive: true });

  const seasons = enumerateSeasons(course);

  // --- tvshow.nfo + artwork at show root ---
  const showDir = showDirPath(LIBRARY, course);
  mkdirSync(showDir, { recursive: true });
  writeFileSync(join(showDir, 'tvshow.nfo'), renderTvShowNfo(course, seasons), 'utf8');
  makeJpg(join(showDir, 'poster.jpg'), '0x8957e5', '600x900');
  makeJpg(join(showDir, 'fanart.jpg'), '0x238636', '1920x1080');

  // --- one reference clip, copied per episode (one encode, many episodes) ---
  const refClip = join(HERE, '.ref.webm');
  makeRefClip(refClip);

  const snapshot = [];
  snapshot.push('# Phase 0 POC — rendered NFO snapshot');
  snapshot.push('');
  snapshot.push('Auto-generated by `generate.mjs` from the **production** renderers');
  snapshot.push('(`lib/nfo.js` + `lib/layout.js`). This file is the human-reviewable');
  snapshot.push('proof that the v2 layout emits correct `<namedseason>`/`<uniqueid>`');
  snapshot.push('XML; it is regenerated on every run and committed for diff review.');
  snapshot.push('');
  snapshot.push('## tvshow.nfo');
  snapshot.push('');
  snapshot.push('```xml');
  snapshot.push(renderTvShowNfo(course, seasons).trimEnd());
  snapshot.push('```');

  let episodeCount = 0;
  for (const season of seasons) {
    const seasonDir = seasonDirPath(LIBRARY, course, season);
    mkdirSync(seasonDir, { recursive: true });
    const seasonNfo = renderSeasonNfo(season);
    writeFileSync(join(seasonDir, 'season.nfo'), seasonNfo, 'utf8');
    snapshot.push('');
    snapshot.push(`## ${season.isSpecials ? 'Specials' : `Season ${String(season.seasonNumber).padStart(2, '0')}`} — "${season.title}" → season.nfo`);
    snapshot.push('');
    snapshot.push('```xml');
    snapshot.push(seasonNfo.trimEnd());
    snapshot.push('```');

    for (const ep of season.videos) {
      const webmPath = deriveOutputPath(LIBRARY, course, season, ep, 'webm');
      const nfoPath = deriveOutputPath(LIBRARY, course, season, ep, 'nfo');
      mkdirSync(dirname(webmPath), { recursive: true });
      copyFileSync(refClip, webmPath);
      const epNfo = renderEpisodeNfo(course, season, ep);
      writeFileSync(nfoPath, epNfo, 'utf8');
      episodeCount++;
    }
  }
  // Snapshot one representative episode NFO per season class (regular + specials).
  for (const season of seasons) {
    const ep = season.videos[0];
    snapshot.push('');
    snapshot.push(`## Sample episode.nfo — ${season.isSpecials ? 'Specials' : season.title} / ${ep.video.title}`);
    snapshot.push('');
    snapshot.push('```xml');
    snapshot.push(renderEpisodeNfo(course, season, ep).trimEnd());
    snapshot.push('```');
  }
  snapshot.push('');

  rmSync(refClip, { force: true });
  writeFileSync(join(HERE, 'expected-nfo-snapshot.md'), snapshot.join('\n'), 'utf8');

  const seasonLines = seasons
    .map((s) => `  - ${s.isSpecials ? 'Specials (s00)' : `Season ${String(s.seasonNumber).padStart(2, '0')}`}: "${s.title}" — ${s.videos.length} episode(s)`)
    .join('\n');
  process.stdout.write(
    `Generated POC library at:\n  ${LIBRARY}\n\n`
    + `Show: ${course.title} - ${course.instructor}\n`
    + `Seasons (${seasons.length}):\n${seasonLines}\n\n`
    + `Total episodes: ${episodeCount}\n`
    + `Rendered-NFO snapshot: poc/04-plex-nfo/expected-nfo-snapshot.md\n\n`
    + `Next: add ${LIBRARY} to Plex as a TV library and follow findings.md.\n`,
  );
}

main();
