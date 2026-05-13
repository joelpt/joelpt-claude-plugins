#!/usr/bin/env node
/**
 * migrate-schema-v2.js — one-shot upgrade of `<root>/index.json` from
 * pre-v2 shape to schemaVersion 2.
 *
 * What it does, in order:
 *   1. Read `<root>/index.json`.
 *   2. Write a timestamped backup at `<root>/index.json.v1-snapshot.<ISO>`.
 *   3. Walk every video (including subcategories[].videos if present):
 *        - Rename `index` → `bbcMaestroIndex` (preserve value).
 *        - Leave `completed`, `downloadedAt`, `localPath`, `actualResolution` untouched.
 *   4. For every course:
 *        - Add `subscribed: true` if any video is completed, else `subscribed: false`.
 *        - Add `contentType: 'default'` if missing.
 *   5. Add top-level `schemaVersion: 2`.
 *   6. Validate the migrated index against the v2 schema. On failure, log
 *      every error and ABORT without touching the live file.
 *   7. Assert `count(completed === true)` equals the pre-migration count.
 *      On mismatch, ABORT without writing.
 *   8. Atomic-write the new index.json.
 *
 * Usage:
 *   node lib/migrate-schema-v2.js --dry-run    # parse, transform, validate, but do not write
 *   node lib/migrate-schema-v2.js              # the real thing (backup + write)
 *
 * Refuses to run if the index already declares `schemaVersion: 2` unless
 * `--force` is passed.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson } from './index-utils.js';
import { validateIndex, indexErrors } from './schema.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

/** Walk a category tree (with optional `subcategories[]`) yielding every video. */
function* walkVideos(categories) {
  if (!Array.isArray(categories)) return;
  for (const cat of categories) {
    if (Array.isArray(cat.videos)) for (const v of cat.videos) yield v;
    if (Array.isArray(cat.subcategories)) yield* walkVideos(cat.subcategories);
  }
}

/** Recursively transform a category tree: rename `index` → `bbcMaestroIndex`
 *  on every video. Returns a NEW tree (does not mutate input).
 */
function transformCategories(categories) {
  if (!Array.isArray(categories)) return categories;
  return categories.map((cat) => {
    const out = { ...cat };
    if (Array.isArray(cat.videos)) {
      out.videos = cat.videos.map(transformVideo);
    }
    if (Array.isArray(cat.subcategories)) {
      out.subcategories = transformCategories(cat.subcategories);
    }
    return out;
  });
}

function transformVideo(v) {
  const out = { ...v };
  if (out.bbcMaestroIndex === undefined && out.index !== undefined) {
    out.bbcMaestroIndex = out.index;
    delete out.index;
  }
  // Normalise non-required fields that the v2 schema rejects when undefined.
  if (out.completed === undefined) out.completed = false;
  if (out.downloadedAt === undefined) out.downloadedAt = null;
  if (out.localPath === undefined) out.localPath = null;
  return out;
}

/**
 * Pure transform: take a pre-v2 index object and return its v2-shaped twin.
 * Does NOT validate — caller does that after.
 */
export function migrateIndexToV2(input) {
  const out = {
    schemaVersion: 2,
    lastFetched: input.lastFetched ?? new Date(0).toISOString(),
    courses: (input.courses ?? []).map((course) => {
      const transformedCats = transformCategories(course.categories);
      const allVideos = [...walkVideos(transformedCats)];
      const anyCompleted = allVideos.some((v) => v.completed === true);
      const next = {
        ...course,
        categories: transformedCats,
        // Course-level user-state defaults (only set if missing on input).
        subscribed: course.subscribed ?? anyCompleted,
        contentType: course.contentType ?? 'default',
      };
      return next;
    }),
  };
  return out;
}

/** Count `completed === true` videos across the whole catalogue (any depth). */
export function countCompleted(index) {
  let n = 0;
  for (const c of index.courses ?? []) {
    for (const v of walkVideos(c.categories)) {
      if (v.completed === true) n++;
    }
  }
  return n;
}

/**
 * Top-level driver. Returns `{ migrated, countBefore, countAfter, backupPath,
 * indexPath }`. Throws on validation failure or completion-count regression.
 */
export function run({ indexPath, dryRun = false, force = false, write = (s) => console.log(s) } = {}) {
  const raw = readFileSync(indexPath, 'utf8');
  const before = JSON.parse(raw);
  if (before.schemaVersion === 2 && !force) {
    throw new Error(`index.json already declares schemaVersion: 2. Re-run with --force to migrate again.`);
  }

  const countBefore = countCompleted(before);
  write(`Pre-migration completed count: ${countBefore}`);

  // Always take a fresh backup BEFORE attempting any transform — even in
  // dry-run mode we copy the file, because users will want a checkpoint
  // even from the dry run.
  const backupPath = `${indexPath}.v1-snapshot.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (!dryRun) {
    copyFileSync(indexPath, backupPath);
    write(`Backup written: ${backupPath}`);
  } else {
    write(`(dry-run) would write backup: ${backupPath}`);
  }

  const migrated = migrateIndexToV2(before);

  // Validate.
  const errs = indexErrors(migrated);
  if (errs) {
    write(`✗ Migrated index FAILS v2 schema validation. Aborting.`);
    for (const e of errs.slice(0, 20)) {
      write(`  ${e.instancePath || '/'}: ${e.message}`);
    }
    if (errs.length > 20) write(`  ... and ${errs.length - 20} more error(s)`);
    throw new Error('schema validation failed; live file is untouched');
  }
  write('✓ Migrated index passes v2 schema validation');

  // Count assertion.
  const countAfter = countCompleted(migrated);
  if (countAfter !== countBefore) {
    write(`✗ Completion-count regression: ${countBefore} → ${countAfter}`);
    throw new Error(`completion count changed across migration (${countBefore} → ${countAfter}); live file is untouched`);
  }
  write(`✓ Completion count preserved: ${countAfter}`);

  if (dryRun) {
    write(`(dry-run) would write ${indexPath}; no changes made to disk`);
  } else {
    atomicWriteJson(indexPath, migrated);
    write(`✓ Wrote migrated index: ${indexPath}`);
  }
  return { migrated, countBefore, countAfter, backupPath, indexPath };
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    console.error('MAESTRO_ROOT not set. Run /setup first.');
    process.exit(1);
  }
  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`No index.json at ${indexPath}`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  try {
    run({ indexPath, dryRun, force });
  } catch (e) {
    console.error(`✗ Migration aborted: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
