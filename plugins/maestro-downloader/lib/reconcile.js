#!/usr/bin/env node
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson, deriveOutputPath, isFileComplete } from './index-utils.js';
import { info, warn } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

// Returns counts AND per-item details for problem children:
//   backfilledItems:    [{ courseSlug, categoryTitle, videoIndex, videoTitle, path }]
//   partialResetItems:  [{ courseSlug, categoryTitle, videoIndex, videoTitle, path, reason }]
//                       reason is 'truncated' (file present, no Cues) or 'missing' (localPath gone).
export function reconcileCourse(course, root) {
  let alreadyComplete = 0;
  let missing = 0;
  const backfilledItems = [];
  const partialResetItems = [];

  for (const cat of course.categories) {
    for (const video of cat.videos) {
      const expectedPath = deriveOutputPath(root, course.slug, cat.title, video.index, video.title);
      const meta = {
        courseSlug: course.slug,
        categoryTitle: cat.title,
        videoIndex: video.index,
        videoTitle: video.title,
      };

      if (video.completed) {
        if (isFileComplete(video.localPath)) {
          alreadyComplete++;
        } else {
          const reason = video.localPath && existsSync(video.localPath) ? 'truncated' : 'missing';
          partialResetItems.push({ ...meta, path: video.localPath ?? expectedPath, reason });
          video.completed = false;
          video.downloadedAt = null;
          video.localPath = null;
        }
        continue;
      }

      if (isFileComplete(expectedPath)) {
        video.completed = true;
        video.downloadedAt = new Date().toISOString();
        video.localPath = expectedPath;
        backfilledItems.push({ ...meta, path: expectedPath });
      } else {
        missing++;
      }
    }
  }

  return {
    backfilled: backfilledItems.length,
    alreadyComplete,
    partialReset: partialResetItems.length,
    missing,
    backfilledItems,
    partialResetItems,
  };
}

// Walks the index post-reconcile and deletes any .webm at the expected path
// where the index says completed=false AND the file lacks a Cues trailer.
// These are leftovers from earlier runs whose ffmpeg exited 0 on a truncated
// output (pre-finalizePart bug) — they would otherwise sit unused until the
// next successful re-encode overwrites them. Returns deleted count + paths.
export function sweepOrphanedTruncatedWebms(indexData, root) {
  const deletedPaths = [];
  for (const course of (indexData.courses ?? [])) {
    for (const cat of (course.categories ?? [])) {
      for (const video of (cat.videos ?? [])) {
        if (video.completed) continue;
        const expectedPath = deriveOutputPath(root, course.slug, cat.title, video.index, video.title);
        if (existsSync(expectedPath) && !isFileComplete(expectedPath)) {
          try {
            unlinkSync(expectedPath);
            deletedPaths.push(expectedPath);
          } catch { /* ignore races */ }
        }
      }
    }
  }
  return { deleted: deletedPaths.length, deletedPaths };
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) { console.error('MAESTRO_ROOT not set. Run /setup first.'); process.exit(1); }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    console.error('No index.json found. Run /fetch-list first.');
    process.exit(1);
  }

  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    console.error('index.json is corrupted. Run /fetch-list to rebuild it.');
    process.exit(1);
  }

  let totalBackfilled = 0;
  let totalAlready = 0;
  let totalPartialReset = 0;
  let totalMissing = 0;

  for (const course of (indexData.courses ?? [])) {
    const { backfilled, alreadyComplete, partialReset, missing, backfilledItems, partialResetItems } = reconcileCourse(course, root);
    totalBackfilled += backfilled;
    totalAlready += alreadyComplete;
    totalPartialReset += partialReset;
    totalMissing += missing;
    for (const item of backfilledItems) {
      info(`  [backfill] ${item.courseSlug} :: ${item.videoIndex}. ${item.videoTitle} → ${item.path}`);
    }
    for (const item of partialResetItems) {
      warn(`  [reset:${item.reason}] ${item.courseSlug} :: ${item.videoIndex}. ${item.videoTitle} → ${item.path}`);
    }
  }

  const dirty = totalBackfilled > 0 || totalPartialReset > 0;
  if (dirty) {
    await atomicWriteJson(indexPath, indexData);
  }
  const parts = [
    totalBackfilled > 0 ? `${totalBackfilled} backfilled` : null,
    totalPartialReset > 0 ? `${totalPartialReset} partial reset` : null,
    `${totalAlready} already complete`,
    `${totalMissing} still missing`,
  ].filter(Boolean);
  info(`\nReconcile complete: ${parts.join(', ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
