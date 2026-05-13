import { join } from 'node:path';

/** Specials category title matcher (case-insensitive). */
const SPECIALS_TITLE = /^(consent|intro|trailer|preview)$/i;

/** Plex-safe sanitization for v2 paths and filenames. Preserves accents, strips
 *  filesystem-banned chars on Windows/macOS, normalizes whitespace, drops
 *  trailing dots (Windows quirk).
 */
export function sanitizeFilename(name) {
  return String(name)
    .normalize('NFC')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
}

/** Legacy sanitization (current rule, post-ampersand-strip fix). Files
 *  downloaded after the &-strip commit use this transform. Required during
 *  migration to reconstruct source paths.
 */
export function legacySanitizeFilename(name) {
  return String(name)
    .replace(/:/g, '-')
    .replace(/[?*"<>|/\\&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pre-ampersand-strip legacy sanitization. Files downloaded BEFORE the
 *  &-strip commit kept `&` in their names. Required by migration's
 *  best-effort fallback when the post-fix-rule path doesn't exist on disk.
 */
export function legacySanitizeFilenamePreAmpStrip(name) {
  return String(name)
    .replace(/:/g, '-')
    .replace(/[?*"<>|/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two-digit zero-padded season/episode number. */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Show folder name: `<safe(courseTitle)> - <safe(instructor)>`. */
export function showFolderName(course) {
  return `${sanitizeFilename(course.title)} - ${sanitizeFilename(course.instructor)}`;
}

/** Episode filename stem (no extension): `<show> - sNNeMM - <safe(title)>`. */
export function episodeFileName(showFolder, seasonNumber, episodeNumber, videoTitle) {
  const s = pad2(seasonNumber);
  const e = pad2(episodeNumber);
  return `${showFolder} - s${s}e${e} - ${sanitizeFilename(videoTitle)}`;
}

/** Is a category a "Specials" leaf (s00) based on its title? */
function isSpecialsTitle(title) {
  return SPECIALS_TITLE.test(String(title).trim());
}

/** Is the video itself flagged as Specials (course intro/trailer/consent)? */
function isExtrasVideo(video) {
  return video?.extras === true;
}

/** Walks a category subtree in DFS pre-order and yields one entry per leaf
 *  category. `pathTitles` accumulates parent titles so the returned `title`
 *  shows hierarchy (e.g. "Vocal Exercises → Breathing Fundamentals").
 *  Yields `{ rawTitle, displayTitle, videos[] }`.
 */
function* walkLeafCategories(categories, pathTitles = []) {
  if (!Array.isArray(categories)) return;
  for (const cat of categories) {
    const titleChain = [...pathTitles, cat.title];
    const hasSubs = Array.isArray(cat.subcategories) && cat.subcategories.length > 0;
    const hasVideos = Array.isArray(cat.videos) && cat.videos.length > 0;
    if (hasSubs) {
      yield* walkLeafCategories(cat.subcategories, titleChain);
    } else if (hasVideos) {
      yield {
        rawTitle: cat.title,
        displayTitle: titleChain.join(' → '),
        videos: cat.videos,
      };
    }
    // categories with neither subs nor videos are skipped (schema disallows them anyway)
  }
}

/** Compute the deterministic season list for a course.
 *  Returns ordered array of `{ seasonNumber, title, rawTitle, isSpecials, videos: [{episodeNumber, video}] }`.
 *  Rules:
 *    - Walk leaf categories DFS pre-order.
 *    - For each leaf: if its title matches SPECIALS_TITLE OR every video is `extras:true`,
 *      its videos go into Specials (s00). Otherwise the leaf becomes a regular season.
 *    - Regular seasons numbered 01, 02, ... in walk order.
 *    - Specials are accumulated across the course; if any specials videos exist,
 *      one Specials entry (seasonNumber 0) is prepended.
 *    - Within each season, episodes numbered 01, 02, ... in the order videos appear.
 *    - Individual `extras:true` videos inside a non-specials leaf are pulled OUT
 *      of that season into Specials.
 */
export function enumerateSeasons(course) {
  const specialsVideos = [];
  const regularSeasons = [];

  for (const leaf of walkLeafCategories(course.categories ?? [])) {
    const leafIsSpecials = isSpecialsTitle(leaf.rawTitle) || (leaf.videos.length > 0 && leaf.videos.every(isExtrasVideo));
    if (leafIsSpecials) {
      for (const v of leaf.videos) specialsVideos.push(v);
      continue;
    }
    const seasonVideos = [];
    for (const v of leaf.videos) {
      if (isExtrasVideo(v)) specialsVideos.push(v);
      else seasonVideos.push(v);
    }
    if (seasonVideos.length > 0) {
      regularSeasons.push({
        rawTitle: leaf.rawTitle,
        displayTitle: leaf.displayTitle,
        videos: seasonVideos,
      });
    }
  }

  const out = [];
  if (specialsVideos.length > 0) {
    out.push({
      seasonNumber: 0,
      title: 'Specials',
      rawTitle: 'Specials',
      isSpecials: true,
      videos: specialsVideos.map((v, i) => ({ episodeNumber: i + 1, video: v })),
    });
  }
  regularSeasons.forEach((s, i) => {
    out.push({
      seasonNumber: i + 1,
      title: s.displayTitle,
      rawTitle: s.rawTitle,
      isSpecials: false,
      videos: s.videos.map((v, j) => ({ episodeNumber: j + 1, video: v })),
    });
  });
  return out;
}

/** Full v2 absolute path for an episode file.
 *  `seasonInfo`: one entry from `enumerateSeasons()`.
 *  `episodeInfo`: one entry from `seasonInfo.videos[]`.
 *  `ext`: e.g. 'webm', 'nfo', 'jpg' (no leading dot).
 */
export function deriveOutputPath(root, course, seasonInfo, episodeInfo, ext) {
  const show = showFolderName(course);
  const seasonFolder = seasonInfo.isSpecials ? 'Specials' : `Season ${pad2(seasonInfo.seasonNumber)}`;
  const fileName = episodeFileName(show, seasonInfo.seasonNumber, episodeInfo.episodeNumber, episodeInfo.video.title);
  return join(root, show, seasonFolder, `${fileName}.${ext}`);
}

/** Show-folder absolute path (for tvshow.nfo, poster.jpg, fanart.jpg, etc.). */
export function showDirPath(root, course) {
  return join(root, showFolderName(course));
}

/** Season-folder absolute path (for season.nfo, SeasonNN.jpg, etc.). */
export function seasonDirPath(root, course, seasonInfo) {
  const folder = seasonInfo.isSpecials ? 'Specials' : `Season ${pad2(seasonInfo.seasonNumber)}`;
  return join(root, showFolderName(course), folder);
}

/** Reconstruct the OLD-LAYOUT path where a downloaded file currently lives,
 *  using the legacy sanitization rules. Required by Phase 3 migration to locate
 *  source files when `localPath` is null or for safety re-derivation.
 *  Old layout: `<root>/courses/<slug>/videos/<legacySafe(category)>/<index>-<legacySafe(title)>.webm`
 */
export function legacyDeriveOutputPath(root, slug, categoryTitle, videoIndex, videoTitle) {
  const cat = legacySanitizeFilename(categoryTitle);
  const title = legacySanitizeFilename(videoTitle);
  return join(root, 'courses', slug, 'videos', cat, `${videoIndex}-${title}.webm`);
}

/** Return BOTH legacy path candidates: current rule (strips &) and pre-fix
 *  rule (preserves &). Required because some files on disk were named under
 *  each rule depending on download date. Migration should try each via
 *  existsSync() and use whichever resolves.
 *  Returns `[postAmpStripPath, preAmpStripPath]`. Identical when title/cat
 *  contains no `&`.
 */
export function legacyDeriveOutputPathCandidates(root, slug, categoryTitle, videoIndex, videoTitle) {
  const postFix = legacyDeriveOutputPath(root, slug, categoryTitle, videoIndex, videoTitle);
  const catPre = legacySanitizeFilenamePreAmpStrip(categoryTitle);
  const titlePre = legacySanitizeFilenamePreAmpStrip(videoTitle);
  const preFix = join(root, 'courses', slug, 'videos', catPre, `${videoIndex}-${titlePre}.webm`);
  return preFix === postFix ? [postFix] : [postFix, preFix];
}
