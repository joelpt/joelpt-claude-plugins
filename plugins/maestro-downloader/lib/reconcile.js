#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson, deriveOutputPath, MIN_COMPLETE_FILE_BYTES } from './index-utils.js';
import { info, warn } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

// Returns { backfilled, alreadyComplete, missing } counts per course
export function reconcileCourse(course, root) {
  let backfilled = 0;
  let alreadyComplete = 0;
  let missing = 0;

  for (const cat of course.categories) {
    for (const video of cat.videos) {
      const expectedPath = deriveOutputPath(root, course.slug, cat.title, video.index, video.title);
      const onDisk = existsSync(expectedPath) && statSync(expectedPath).size >= MIN_COMPLETE_FILE_BYTES;

      if (video.completed) {
        alreadyComplete++;
        continue;
      }

      if (onDisk) {
        video.completed = true;
        video.downloadedAt = video.downloadedAt ?? new Date().toISOString();
        video.localPath = expectedPath;
        backfilled++;
      } else {
        missing++;
      }
    }
  }

  return { backfilled, alreadyComplete, missing };
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
  let totalMissing = 0;

  for (const course of (indexData.courses ?? [])) {
    const { backfilled, alreadyComplete, missing } = reconcileCourse(course, root);
    totalBackfilled += backfilled;
    totalAlready += alreadyComplete;
    totalMissing += missing;
    if (backfilled > 0) {
      info(`${course.slug}: backfilled ${backfilled} video(s)`);
    }
  }

  if (totalBackfilled > 0) {
    await atomicWriteJson(indexPath, indexData);
    info(`\nReconcile complete: ${totalBackfilled} backfilled, ${totalAlready} already marked, ${totalMissing} still missing on disk.`);
  } else {
    info(`Reconcile complete: nothing to backfill. ${totalAlready} already marked, ${totalMissing} still missing on disk.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
