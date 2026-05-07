import { writeFileSync, renameSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STALE_DAYS = 30;

// Minimum file size to consider a .webm complete. Below this the file is
// treated as a partial download (killed ffmpeg, disk-full abort, etc.).
export const MIN_COMPLETE_FILE_BYTES = 1_000_000;

export function mergeCourses(existing, fresh) {
  const existingBySlug = new Map(existing.map((c) => [c.slug, c]));
  const freshSlugs = new Set(fresh.map((c) => c.slug));

  const merged = fresh.map((freshCourse) => {
    const existingCourse = existingBySlug.get(freshCourse.slug);
    if (!existingCourse) {
      return {
        ...freshCourse,
        categories: freshCourse.categories.map((cat) => ({
          ...cat,
          videos: cat.videos.map((v) => ({
            ...v,
            completed: false,
            downloadedAt: null,
            localPath: null,
          })),
        })),
      };
    }

    const existingVideosByUrl = new Map();
    for (const cat of existingCourse.categories) {
      for (const v of cat.videos) {
        existingVideosByUrl.set(v.lessonUrl, v);
      }
    }

    return {
      ...freshCourse,
      contentType: existingCourse.contentType ?? freshCourse.contentType ?? 'default',
      categories: freshCourse.categories.map((cat) => ({
        ...cat,
        videos: cat.videos.map((v) => {
          const prev = existingVideosByUrl.get(v.lessonUrl);
          return {
            ...v,
            completed: prev?.completed ?? false,
            downloadedAt: prev?.downloadedAt ?? null,
            localPath: prev?.localPath ?? null,
          };
        }),
      })),
    };
  });

  for (const existingCourse of existing) {
    if (!freshSlugs.has(existingCourse.slug)) {
      merged.push(existingCourse);
    }
  }

  return merged;
}

export function atomicWriteJson(filepath, data) {
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
  const baseParams = 'lookahead=120:enable-overlays=1:enable-qm=1:qm-min=0:qm-max=15';

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
      resolution: '360p',
      crf: 42,
      preset: archive ? 3 : 6,
      audioBitrate: '48k',
      gopSize: 600,
      svtav1Params: baseParams,
      description: `360p lean (audio-primary)${archive ? ' (archive, slow)' : ''}`,
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
  args.push('-c:a', 'libopus', '-b:a', settings.audioBitrate, outputPath);
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
      if (contentStart < buf.length && buf[contentStart] === 0xbb) return true;
      searchFrom = pos + 1;
    }
    return false;
  } catch {
    return false;
  }
}

export function sanitizeFilename(name) {
  return name
    .replace(/:/g, '-')
    .replace(/[?*"<>|/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveOutputPath(root, slug, categoryTitle, videoIndex, videoTitle) {
  const safeCategory = sanitizeFilename(categoryTitle);
  const safeTitle = sanitizeFilename(videoTitle);
  return join(root, 'courses', slug, 'videos', safeCategory, `${videoIndex}-${safeTitle}.webm`);
}
