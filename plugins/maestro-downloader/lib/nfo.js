import { create } from 'xmlbuilder2';
import { pad2 } from './layout.js';

const STUDIO = 'BBC Maestro';
const UNIQUE_TYPE = 'bbcmaestro';

/** Render `tvshow.nfo` (sits at the show folder root). Includes `<namedseason
 *  number=N>Title</namedseason>` entries (one per season) which is the load-
 *  bearing tag Plex NFO Series agent reads under "Use Season Titles".
 *  `seasons` is `enumerateSeasons(course)` output.
 */
export function renderTvShowNfo(course, seasons) {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('tvshow');
  root.ele('title').txt(course.title).up();
  if (course.description) root.ele('plot').txt(course.description).up();
  root.ele('studio').txt(STUDIO).up();
  if (Array.isArray(course.genres) && course.genres.length > 0) {
    for (const g of course.genres) root.ele('genre').txt(g).up();
  } else if (course.category) {
    root.ele('genre').txt(course.category).up();
  }
  if (course.instructor) {
    const actor = root.ele('actor');
    actor.ele('name').txt(course.instructor).up();
    actor.ele('role').txt('Instructor').up();
    if (course.instructorHeadshotUrl) actor.ele('thumb').txt(course.instructorHeadshotUrl).up();
    actor.up();
  }
  for (const s of seasons ?? []) {
    root.ele('namedseason', { number: String(s.seasonNumber) }).txt(s.title).up();
  }
  root.ele('uniqueid', { type: UNIQUE_TYPE, default: 'true' }).txt(course.slug).up();
  return root.end({ prettyPrint: true });
}

/** Render `season.nfo` (sits inside `Season NN/` or `Specials/`). For
 *  Jellyfin/Kodi cross-compat. MUST NOT emit `<seasonnumber>` — Jellyfin
 *  issues #11656 / #11709 document that this causes rescan to overwrite the
 *  season title back to "Season N". Plex itself mostly ignores season.nfo
 *  (Plex reads `<namedseason>` from tvshow.nfo); the title here exists for
 *  Jellyfin/Kodi only.
 */
export function renderSeasonNfo(season) {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('season');
  root.ele('title').txt(season.title).up();
  if (season.plot) root.ele('plot').txt(season.plot).up();
  return root.end({ prettyPrint: true });
}

/** Render per-episode `.nfo` (sits next to the `.webm`).
 *  MUST emit a stable `<uniqueid type="bbcmaestro">course.slug/sNNeMM</uniqueid>`.
 *  Per PMS .10512 fix, episodes without a uniqueid get filename-only metadata
 *  and lose plot/title on rescan.
 */
export function renderEpisodeNfo(course, season, episode) {
  const v = episode.video;
  const sn = pad2(season.seasonNumber);
  const en = pad2(episode.episodeNumber);
  const uid = `${course.slug}/s${sn}e${en}`;
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('episodedetails');
  root.ele('title').txt(v.title).up();
  root.ele('season').txt(String(season.seasonNumber)).up();
  root.ele('episode').txt(String(episode.episodeNumber)).up();
  if (v.description) root.ele('plot').txt(v.description).up();
  if (v.downloadedAt) {
    // Use the date portion of downloadedAt as <aired>. Stable and good enough
    // for sort order; precise air dates aren't published by BBC Maestro.
    const date = String(v.downloadedAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) root.ele('aired').txt(date).up();
  }
  root.ele('studio').txt(STUDIO).up();
  root.ele('uniqueid', { type: UNIQUE_TYPE }).txt(uid).up();
  return root.end({ prettyPrint: true });
}
