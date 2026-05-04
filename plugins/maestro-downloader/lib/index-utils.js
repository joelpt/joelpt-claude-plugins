import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const STALE_DAYS = 30;

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
