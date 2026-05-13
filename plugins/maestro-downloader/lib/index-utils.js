import { writeFileSync, renameSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateIndex } from './schema.js';

const STALE_DAYS = 30;

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
export function jitter(minMs, maxMs) { return Math.floor(minMs + Math.random() * (maxMs - minMs)); }

// Minimum file size to consider a .webm complete. Below this the file is
// treated as a partial download (killed ffmpeg, disk-full abort, etc.).
export const MIN_COMPLETE_FILE_BYTES = 1_000_000;

// Field classification for course-level merge. Keep this list explicit — it's
// the contract between the scraper (overwrites) and the user/runtime (preserved).
const COURSE_USER_STATE = ['subscribed', 'contentType'];

// Walk a category tree (with optional `subcategories[]`) and yield every
// video. Used both to build the lookup map and to enumerate fresh videos.
function* walkVideos(categories) {
  if (!Array.isArray(categories)) return;
  for (const cat of categories) {
    if (Array.isArray(cat.videos)) {
      for (const v of cat.videos) yield v;
    }
    if (Array.isArray(cat.subcategories)) {
      yield* walkVideos(cat.subcategories);
    }
  }
}

// Recursively rebuild a fresh category tree, merging user-state from the
// `existingVideosByUrl` map for any video whose lessonUrl matches.
function mergeCategoryTree(freshCategories, existingVideosByUrl) {
  if (!Array.isArray(freshCategories)) return freshCategories;
  return freshCategories.map((cat) => {
    const out = { ...cat };
    if (Array.isArray(cat.videos)) {
      out.videos = cat.videos.map((v) => {
        const prev = existingVideosByUrl.get(v.lessonUrl);
        return {
          ...v,
          completed: prev?.completed ?? false,
          downloadedAt: prev?.downloadedAt ?? null,
          localPath: prev?.localPath ?? null,
          ...(prev?.actualResolution != null && { actualResolution: prev.actualResolution }),
        };
      });
    }
    if (Array.isArray(cat.subcategories)) {
      out.subcategories = mergeCategoryTree(cat.subcategories, existingVideosByUrl);
    }
    return out;
  });
}

/**
 * Merge fresh-from-scrape course data with existing index data, preserving
 * user-state fields and overwriting scraper-state fields.
 *
 * Field classification (mirror in tests):
 *   Course-level user-state (preserve): subscribed, contentType
 *   Course-level scraper-state (overwrite): title, instructor, category, courseUrl,
 *     description, posterUrl, fanartUrl, instructorHeadshotUrl, categories
 *   Video-level user-state (preserve): completed, downloadedAt, localPath, actualResolution
 *   Video-level scraper-state (overwrite): title, lessonUrl, manifestUrl, bbcMaestroIndex, index
 *
 * Critical: walks BOTH `categories[].videos` AND `categories[].subcategories[].videos`
 * recursively. A video moving from `category[0].videos[X]` to `category[0].subcategories[0].videos[X]`
 * between scrapes must NOT lose its completion state (the v1 implementation had
 * this blind spot — the "highest-impact data-loss bug" the v2 rewrite addresses).
 */
// Defaults applied when neither the existing course nor the fresh scrape
// supplies a value. Required so v2 schema validation (which makes these fields
// `required` on Course) passes after the migration sets `schemaVersion: 2`.
const COURSE_USER_STATE_DEFAULTS = { subscribed: false, contentType: 'default' };

export function mergeCourses(existing, fresh) {
  const existingBySlug = new Map(existing.map((c) => [c.slug, c]));
  const freshSlugs = new Set(fresh.map((c) => c.slug));

  const merged = fresh.map((freshCourse) => {
    const existingCourse = existingBySlug.get(freshCourse.slug);
    const existingVideosByUrl = new Map();
    if (existingCourse) {
      for (const v of walkVideos(existingCourse.categories)) {
        // Duplicate lessonUrl: prefer a completed entry over a not-completed one
        // so completion state survives an upstream-corruption case.
        const prior = existingVideosByUrl.get(v.lessonUrl);
        if (!prior || (!prior.completed && v.completed)) existingVideosByUrl.set(v.lessonUrl, v);
      }
    }

    const out = { ...freshCourse, categories: mergeCategoryTree(freshCourse.categories, existingVideosByUrl) };
    // Preserve user-state from the existing course; fall back to fresh, then to defaults.
    for (const k of COURSE_USER_STATE) {
      const fromExisting = existingCourse?.[k];
      const fromFresh = freshCourse[k];
      out[k] = fromExisting ?? fromFresh ?? COURSE_USER_STATE_DEFAULTS[k];
    }
    return out;
  });

  for (const existingCourse of existing) {
    if (!freshSlugs.has(existingCourse.slug)) {
      merged.push(existingCourse);
    }
  }

  return merged;
}

/**
 * Read index.json from disk. If the file's `schemaVersion === 2`, validate
 * against the v2 schema and throw on failure. Pre-v2 files (no schemaVersion)
 * pass through untouched — the migration writes the first v2 file.
 */
export function loadIndex(filepath) {
  const raw = readFileSync(filepath, 'utf8');
  const data = JSON.parse(raw);
  if (data?.schemaVersion === 2) validateIndex(data);
  return data;
}

/**
 * Atomic write. If the payload declares `schemaVersion === 2`, validate first
 * and refuse to write on failure (prevents shipping a corrupt v2 index).
 * Pre-v2 payloads (no schemaVersion) pass through.
 */
export function atomicWriteJson(filepath, data) {
  if (data?.schemaVersion === 2) validateIndex(data);
  const tmp = filepath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filepath);
}

export function isStaleCache(lastFetched) {
  if (!lastFetched) return true;
  const age = Date.now() - new Date(lastFetched).getTime();
  return age > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export function derive1080pUrl(manifestUrl) {
  return manifestUrl.replace(/\.m3u8$/, '_1080.m3u8');
}

export function deriveManifestUrl(manifestUrl, resolution) {
  if (resolution === '2160p' || resolution === '4k') {
    return manifestUrl;
  }
  const suffix = resolution === '1080p' ? '_1080' : `_${resolution.replace('p', '')}`;
  return manifestUrl.replace(/\.m3u8$/, `${suffix}.m3u8`);
}

// svtav1Params: extra -svtav1-params string, or null
export function getEncoderSettings(profile, archive = false) {
  // lookahead=48: lower RAM/CPU vs 120, ~1–2% compression cost.
  // lp=8:pin=1: cap SVT-AV1 to 8 logical processors on a 10-core M1 Max.
  //   Under `taskpolicy -c utility` the scheduler prefers E-cores first, so this
  //   lands as 2 E-cores + 6 P-cores, leaving 2 P-cores free for foreground.
  const baseParams = 'lookahead=48:enable-overlays=1:enable-qm=1:qm-min=0:qm-max=15:lp=8:pin=1';

  const profiles = {
    // Default: speech-optimised 720p, transparent for talking-head content
    speech: {
      resolution: '720p',
      crf: 35,
      preset: archive ? 3 : 6,
      audioBitrate: '64k',
      gopSize: 300,
      svtav1Params: baseParams,
      description: `720p speech-optimised${archive ? ' (archive, slow)' : ''}`,
    },
    // Music/performance: full quality, preserve audio and visual fidelity
    music: {
      resolution: '1080p',
      crf: 30,
      preset: archive ? 3 : 6,
      audioBitrate: '128k',
      gopSize: 120,
      svtav1Params: baseParams,
      description: `1080p music/performance${archive ? ' (archive, slow)' : ''}`,
    },
    // Visual: high visual detail matters (photography, painting, filmmaking, design)
    visual: {
      resolution: '1080p',
      crf: 31,
      preset: archive ? 3 : 6,
      audioBitrate: '96k',
      gopSize: 200,
      svtav1Params: baseParams,
      description: `1080p visual-detail${archive ? ' (archive, slow)' : ''}`,
    },
    // Lean: audio-primary content where visuals barely matter
    lean: {
      resolution: '720p',
      crf: 46,
      preset: archive ? 3 : 6,
      audioBitrate: '48k',
      gopSize: 600,
      svtav1Params: baseParams,
      description: `720p lean (audio-primary)${archive ? ' (archive, slow)' : ''}`,
    },
  };

  return profiles[profile] || profiles.speech;
}

// Resolve content type tag → profile name using env var overrides
export function profileForContentType(contentType, env = process.env) {
  const tag = (contentType || 'default').toLowerCase();
  const envKey = `MAESTRO_PROFILE_${tag.toUpperCase()}`;
  if (env[envKey]) return env[envKey];
  const defaults = { default: 'speech', music: 'music', visual: 'visual', lean: 'lean' };
  return defaults[tag] ?? 'speech';
}

export function buildFfmpegArgs(inputUrl, outputPath, settings) {
  const args = [
    '-y',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-timeout', '30000000',       // 30s socket read timeout — prevents infinite CDN segment hangs
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '5',
    '-i', inputUrl,
    '-map', '0:v:0',
    '-map', '0:a:0',
    '-c:v', 'libsvtav1',
    '-crf', String(settings.crf),
    '-preset', String(settings.preset),
    '-g', String(settings.gopSize),
  ];
  if (settings.svtav1Params) {
    args.push('-svtav1-params', settings.svtav1Params);
  }
  args.push('-c:a', 'libopus', '-b:a', settings.audioBitrate, '-f', 'matroska', outputPath);
  return args;
}

// Returns true if the WebM file contains a real Matroska Cues element in its
// last 200 KB. ffmpeg writes Cues only in mkv_write_trailer(); interrupted
// downloads never have it. A placeholder Cues stub sits at ~offset 102 in the
// header (EBMLVoid padding) and is intentionally excluded by searching only the
// tail. Files below MIN_COMPLETE_FILE_BYTES are treated as partial without read.
const CUES_ID = Buffer.from([0x1c, 0x53, 0xbb, 0x6b]);
const CUES_TAIL_BYTES = 204_800; // 200 KB
export function hasCompletionCues(filePath) {
  try {
    const size = statSync(filePath).size;
    if (size < MIN_COMPLETE_FILE_BYTES) return false;

    const readFrom = Math.max(0, size - CUES_TAIL_BYTES);
    const readSize = size - readFrom;
    const buf = Buffer.allocUnsafe(readSize);
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, readSize, readFrom);
    } finally {
      closeSync(fd);
    }

    let searchFrom = 0;
    while (searchFrom < buf.length) {
      const pos = buf.indexOf(CUES_ID, searchFrom);
      if (pos === -1) return false;
      // Parse EBML VINT length from the byte immediately after the 4-byte element ID
      if (pos + 4 >= buf.length) { searchFrom = pos + 1; continue; }
      const vintFirst = buf[pos + 4];
      let vintLen;
      if (vintFirst & 0x80) vintLen = 1;
      else if (vintFirst & 0x40) vintLen = 2;
      else if (vintFirst & 0x20) vintLen = 3;
      else vintLen = 4;
      const contentStart = pos + 4 + vintLen;
      // Require content byte to be a valid EBML ID start (>= 0x10 covers all
      // 4-byte, 3-byte, 2-byte, and 1-byte class IDs; rejects corrupt/empty content).
      if (contentStart < buf.length && buf[contentStart] >= 0x10) return true;
      searchFrom = pos + 1;
    }
    return false;
  } catch {
    return false;
  }
}

export function isFileComplete(filePath) {
  if (!filePath) return false;
  return hasCompletionCues(filePath);
}

export function sanitizeFilename(name) {
  return name
    .replace(/:/g, '-')
    .replace(/[?*"<>|/\\&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveOutputPath(root, slug, categoryTitle, videoIndex, videoTitle) {
  const safeCategory = sanitizeFilename(categoryTitle);
  const safeTitle = sanitizeFilename(videoTitle);
  return join(root, 'courses', slug, 'videos', safeCategory, `${videoIndex}-${safeTitle}.webm`);
}
