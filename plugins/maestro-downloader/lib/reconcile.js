#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson, deriveOutputPath, isFileComplete } from './index-utils.js';
import { info, warn } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

// Returns { backfilled, alreadyComplete, partialReset, missing } counts per course
export function reconcileCourse(course, root) {
  let backfilled = 0;
  let alreadyComplete = 0;
  let partialReset = 0;
  let missing = 0;

  for (const cat of course.categories) {
    for (const video of cat.videos) {
      const expectedPath = deriveOutputPath(root, course.slug, cat.title, video.index, video.title);

      if (video.completed) {
        if (isFileComplete(video.localPath)) {
          alreadyComplete++;
        } else {
          video.completed = false;
          video.downloadedAt = null;
          video.localPath = null;
          partialReset++;
        }
        continue;
      }

      if (isFileComplete(expectedPath)) {
        video.completed = true;
        video.downloadedAt = new Date().toISOString();
        video.localPath = expectedPath;
        backfilled++;
      } else {
        missing++;
      }
    }
  }

  return { backfilled, alreadyComplete, partialReset, missing };
}

async function main() {
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
    const { backfilled, alreadyComplete, partialReset, missing } = reconcileCourse(course, root);
    totalBackfilled += backfilled;
    totalAlready += alreadyComplete;
    totalPartialReset += partialReset;
    totalMissing += missing;
    if (backfilled > 0) info(`${course.slug}: backfilled ${backfilled} video(s)`);
    if (partialReset > 0) warn(`${course.slug}: reset ${partialReset} partial/missing video(s) for re-download`);
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
