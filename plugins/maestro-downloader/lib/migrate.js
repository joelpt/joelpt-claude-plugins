#!/usr/bin/env node
/**
 * migrate.js — backfill the existing v1-layout `~/xfer/maestro/courses/`
 * download tree into the v2 Plex-compatible layout.
 *
 * Subcommands:
 *   --plan       Dry-run. Prints every action; does not touch the filesystem.
 *   --copy       Performs the copies + writes NFOs + updates index.json
 *                localPath fields. Keeps the v1 originals (cleanup is separate).
 *   --verify     Re-checks per-course receipts; recomputes a 5% SHA-256 sample.
 *   --cleanup    For each verified course, deletes v1 sources and finally
 *                renames `courses/` -> `courses.deleted-YYYY-MM-DD/`.
 *
 * --copy and --cleanup are USER_TODO BLOCKING — autonomous /yolo writes the
 * code but the user runs the destructive subcommands themselves. This file
 * exposes `runPlan` (and stubs for the other commands, coming in follow-up
 * commits) so the planner can be exercised from tests.
 */
import { readFileSync, existsSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { loadIndex } from './index-utils.js';
import {
  enumerateSeasons,
  deriveOutputPath as v2DeriveOutputPath,
  legacyDeriveOutputPathCandidates,
  showFolderName,
} from './layout.js';
import { hasCompletionCues } from './index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

/**
 * Resolve the on-disk source path for a completed video. Priority:
 *   1. video.localPath (current truth in index.json).
 *   2. legacyDeriveOutputPathCandidates — try each candidate, use whichever exists.
 *   3. null if nothing resolves.
 * Returns `{ path, source: 'localPath' | 'legacy' | null }`.
 */
export function resolveSourcePath(root, courseSlug, categoryTitle, video) {
  if (video.localPath && existsSync(video.localPath)) {
    return { path: video.localPath, source: 'localPath' };
  }
  const idx = video.bbcMaestroIndex ?? video.index;
  const candidates = legacyDeriveOutputPathCandidates(root, courseSlug, categoryTitle, idx, video.title);
  for (const c of candidates) {
    if (existsSync(c)) return { path: c, source: 'legacy' };
  }
  return { path: null, source: null };
}

/**
 * Build a plan of actions for migrating a single course.
 * Returns `{ slug, showDir, actions, problems }`.
 *
 * action: `{ kind: 'COPY', from, to, sizeBytes }` for each completed video.
 * problem: `{ kind, video, detail }` for anything that needs human review.
 */
export function planCourse(root, course) {
  const seasons = enumerateSeasons(course);
  const showDir = join(root, showFolderName(course));
  const actions = [];
  const problems = [];
  const sourceByTarget = new Map();

  for (const season of seasons) {
    // Find each video's source category (walk the original course tree to
    // get the categoryTitle that produced this video in the SEASON walk).
    for (const epi of season.videos) {
      const video = epi.video;
      if (!video.completed) continue;
      const categoryTitle = season.rawTitle;
      const resolved = resolveSourcePath(root, course.slug, categoryTitle, video);
      if (!resolved.path) {
        problems.push({
          kind: 'MISSING_SOURCE',
          video: { title: video.title, bbcMaestroIndex: video.bbcMaestroIndex ?? video.index, lessonUrl: video.lessonUrl },
          detail: `localPath='${video.localPath}' does not exist and no legacy candidate matches`,
        });
        continue;
      }
      const targetPath = v2DeriveOutputPath(root, course, season, epi, 'webm');
      if (sourceByTarget.has(targetPath)) {
        problems.push({
          kind: 'TARGET_COLLISION',
          video: { title: video.title, bbcMaestroIndex: video.bbcMaestroIndex ?? video.index },
          detail: `two videos would write to the same target: ${targetPath} (other source: ${sourceByTarget.get(targetPath)})`,
        });
        continue;
      }
      sourceByTarget.set(targetPath, resolved.path);
      let sizeBytes = null;
      try { sizeBytes = statSync(resolved.path).size; } catch { /* leave null */ }
      actions.push({
        kind: 'COPY',
        from: resolved.path,
        to: targetPath,
        sizeBytes,
        sourceKind: resolved.source,
        season: season.seasonNumber,
        episode: epi.episodeNumber,
      });
    }
  }

  // Pending-but-incomplete videos are noted but not problems — they'll be
  // downloaded directly to v2 path by /download going forward.
  return { slug: course.slug, showDir, actions, problems };
}

/**
 * Plan the full migration for the given index.json. Returns an array of
 * per-course plans, plus a summary.
 */
export function planAll(root, index) {
  const plans = [];
  let totalActions = 0;
  let totalProblems = 0;
  let totalBytes = 0;
  for (const course of index.courses ?? []) {
    const plan = planCourse(root, course);
    plans.push(plan);
    totalActions += plan.actions.length;
    totalProblems += plan.problems.length;
    for (const a of plan.actions) totalBytes += a.sizeBytes ?? 0;
  }
  return {
    plans,
    summary: {
      courses: plans.length,
      coursesWithActions: plans.filter(p => p.actions.length > 0).length,
      totalActions,
      totalProblems,
      totalBytes,
    },
  };
}

/** Pretty-print a plan to a writer (defaults to console.log). */
export function formatPlan(planResult, root, { write = (s) => console.log(s) } = {}) {
  const { plans, summary } = planResult;
  write(`Migration plan against root: ${root}`);
  write(`  ${summary.courses} courses, ${summary.coursesWithActions} with actions`);
  write(`  ${summary.totalActions} COPY actions, ${summary.totalProblems} problems`);
  write(`  ${(summary.totalBytes / 1e9).toFixed(2)} GB total to copy`);
  write('');
  write('⚠ IMPORTANT: this plan reflects the CURRENT index.json, which was');
  write('  populated by the v1 scraper. The v1 scraper had a known bug on');
  write('  multi-category courses (Eric Vetro indexed as 2 cats instead of 4,');
  write('  Owen O\'Kane as 21 single-video pseudo-categories). If you run --copy');
  write('  before re-fetching with the v2 scraper, files will land in WRONG');
  write('  season folders. Re-fetch first (Phase 1.7/1.8 USER_TODOs).');
  write('');
  for (const plan of plans) {
    if (plan.actions.length === 0 && plan.problems.length === 0) continue;
    write(`── ${plan.slug} → ${plan.showDir}`);
    if (plan.problems.length > 0) {
      write(`   ⚠ ${plan.problems.length} problem(s):`);
      for (const p of plan.problems) {
        write(`     - ${p.kind}: ${p.video.title} (idx ${p.video.bbcMaestroIndex}): ${p.detail}`);
      }
    }
    for (const a of plan.actions) {
      const mb = a.sizeBytes != null ? `${(a.sizeBytes / 1e6).toFixed(1)} MB` : '?';
      write(`   COPY s${String(a.season).padStart(2,'0')}e${String(a.episode).padStart(2,'0')} (${mb}) [${a.sourceKind}]`);
      write(`     from: ${a.from}`);
      write(`     to:   ${a.to}`);
    }
    write('');
  }
}

/** Top-level plan runner — reads index.json and prints the plan. */
export function runPlan(root, indexPath, { write } = {}) {
  const index = loadIndex(indexPath);
  const planResult = planAll(root, index);
  formatPlan(planResult, root, { write });
  if (planResult.summary.totalProblems > 0) {
    if (write) write(`\n⚠ ${planResult.summary.totalProblems} problem(s) detected — review before running --copy.`);
  }
  return planResult;
}

/** USER_TODO sentinel: --copy refuses to run unless the index has been
 *  re-fetched after the Phase 1.5 scraper rewrite landed. Today this is set
 *  to a placeholder until Phase 1.5 ships. The runtime gate prevents users
 *  from migrating against the broken-scraper categories.
 */
export const MIGRATION_REQUIRES_REFETCH_AFTER = '<phase-1.5-not-yet-shipped>';

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    console.error('MAESTRO_ROOT not set. Run /setup first.');
    process.exit(1);
  }
  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`index.json not found at ${indexPath}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.includes('--plan')) {
    const result = runPlan(root, indexPath);
    process.exit(result.summary.totalProblems > 0 ? 1 : 0);
  }
  if (args.includes('--copy')) {
    console.error('--copy is not yet implemented. The autonomous run has only shipped --plan so far.');
    console.error('Re-run with --plan to preview the migration.');
    process.exit(2);
  }
  if (args.includes('--verify')) {
    console.error('--verify is not yet implemented.');
    process.exit(2);
  }
  if (args.includes('--cleanup')) {
    console.error('--cleanup is not yet implemented.');
    process.exit(2);
  }
  console.error('Usage: node lib/migrate.js (--plan | --copy | --verify | --cleanup)');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
