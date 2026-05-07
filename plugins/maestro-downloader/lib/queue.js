#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { reconcileCourse, sweepOrphanedTruncatedWebms } from './reconcile.js';
import { atomicWriteJson } from './index-utils.js';
import { runCourse, sweepPartFiles } from './download.js';
import { info, warn, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

export const SLUGS = [
  'sir-billy-connolly/comedy',
  'eric-vetro/singing',
  'marco-pierre-white/delicious-vegetarian-cooking',
  'marco-pierre-white/delicious-food-cooked-simply',
  'steve-mann/dog-training',
  'gary-barlow/songwriting',
  'oliver-burkeman/time-management',
  'isabel-allende/magical-storytelling',
  'ken-follett/writing-bestselling-fiction',
  'steven-bartlett/start-and-scale-a-business',
  'jonathan-yeo/portrait-painting',
  'dr-rangan-chatterjee/a-blueprint-for-healthy-living',
  'agatha-christie/writing',
  'doreen-lawrence/finding-the-inner-strength',
  'stephanie-romiszewski/sleep-better',
  'owen-o-kane/a-life-less-anxious',
  'pierre-koffmann/classic-french-bistro-cooking',
  'mo-gawdat/happiness',
  'beata-heuman/interior-design',
  'vineet-bhatia/modern-indian-cooking',
  'richard-greene/public-speaking-and-communication',
  'marina-abramovic/the-art-of-being-present',
  'evy-poumpouras/the-art-of-influence',
  'james-nestor/the-power-of-your-breath',
  'professor-tim-spector/the-science-of-eating-well',
  'jo-malone-cbe/think-like-an-entrepreneur',
  'trinny-woodall/thriving-in-business',
  'peter-jones/toolkit-for-business-success',
];

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function log(msg) {
  info(`[${timestamp()}] ${msg}`);
}

export async function runReconcile(indexPath, root) {
  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    warn('Could not read index.json for reconcile — skipping');
    return;
  }

  let totalBackfilled = 0;
  let totalPartialReset = 0;
  let totalAlready = 0;
  let totalMissing = 0;
  let dirty = false;

  for (const course of (indexData.courses ?? [])) {
    const { backfilled, alreadyComplete, partialReset, missing, backfilledItems, partialResetItems } = reconcileCourse(course, root);
    totalBackfilled += backfilled;
    totalPartialReset += partialReset;
    totalAlready += alreadyComplete;
    totalMissing += missing;
    if (backfilled > 0 || partialReset > 0) dirty = true;
    for (const item of backfilledItems) {
      info(`  [backfill] ${item.courseSlug} :: ${item.videoIndex}. ${item.videoTitle} → ${item.path}`);
    }
    for (const item of partialResetItems) {
      warn(`  [reset:${item.reason}] ${item.courseSlug} :: ${item.videoIndex}. ${item.videoTitle} → ${item.path}`);
    }
  }

  if (dirty) await atomicWriteJson(indexPath, indexData);

  const parts = [
    totalBackfilled > 0 ? `${totalBackfilled} backfilled` : null,
    totalPartialReset > 0 ? `${totalPartialReset} partial reset` : null,
    `${totalAlready} already complete`,
    `${totalMissing} still missing`,
  ].filter(Boolean);
  info(`Reconcile complete: ${parts.join(', ')}.`);
  return indexData;
}

async function main() {
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) { error('MAESTRO_ROOT not set. Run /setup first.'); process.exit(1); }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) { error('No index.json found. Run /fetch-list first.'); process.exit(1); }

  // First press: abort cleanly after current video. Second press: force exit.
  const ac = new AbortController();
  let cancelCount = 0;
  process.on('SIGINT', () => {
    cancelCount++;
    if (cancelCount >= 2) { warn('\nForce exit.'); process.exit(130); }
    ac.abort();
    warn('\nCancelled — finishing current video, then stopping. (Ctrl-C again to force exit)');
  });

  const total = SLUGS.length;
  let done = 0;
  let failed = 0;

  log(`Queue started (${total} courses, resumable — completed videos will be skipped).`);

  const swept = sweepPartFiles(root);
  if (swept > 0) info(`Swept ${swept} orphaned .part file(s) from previous interrupted download(s)`);

  // Pre-flight: reconcile index against disk, then delete leftover truncated
  // .webm files. Catches falsely-completed entries and frees their disk space
  // before re-download. Logs each problem child so the user can see what was
  // wrong with the prior state.
  log('Running pre-flight reconcile against disk state...');
  const reconciledIndex = await runReconcile(indexPath, root);
  if (reconciledIndex) {
    const { deleted, deletedPaths } = sweepOrphanedTruncatedWebms(reconciledIndex, root);
    for (const p of deletedPaths) warn(`  [delete] orphan truncated .webm: ${p}`);
    if (deleted > 0) info(`Swept ${deleted} orphan truncated .webm file(s) flagged by reconcile`);
  }

  for (const slug of SLUGS) {
    if (ac.signal.aborted) break;

    log(`▶ Starting ${slug} (${done + failed + 1}/${total})`);

    await runCourse(slug, root, indexPath, { signal: ac.signal });

    if (ac.signal.aborted) break;

    log(`✓ Completed ${slug}`);
    done++;

    await runReconcile(indexPath, root);
    log('  reconcile: ok');
  }

  if (ac.signal.aborted) {
    log(`Queue cancelled. ${done} completed, ${failed} failed.`);
    process.exit(130);
  } else {
    log(`Queue complete. ${done} succeeded, ${failed} failed.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
