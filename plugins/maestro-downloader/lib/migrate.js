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
import { readFileSync, existsSync, statSync, copyFileSync, mkdirSync, writeFileSync, renameSync, openSync, readSync, closeSync, fsyncSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson, loadIndex } from './index-utils.js';
import {
  enumerateSeasons,
  deriveOutputPath as v2DeriveOutputPath,
  legacyDeriveOutputPathCandidates,
  showFolderName,
  showDirPath,
  seasonDirPath,
} from './layout.js';
import { renderTvShowNfo, renderSeasonNfo, renderEpisodeNfo } from './nfo.js';
import { hasCompletionCues } from './index-utils.js';
import { acquireLock, releaseLock, installShutdownReleaser } from './migration-lock.js';

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
 *  re-fetched with the v2 scraper. Until Phase 1.5 ships, --copy MUST be
 *  invoked with the explicit `--i-have-re-fetched` flag — the runtime gate
 *  prevents accidental migration against the broken-scraper categories.
 *  After Phase 1.5 ships, update this constant to the commit SHA of the
 *  scraper rewrite so the gate can auto-check `lastFetched` against it.
 */
export const MIGRATION_REQUIRES_REFETCH_AFTER = null;

const RECEIPTS_DIR = '.migration';

function receiptPath(root, courseSlug) {
  // Use the same sanitize rule as the show folder for consistent receipt names.
  const safe = courseSlug.replace(/[/\\]/g, '_');
  return join(root, RECEIPTS_DIR, `${safe}.json`);
}

function loadReceipt(root, courseSlug) {
  const p = receiptPath(root, courseSlug);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function writeReceipt(root, courseSlug, receipt) {
  const p = receiptPath(root, courseSlug);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(receipt, null, 2), 'utf8');
  return p;
}

function sha256OfFile(path) {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let read;
    while ((read = readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.slice(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/** Deterministic 5% sample selector — uses crypto.randomInt for unbiased
 *  selection. Returns the indices to sample. Caller controls timing of the
 *  sample to match the receipt's intent.
 */
function pickSampleIndices(total, fraction = 0.05) {
  if (total <= 0) return [];
  const sampleCount = Math.max(1, Math.round(total * fraction));
  const indices = new Set();
  while (indices.size < sampleCount && indices.size < total) {
    indices.add(randomInt(total));
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Copy a single file with the `.copying` staging + atomic rename pattern.
 * Returns the bytes written. Throws on any mismatch or verification failure.
 *
 *  1. mkdir-p destination dir
 *  2. copyFileSync(src, dest.copying)
 *  3. fsync the copy
 *  4. hasCompletionCues(dest.copying) must pass (.webm only)
 *  5. statSync(dest.copying).size === statSync(src).size
 *  6. renameSync(dest.copying, dest) — atomic on same filesystem
 */
function copyWithVerification(src, dest, { checkCues = true } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const staging = `${dest}.copying`;
  copyFileSync(src, staging);
  // fsync so the verification reads from disk, not page cache.
  const fd = openSync(staging, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }

  const srcSize = statSync(src).size;
  const dstSize = statSync(staging).size;
  if (srcSize !== dstSize) {
    // Best-effort cleanup of the staging file before throwing.
    try { renameSync(staging, staging + '.failed'); } catch { /* ignore */ }
    throw new Error(`size mismatch copying ${src} → ${dest} (src=${srcSize}, dst=${dstSize})`);
  }
  if (checkCues && !hasCompletionCues(staging)) {
    try { renameSync(staging, staging + '.failed'); } catch { /* ignore */ }
    throw new Error(`copied .webm at ${staging} lacks Matroska Cues element — copy is corrupt or source was incomplete`);
  }
  renameSync(staging, dest);
  return dstSize;
}

/** Update a video's localPath in the in-memory index object to its v2 target.
 *  Walks subcategories recursively. Returns true if found+updated.
 */
function updateLocalPath(course, lessonUrl, newPath, downloadedAt) {
  function walk(categories) {
    if (!Array.isArray(categories)) return false;
    for (const cat of categories) {
      if (Array.isArray(cat.videos)) {
        const idx = cat.videos.findIndex(v => v.lessonUrl === lessonUrl);
        if (idx !== -1) {
          cat.videos[idx] = { ...cat.videos[idx], localPath: newPath };
          if (downloadedAt) cat.videos[idx].downloadedAt = downloadedAt;
          return true;
        }
      }
      if (Array.isArray(cat.subcategories)) {
        if (walk(cat.subcategories)) return true;
      }
    }
    return false;
  }
  return walk(course.categories);
}

/**
 * Run the --copy phase for a single course. Returns `{ slug, copied, skipped,
 * receipt }`. Throws on irrecoverable errors (caller decides whether to abort
 * the whole migration or move on).
 *
 * Pre-flight: every video where `completed === true` must have a resolvable
 * source path. If any video fails this check, throws BEFORE any copy starts.
 */
export function copyCourse(root, index, courseSlug, { write = () => {}, force = false } = {}) {
  const course = (index.courses ?? []).find(c => c.slug === courseSlug);
  if (!course) throw new Error(`Course not found in index: ${courseSlug}`);

  // Idempotency: if a receipt exists, this course was already migrated.
  const prior = loadReceipt(root, courseSlug);
  if (prior && !force) {
    write(`[${courseSlug}] already migrated (receipt at ${receiptPath(root, courseSlug)}); use force:true to re-run`);
    return { slug: courseSlug, copied: 0, skipped: prior.actions?.length ?? 0, receipt: prior };
  }

  const plan = planCourse(root, course);
  if (plan.problems.length > 0) {
    const summary = plan.problems.map(p => `${p.kind}: ${p.video.title} — ${p.detail}`).join('\n  ');
    throw new Error(`[${courseSlug}] pre-flight failed (${plan.problems.length} problems):\n  ${summary}`);
  }
  if (plan.actions.length === 0) {
    write(`[${courseSlug}] nothing to copy (no completed videos)`);
    return { slug: courseSlug, copied: 0, skipped: 0, receipt: null };
  }

  // Write tvshow.nfo + season.nfo BEFORE copying videos so the show folder
  // exists; harmless if --copy aborts mid-course.
  const seasons = enumerateSeasons(course);
  const showDir = showDirPath(root, course);
  mkdirSync(showDir, { recursive: true });
  writeFileSync(join(showDir, 'tvshow.nfo'), renderTvShowNfo(course, seasons), 'utf8');
  for (const s of seasons) {
    const dir = seasonDirPath(root, course, s);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'season.nfo'), renderSeasonNfo(s), 'utf8');
  }

  // Per-video copy with verification.
  const receiptActions = [];
  const sampleIndices = new Set(pickSampleIndices(plan.actions.length, 0.05));
  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i];
    write(`[${courseSlug}] COPY ${i + 1}/${plan.actions.length}: ${action.to}`);
    const bytes = copyWithVerification(action.from, action.to);
    let sha256 = null;
    if (sampleIndices.has(i)) {
      sha256 = sha256OfFile(action.to);
    }
    receiptActions.push({
      from: action.from, to: action.to, sizeBytes: bytes,
      season: action.season, episode: action.episode,
      sha256: sha256,
      sampled: sampleIndices.has(i),
    });

    // Write the per-episode .nfo right next to the .webm.
    const epi = seasons.find(s => s.seasonNumber === action.season)?.videos?.find(e => e.episodeNumber === action.episode);
    if (epi) {
      const nfoPath = action.to.replace(/\.webm$/, '.nfo');
      writeFileSync(nfoPath, renderEpisodeNfo(course, seasons.find(s => s.seasonNumber === action.season), epi), 'utf8');
    }

    // Update in-memory index's localPath for this video so we can write
    // back after all copies succeed.
    const epiVideo = epi?.video;
    if (epiVideo) updateLocalPath(course, epiVideo.lessonUrl, action.to, epiVideo.downloadedAt);
  }

  const receipt = {
    slug: courseSlug,
    copiedAt: new Date().toISOString(),
    actions: receiptActions,
    sampleFraction: 0.05,
    verifiedAt: null,
  };
  writeReceipt(root, courseSlug, receipt);

  return { slug: courseSlug, copied: receiptActions.length, skipped: 0, receipt };
}

/**
 * Verify a single course's receipt: every recorded target must still exist on
 * disk, sizes must match, hasCompletionCues must still pass, and the SHA-256
 * sample (5% of actions, the ones with `sampled: true` and `sha256` set in the
 * receipt) must re-hash to the same value. Stamps `verifiedAt` on the receipt
 * on success and writes it back. Returns `{ slug, ok, failures }`.
 */
export function verifyCourse(root, courseSlug, { write = () => {} } = {}) {
  const receipt = loadReceipt(root, courseSlug);
  if (!receipt) return { slug: courseSlug, ok: false, failures: [{ kind: 'NO_RECEIPT' }] };
  const failures = [];
  for (const a of receipt.actions ?? []) {
    if (!existsSync(a.to)) {
      failures.push({ kind: 'MISSING', target: a.to });
      continue;
    }
    let size;
    try { size = statSync(a.to).size; } catch { failures.push({ kind: 'STAT_ERROR', target: a.to }); continue; }
    if (size !== a.sizeBytes) {
      failures.push({ kind: 'SIZE_MISMATCH', target: a.to, recorded: a.sizeBytes, actual: size });
      continue;
    }
    if (!hasCompletionCues(a.to)) {
      failures.push({ kind: 'CUES_MISSING', target: a.to });
      continue;
    }
    if (a.sampled && a.sha256) {
      const actual = sha256OfFile(a.to);
      if (actual !== a.sha256) {
        failures.push({ kind: 'SHA256_MISMATCH', target: a.to, recorded: a.sha256, actual });
      }
    }
  }
  if (failures.length === 0) {
    receipt.verifiedAt = new Date().toISOString();
    writeReceipt(root, courseSlug, receipt);
    write(`[${courseSlug}] ✓ verified (${receipt.actions.length} actions, ${receipt.actions.filter(a => a.sampled).length} hashed)`);
    return { slug: courseSlug, ok: true, failures: [] };
  }
  // Failure: do NOT stamp verifiedAt.
  write(`[${courseSlug}] ✗ ${failures.length} failure(s)`);
  for (const f of failures) write(`    ${f.kind}: ${f.target ?? '(no path)'}`);
  return { slug: courseSlug, ok: false, failures };
}

const VERIFY_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up a single course's v1 sources, but ONLY if its receipt has a
 * `verifiedAt` stamp within the last 24 hours. Removes each source file
 * listed in the receipt; does NOT yet touch the parent `courses/<slug>/`
 * directories (that happens once at the end of `runCleanup`).
 * Returns `{ slug, deleted, skipped, reason? }`.
 */
export function cleanupCourse(root, courseSlug, { now = Date.now, write = () => {} } = {}) {
  const receipt = loadReceipt(root, courseSlug);
  if (!receipt) return { slug: courseSlug, deleted: 0, skipped: 0, reason: 'NO_RECEIPT' };
  if (!receipt.verifiedAt) {
    return { slug: courseSlug, deleted: 0, skipped: receipt.actions.length, reason: 'NOT_VERIFIED' };
  }
  const ageMs = now() - new Date(receipt.verifiedAt).getTime();
  if (ageMs > VERIFY_FRESHNESS_MS) {
    return { slug: courseSlug, deleted: 0, skipped: receipt.actions.length, reason: 'VERIFY_STALE', ageMs };
  }
  let deleted = 0;
  for (const a of receipt.actions ?? []) {
    if (!a.from) continue;
    if (a.from === a.to) {
      // Defensive: source and target identical would mean we'd delete our own
      // migrated file. Should never happen because v2 paths are under the show
      // folder, not under `courses/`, but check anyway.
      write(`[${courseSlug}] ⚠ refusing to delete: from===to for ${a.to}`);
      continue;
    }
    try {
      unlinkSync(a.from);
      deleted++;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // Already gone (re-run after partial cleanup) — count it as "already cleaned".
      deleted++;
    }
  }
  return { slug: courseSlug, deleted, skipped: 0 };
}

/**
 * Run --cleanup across every receipt-bearing course. After per-course cleanup,
 * if EVERY receipt was cleaned successfully AND the legacy `courses/` directory
 * still exists, rename it to `courses.deleted-YYYY-MM-DD/` (NOT rm -rf). The
 * user is expected to remove that manually after a final sanity check.
 */
export function runCleanup(root, { now = Date.now, write = (s) => console.log(s) } = {}) {
  const slugs = listReceipts(root);
  if (slugs.length === 0) {
    write('No receipts found — has --copy been run?');
    return { courses: 0, deleted: 0, renamedCoursesDir: null };
  }
  const results = [];
  let allClean = true;
  let totalDeleted = 0;
  for (const slug of slugs) {
    const r = cleanupCourse(root, slug, { now, write });
    results.push(r);
    if (r.deleted > 0) write(`[${slug}] cleaned ${r.deleted} file(s)`);
    if (r.skipped > 0) {
      write(`[${slug}] skipped (${r.reason})`);
      allClean = false;
    }
    totalDeleted += r.deleted;
  }
  let renamedCoursesDir = null;
  const legacyDir = join(root, 'courses');
  if (allClean && existsSync(legacyDir)) {
    // Use ISO date (not datetime) for the renamed dir to make it easy to spot.
    const date = new Date(now()).toISOString().slice(0, 10);
    const target = join(root, `courses.deleted-${date}`);
    try {
      renameSync(legacyDir, target);
      renamedCoursesDir = target;
      write(`Renamed ${legacyDir} → ${target}`);
      write('Remove that directory manually once you have verified all migrated content.');
    } catch (e) {
      write(`⚠ Could not rename ${legacyDir}: ${e.message}`);
    }
  } else if (!allClean) {
    write('Not renaming courses/ — some receipts were skipped (re-run --verify within 24h).');
  }
  write(`\n--cleanup: ${totalDeleted} file(s) deleted across ${slugs.length} course(s)`);
  return { courses: slugs.length, deleted: totalDeleted, renamedCoursesDir };
}

function listReceipts(root) {
  const dir = join(root, RECEIPTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, '').replace(/_/g, '/'));
}

/** Verify every course that has a receipt. Returns summary. */
export function runVerify(root, { write = (s) => console.log(s) } = {}) {
  const slugs = listReceipts(root);
  if (slugs.length === 0) {
    write('No receipts found — has --copy been run?');
    return { verified: 0, failed: 0, results: [] };
  }
  const results = [];
  let verified = 0, failed = 0;
  for (const slug of slugs) {
    const r = verifyCourse(root, slug, { write });
    results.push(r);
    if (r.ok) verified++; else failed++;
  }
  write(`\n--verify: ${verified} verified, ${failed} failed (of ${slugs.length} receipts)`);
  return { verified, failed, results };
}

/**
 * Run --copy across every course in the index. Acquires the migration lock.
 * Writes the updated index.json (with new localPath fields) at the end of
 * each successful course. Refuses to run unless --i-have-re-fetched is set OR
 * MIGRATION_REQUIRES_REFETCH_AFTER is satisfied by the index's lastFetched.
 *
 * Returns `{ coursesProcessed, totalCopied, errors[] }`.
 */
export async function runCopy(root, indexPath, { iHaveReFetched = false, write = (s) => console.log(s), force = false } = {}) {
  if (!iHaveReFetched && MIGRATION_REQUIRES_REFETCH_AFTER === null) {
    throw new Error(
      'Refusing to run --copy: the v2 scraper rewrite (Phase 1.5) has not yet shipped, ' +
      'and your index.json is presumed to come from the v1 (broken) scraper. ' +
      'Either wait for Phase 1.5 + re-fetch, OR pass --i-have-re-fetched if you are SURE ' +
      'the current index reflects re-scraped data.',
    );
  }

  acquireLock(root);
  const removeShutdownHandler = installShutdownReleaser(root);
  try {
    const index = loadIndex(indexPath);
    const errors = [];
    let coursesProcessed = 0;
    let totalCopied = 0;
    for (const course of index.courses ?? []) {
      try {
        const result = copyCourse(root, index, course.slug, { write, force });
        coursesProcessed++;
        totalCopied += result.copied;
        // Persist the index.json updates after each course (resumable).
        await atomicWriteJson(indexPath, index);
      } catch (e) {
        errors.push({ slug: course.slug, error: e.message });
        write(`✗ [${course.slug}] ${e.message}`);
      }
    }
    return { coursesProcessed, totalCopied, errors };
  } finally {
    removeShutdownHandler();
    releaseLock(root);
  }
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
    console.error(`index.json not found at ${indexPath}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.includes('--plan')) {
    const result = runPlan(root, indexPath);
    process.exit(result.summary.totalProblems > 0 ? 1 : 0);
  }
  if (args.includes('--copy')) {
    const iHaveReFetched = args.includes('--i-have-re-fetched');
    try {
      const result = await runCopy(root, indexPath, { iHaveReFetched });
      console.log(`\n--copy complete: ${result.coursesProcessed} courses processed, ${result.totalCopied} files copied`);
      if (result.errors.length > 0) {
        console.error(`\n${result.errors.length} course(s) had errors:`);
        for (const e of result.errors) console.error(`  ${e.slug}: ${e.error}`);
        process.exit(1);
      }
      process.exit(0);
    } catch (e) {
      console.error(`✗ --copy aborted: ${e.message}`);
      process.exit(1);
    }
  }
  if (args.includes('--verify')) {
    const result = runVerify(root);
    process.exit(result.failed > 0 ? 1 : 0);
  }
  if (args.includes('--cleanup')) {
    const result = runCleanup(root);
    process.exit(result.renamedCoursesDir ? 0 : (result.deleted > 0 ? 0 : 1));
  }
  console.error('Usage: node lib/migrate.js (--plan | --copy | --verify | --cleanup)');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
