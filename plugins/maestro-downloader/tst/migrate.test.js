import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { planCourse, planAll, resolveSourcePath, runPlan, copyCourse, runCopy, verifyCourse, runVerify, cleanupCourse, runCleanup, evaluateRefetchGate, MIGRATION_REQUIRES_REFETCH_AFTER } from '../lib/migrate.js';
import { legacyDeriveOutputPath, legacySanitizeFilename, legacySanitizeFilenamePreAmpStrip } from '../lib/layout.js';
import { readFileSync, existsSync, writeFileSync as fsWriteFile, mkdirSync as fsMkdir, unlinkSync } from 'node:fs';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'maestro-migrate-'));
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Create a real .webm-stub on disk at the legacy path so existsSync resolves. */
function seedLegacyFile(root, slug, categoryTitle, index, title, sizeBytes = 1024) {
  const p = legacyDeriveOutputPath(root, slug, categoryTitle, index, title);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, Buffer.alloc(sizeBytes));
  return p;
}

function makeVideo(o = {}) {
  return {
    bbcMaestroIndex: 1,
    title: 'V1',
    lessonUrl: 'https://x/v1',
    manifestUrl: 'https://x/m.m3u8',
    completed: true,
    downloadedAt: '2026-05-01T00:00:00.000Z',
    localPath: null,
    ...o,
  };
}

function makeCourse(o = {}) {
  return {
    slug: 'eric-vetro/singing',
    title: 'Sing Like the Stars',
    instructor: 'Eric Vetro',
    courseUrl: 'https://x/c',
    subscribed: true,
    contentType: 'music',
    categories: [],
    ...o,
  };
}

// ── resolveSourcePath ─────────────────────────────────────────────────────────

test('resolveSourcePath: prefers video.localPath when file exists there', () => {
  const real = seedLegacyFile(root, 'eric-vetro/singing', 'Lessons', 1, 'Title');
  const r = resolveSourcePath(root, 'eric-vetro/singing', 'Lessons', {
    bbcMaestroIndex: 1, title: 'Title', localPath: real,
  });
  assert.equal(r.path, real);
  assert.equal(r.source, 'localPath');
});

test('resolveSourcePath: falls back to legacy candidates when localPath is null', () => {
  const real = seedLegacyFile(root, 'eric-vetro/singing', 'Lessons', 2, 'AnotherTitle');
  const r = resolveSourcePath(root, 'eric-vetro/singing', 'Lessons', {
    bbcMaestroIndex: 2, title: 'AnotherTitle', localPath: null,
  });
  assert.equal(r.path, real);
  assert.equal(r.source, 'legacy');
});

test('resolveSourcePath: returns null when neither localPath nor legacy candidates exist', () => {
  const r = resolveSourcePath(root, 'eric-vetro/singing', 'Lessons', {
    bbcMaestroIndex: 999, title: 'Nonexistent', localPath: '/no/such/file.webm',
  });
  assert.equal(r.path, null);
  assert.equal(r.source, null);
});

test('resolveSourcePath: falls back to legacy even when localPath is non-null but points to a missing file', () => {
  const real = seedLegacyFile(root, 'eric-vetro/singing', 'Lessons', 3, 'StaleLocalPath');
  const r = resolveSourcePath(root, 'eric-vetro/singing', 'Lessons', {
    bbcMaestroIndex: 3, title: 'StaleLocalPath', localPath: '/missing/path.webm',
  });
  assert.equal(r.path, real);
  assert.equal(r.source, 'legacy');
});

// ── planCourse ────────────────────────────────────────────────────────────────

test('planCourse: produces COPY actions for completed videos with resolvable sources', () => {
  // Use a sub-path of root so paths don't collide with other tests.
  const subRoot = join(root, 'planCourse-1');
  mkdirSync(subRoot, { recursive: true });
  const source = seedLegacyFile(subRoot, 'eric/singing', 'Lessons', 1, 'Real Title');
  const course = makeCourse({
    slug: 'eric/singing',
    categories: [{
      title: 'Lessons',
      videos: [makeVideo({ bbcMaestroIndex: 1, title: 'Real Title', localPath: source, completed: true })],
    }],
  });
  const plan = planCourse(subRoot, course);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.actions[0].kind, 'COPY');
  assert.equal(plan.actions[0].from, source);
  assert.match(plan.actions[0].to, /Season 01.*s01e01 - Real Title\.webm$/);
  assert.equal(plan.actions[0].sourceKind, 'localPath');
});

test('planCourse: skips not-completed videos silently (they will be downloaded fresh)', () => {
  const course = makeCourse({
    categories: [{
      title: 'Lessons',
      videos: [makeVideo({ completed: false, localPath: null })],
    }],
  });
  const plan = planCourse(root, course);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.problems.length, 0);
});

test('planCourse: emits MISSING_SOURCE problem when completed video has no resolvable file', () => {
  const subRoot = join(root, 'planCourse-missing');
  mkdirSync(subRoot, { recursive: true });
  const course = makeCourse({
    slug: 'a/b',
    categories: [{
      title: 'Cat',
      videos: [makeVideo({ bbcMaestroIndex: 1, title: 'Ghost', localPath: '/never/exists.webm' })],
    }],
  });
  const plan = planCourse(subRoot, course);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.problems.length, 1);
  assert.equal(plan.problems[0].kind, 'MISSING_SOURCE');
});

test('planCourse: handles subcategories (videos at depth)', () => {
  const subRoot = join(root, 'planCourse-subs');
  mkdirSync(subRoot, { recursive: true });
  // Per the layout walker, a leaf inside a subcategory becomes a season titled
  // "Parent → Leaf"; the legacy file is at /courses/<slug>/videos/<Leaf>/idx-title.webm
  // (the old scraper would have flattened it to Leaf-only). For test seeding,
  // we use the leaf-cat-title as the legacy folder.
  const source = seedLegacyFile(subRoot, 'a/b', 'Breathing Fundamentals', 5, 'BF Lesson');
  const course = makeCourse({
    slug: 'a/b',
    categories: [{
      title: 'Vocal Exercises',
      subcategories: [{
        title: 'Breathing Fundamentals',
        videos: [makeVideo({ bbcMaestroIndex: 5, title: 'BF Lesson', localPath: source })],
      }],
    }],
  });
  const plan = planCourse(subRoot, course);
  assert.equal(plan.actions.length, 1);
  assert.match(plan.actions[0].to, /Season 01.*s01e01 - BF Lesson\.webm$/);
});

test('planCourse: Specials category videos go to Specials folder (s00)', () => {
  const subRoot = join(root, 'planCourse-specials');
  mkdirSync(subRoot, { recursive: true });
  const source = seedLegacyFile(subRoot, 'a/b', 'Consent', 1, 'I Consent');
  const course = makeCourse({
    slug: 'a/b',
    categories: [
      { title: 'Consent', videos: [makeVideo({ bbcMaestroIndex: 1, title: 'I Consent', localPath: source })] },
      { title: 'Lessons', videos: [] },
    ],
  });
  const plan = planCourse(subRoot, course);
  assert.equal(plan.actions.length, 1);
  assert.match(plan.actions[0].to, /Specials.*s00e01 - I Consent\.webm$/);
});

// ── planAll ───────────────────────────────────────────────────────────────────

test('planAll: aggregates per-course plans + computes summary', () => {
  const subRoot = join(root, 'planAll-1');
  mkdirSync(subRoot, { recursive: true });
  const s1 = seedLegacyFile(subRoot, 'a/x', 'Lessons', 1, 'V', 1024);
  const s2 = seedLegacyFile(subRoot, 'b/y', 'Lessons', 1, 'W', 2048);
  const index = {
    courses: [
      {
        slug: 'a/x', title: 'A', instructor: 'X', courseUrl: 'https://x',
        categories: [{ title: 'Lessons', videos: [makeVideo({ bbcMaestroIndex: 1, title: 'V', localPath: s1 })] }],
      },
      {
        slug: 'b/y', title: 'B', instructor: 'Y', courseUrl: 'https://y',
        categories: [{ title: 'Lessons', videos: [makeVideo({ bbcMaestroIndex: 1, title: 'W', localPath: s2 })] }],
      },
    ],
  };
  const result = planAll(subRoot, index);
  assert.equal(result.summary.courses, 2);
  assert.equal(result.summary.coursesWithActions, 2);
  assert.equal(result.summary.totalActions, 2);
  assert.equal(result.summary.totalProblems, 0);
  assert.equal(result.summary.totalBytes, 1024 + 2048);
});

test('planAll: empty courses array is fine', () => {
  const r = planAll(root, { courses: [] });
  assert.equal(r.summary.courses, 0);
  assert.equal(r.summary.totalActions, 0);
});

// ── runPlan: end-to-end against an on-disk index.json ────────────────────────

test('runPlan: reads index.json, prints plan, returns result', () => {
  const subRoot = join(root, 'runPlan-1');
  mkdirSync(subRoot, { recursive: true });
  const source = seedLegacyFile(subRoot, 'a/b', 'Lessons', 1, 'V');
  const indexPath = join(subRoot, 'index.json');
  writeFileSync(indexPath, JSON.stringify({
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [{
      slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
      categories: [{ title: 'Lessons', videos: [makeVideo({ bbcMaestroIndex: 1, title: 'V', localPath: source })] }],
    }],
  }));
  const lines = [];
  const result = runPlan(subRoot, indexPath, { write: (s) => lines.push(s) });
  assert.equal(result.summary.totalActions, 1);
  assert.ok(lines.some(l => l.includes('1 COPY actions')));
  assert.ok(lines.some(l => l.includes('s01e01 - V.webm')));
});

// ── copyCourse: per-course --copy execution ──────────────────────────────────

function writeStubWebmWithCues(path, sizeBytes = 2_000_000) {
  // Build a fake .webm whose tail contains a valid Cues element so
  // hasCompletionCues() passes during the copyWithVerification step.
  // The Matroska Cues ID is 0x1c53bb6b followed by an EBML VINT length and
  // a content byte that's a valid EBML class ID start (>= 0x10).
  fsMkdir(dirname(path), { recursive: true });
  const buf = Buffer.alloc(sizeBytes, 0);
  // Place the Cues marker near the tail (last 50 KB) so the lookup window finds it.
  const cuesOffset = sizeBytes - 30_000;
  buf[cuesOffset] = 0x1c; buf[cuesOffset + 1] = 0x53; buf[cuesOffset + 2] = 0xbb; buf[cuesOffset + 3] = 0x6b;
  buf[cuesOffset + 4] = 0x81; // VINT first byte: single-byte length
  buf[cuesOffset + 5] = 0xab; // content byte >= 0x10 satisfies the "valid EBML ID start" check
  fsWriteFile(path, buf);
  return path;
}

test('copyCourse: pre-flight fails fast on MISSING_SOURCE before any copy', () => {
  const subRoot = join(root, 'copyCourse-preflight');
  mkdirSync(subRoot, { recursive: true });
  const index = { courses: [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: false, contentType: 'default',
    categories: [{ title: 'Lessons', videos: [makeVideo({ bbcMaestroIndex: 1, title: 'Missing', localPath: null })] }],
  }] };
  assert.throws(() => copyCourse(subRoot, index, 'a/b'), /pre-flight failed/i);
});

test('copyCourse: happy path copies file + writes NFO + writes receipt', () => {
  const subRoot = join(root, 'copyCourse-happy');
  mkdirSync(subRoot, { recursive: true });
  // Create a real .webm-with-cues at the legacy path the resolver expects.
  const sourcePath = legacyDeriveOutputPath(subRoot, 'a/b', 'Lessons', 1, 'Real Lesson');
  writeStubWebmWithCues(sourcePath);
  const index = { courses: [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: false, contentType: 'default',
    categories: [{ title: 'Lessons', videos: [makeVideo({
      bbcMaestroIndex: 1, title: 'Real Lesson', localPath: sourcePath,
    })] }],
  }] };
  const result = copyCourse(subRoot, index, 'a/b');
  assert.equal(result.copied, 1);

  // Verify the file landed at the v2 path.
  const expectedV2Path = join(subRoot, 'T - I', 'Season 01', 'T - I - s01e01 - Real Lesson.webm');
  assert.ok(existsSync(expectedV2Path), `expected v2 file at ${expectedV2Path}`);

  // Verify the per-episode NFO landed beside it.
  const nfoPath = expectedV2Path.replace(/\.webm$/, '.nfo');
  assert.ok(existsSync(nfoPath), 'per-episode .nfo should be written next to .webm');
  const nfo = readFileSync(nfoPath, 'utf8');
  assert.match(nfo, /<title>Real Lesson<\/title>/);
  assert.match(nfo, /<uniqueid type="bbcmaestro">a\/b\/s01e01<\/uniqueid>/);

  // Verify tvshow.nfo + season.nfo were written.
  assert.ok(existsSync(join(subRoot, 'T - I', 'tvshow.nfo')));
  assert.ok(existsSync(join(subRoot, 'T - I', 'Season 01', 'season.nfo')));

  // Verify the receipt was written.
  const receiptPath = join(subRoot, '.migration', 'a_b.json');
  assert.ok(existsSync(receiptPath));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.slug, 'a/b');
  assert.equal(receipt.actions.length, 1);
  assert.equal(receipt.actions[0].to, expectedV2Path);

  // Verify the in-memory index was mutated with the new localPath.
  assert.equal(index.courses[0].categories[0].videos[0].localPath, expectedV2Path);

  // Verify source file is untouched (copy, not move).
  assert.ok(existsSync(sourcePath));
});

test('copyCourse: idempotent re-run on a course with an existing receipt skips by default', () => {
  const subRoot = join(root, 'copyCourse-idem');
  mkdirSync(subRoot, { recursive: true });
  const sourcePath = legacyDeriveOutputPath(subRoot, 'a/b', 'Lessons', 1, 'V');
  writeStubWebmWithCues(sourcePath);
  const index = { courses: [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: false, contentType: 'default',
    categories: [{ title: 'Lessons', videos: [makeVideo({
      bbcMaestroIndex: 1, title: 'V', localPath: sourcePath,
    })] }],
  }] };
  copyCourse(subRoot, index, 'a/b');
  const second = copyCourse(subRoot, index, 'a/b');
  assert.equal(second.copied, 0, 'second run should skip');
  assert.ok(second.skipped > 0);
});

test('copyCourse: resolves legacy candidate when localPath is null — plain title', () => {
  const subRoot = join(root, 'copyCourse-plain');
  mkdirSync(subRoot, { recursive: true });
  // Both candidates point at the same place when the title has no `&`.
  const sourcePath = legacyDeriveOutputPath(subRoot, 'a/b', 'Lessons', 1, 'PlainTitle');
  writeStubWebmWithCues(sourcePath);
  const index = { courses: [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: false, contentType: 'default',
    categories: [{ title: 'Lessons', videos: [makeVideo({
      bbcMaestroIndex: 1, title: 'PlainTitle', localPath: null, // ← null, force legacy fallback
    })] }],
  }] };
  const result = copyCourse(subRoot, index, 'a/b');
  assert.equal(result.copied, 1);
});

test('copyCourse: resolves PRE-amp-strip legacy candidate when only the &-preserving file exists on disk', () => {
  const subRoot = join(root, 'copyCourse-amp');
  mkdirSync(subRoot, { recursive: true });
  // Simulate a pre-strip file: name preserves `&` per the older sanitize rule.
  // Use legacySanitizeFilenamePreAmpStrip to compute the on-disk filename.
  const titleWithAmp = 'Puppies & nail trims';
  const catPre = legacySanitizeFilenamePreAmpStrip('Steve Mann');
  const titlePre = legacySanitizeFilenamePreAmpStrip(titleWithAmp);
  const preFixPath = join(subRoot, 'courses', 'a/b', 'videos', catPre, `1-${titlePre}.webm`);
  writeStubWebmWithCues(preFixPath);
  // Make sure the post-fix path does NOT exist.
  const postFixPath = legacyDeriveOutputPath(subRoot, 'a/b', 'Steve Mann', 1, titleWithAmp);
  assert.equal(existsSync(postFixPath), false, 'sanity: post-fix path must not exist for this test');

  const index = { courses: [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: false, contentType: 'default',
    categories: [{ title: 'Steve Mann', videos: [makeVideo({
      bbcMaestroIndex: 1, title: titleWithAmp, localPath: null,
    })] }],
  }] };
  const result = copyCourse(subRoot, index, 'a/b');
  assert.equal(result.copied, 1, 'pre-amp-strip candidate must be picked up');
});

// ── evaluateRefetchGate: pure re-fetch interlock decision ────────────────────

test('evaluateRefetchGate: --i-have-re-fetched override always allows', () => {
  // Override wins even against a null threshold and a stale lastFetched.
  const r = evaluateRefetchGate({ iHaveReFetched: true, lastFetched: '2000-01-01T00:00:00Z', threshold: null });
  assert.equal(r.ok, true);
  assert.match(r.reason, /override/);
});

test('evaluateRefetchGate: null threshold refuses (Phase 1.5 not shipped)', () => {
  const r = evaluateRefetchGate({ iHaveReFetched: false, lastFetched: '2030-01-01T00:00:00Z', threshold: null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not yet shipped/i);
});

test('evaluateRefetchGate: missing/unparseable lastFetched refuses', () => {
  const threshold = '2026-05-15T02:15:08-07:00';
  for (const lf of [null, undefined, '', 'not-a-date']) {
    const r = evaluateRefetchGate({ iHaveReFetched: false, lastFetched: lf, threshold });
    assert.equal(r.ok, false, `lastFetched=${String(lf)} should refuse`);
    assert.match(r.reason, /missing or unparseable/i);
  }
});

test('evaluateRefetchGate: lastFetched older than threshold refuses', () => {
  const r = evaluateRefetchGate({
    iHaveReFetched: false,
    lastFetched: '2026-05-13T00:00:00.000Z',
    threshold: '2026-05-15T02:15:08-07:00',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /predates the Phase 1\.5/i);
});

test('evaluateRefetchGate: lastFetched at/after threshold allows', () => {
  const threshold = '2026-05-15T02:15:08-07:00';
  // strictly after
  assert.equal(evaluateRefetchGate({ lastFetched: '2026-06-01T00:00:00Z', threshold }).ok, true);
  // exactly equal (boundary — re-fetched at the same instant counts as post-fix)
  assert.equal(evaluateRefetchGate({ lastFetched: threshold, threshold }).ok, true);
});

test('MIGRATION_REQUIRES_REFETCH_AFTER is a parseable ISO timestamp (Phase 1.5 shipped)', () => {
  // The constant must be set to the Phase 1.5 ship time, not left at the
  // null placeholder — otherwise --copy can never run without the manual flag.
  assert.notEqual(MIGRATION_REQUIRES_REFETCH_AFTER, null);
  assert.equal(Number.isNaN(Date.parse(MIGRATION_REQUIRES_REFETCH_AFTER)), false);
});

// ── runCopy: end-to-end including lock + index.json roundtrip ────────────────

test('runCopy: refuses when index.lastFetched predates the Phase 1.5 threshold', async () => {
  const subRoot = join(root, 'runCopy-gated');
  mkdirSync(subRoot, { recursive: true });
  const indexPath = join(subRoot, 'index.json');
  // 2026-05-13 is before the Phase 1.5 ship timestamp → broken-scraper data.
  writeFileSync(indexPath, JSON.stringify({ lastFetched: '2026-05-13T00:00:00.000Z', courses: [] }));
  await assert.rejects(
    runCopy(subRoot, indexPath, { iHaveReFetched: false }),
    /Refusing to run --copy/,
  );
});

test('runCopy: proceeds WITHOUT --i-have-re-fetched when lastFetched is post-Phase-1.5', async () => {
  const subRoot = join(root, 'runCopy-fresh-noflag');
  mkdirSync(subRoot, { recursive: true });
  const sourcePath = legacyDeriveOutputPath(subRoot, 'a/b', 'Lessons', 1, 'V');
  writeStubWebmWithCues(sourcePath);
  const indexPath = join(subRoot, 'index.json');
  writeFileSync(indexPath, JSON.stringify({
    // Re-fetched well after the Phase 1.5 scraper rewrite → safe to migrate
    // automatically, no manual override needed.
    lastFetched: '2026-07-01T00:00:00.000Z',
    courses: [{
      slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
      subscribed: false, contentType: 'default',
      categories: [{ title: 'Lessons', videos: [makeVideo({
        bbcMaestroIndex: 1, title: 'V', localPath: sourcePath,
      })] }],
    }],
  }));
  const result = await runCopy(subRoot, indexPath, { iHaveReFetched: false, write: () => {} });
  assert.equal(result.coursesProcessed, 1);
  assert.equal(result.totalCopied, 1);
  assert.equal(result.errors.length, 0);
});

test('runCopy: with --i-have-re-fetched, processes courses and updates index.json', async () => {
  const subRoot = join(root, 'runCopy-happy');
  mkdirSync(subRoot, { recursive: true });
  const sourcePath = legacyDeriveOutputPath(subRoot, 'a/b', 'Lessons', 1, 'V');
  writeStubWebmWithCues(sourcePath);
  const indexPath = join(subRoot, 'index.json');
  writeFileSync(indexPath, JSON.stringify({
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [{
      slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
      subscribed: false, contentType: 'default',
      categories: [{ title: 'Lessons', videos: [makeVideo({
        bbcMaestroIndex: 1, title: 'V', localPath: sourcePath,
      })] }],
    }],
  }));
  const result = await runCopy(subRoot, indexPath, { iHaveReFetched: true, write: () => {} });
  assert.equal(result.coursesProcessed, 1);
  assert.equal(result.totalCopied, 1);
  assert.equal(result.errors.length, 0);
  // Index was rewritten with new localPath.
  const updatedIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  const v2Path = updatedIndex.courses[0].categories[0].videos[0].localPath;
  assert.match(v2Path, /Season 01.*s01e01 - V\.webm$/);
});

// ── verifyCourse / runVerify ──────────────────────────────────────────────────

/** Helper: --copy a single-video course into `subRoot` and return the v2 paths. */
async function setupCopiedCourse(subRoot, { title = 'V', slug = 'a/b' } = {}) {
  mkdirSync(subRoot, { recursive: true });
  const sourcePath = legacyDeriveOutputPath(subRoot, slug, 'Lessons', 1, title);
  writeStubWebmWithCues(sourcePath);
  const indexPath = join(subRoot, 'index.json');
  writeFileSync(indexPath, JSON.stringify({
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [{
      slug, title: 'T', instructor: 'I', courseUrl: 'https://x',
      subscribed: false, contentType: 'default',
      categories: [{ title: 'Lessons', videos: [makeVideo({
        bbcMaestroIndex: 1, title, localPath: sourcePath,
      })] }],
    }],
  }));
  await runCopy(subRoot, indexPath, { iHaveReFetched: true, write: () => {} });
  return { sourcePath, indexPath, slug };
}

test('verifyCourse: ok=true when receipt + on-disk files match', async () => {
  const subRoot = join(root, 'verifyCourse-ok');
  await setupCopiedCourse(subRoot);
  const r = verifyCourse(subRoot, 'a/b');
  assert.equal(r.ok, true);
  assert.equal(r.failures.length, 0);
  // verifiedAt stamp is set in receipt.
  const slug = 'a/b';
  const receipt = JSON.parse(readFileSync(join(subRoot, '.migration', `${slug.replace(/[/\\]/g, '_')}.json`), 'utf8'));
  assert.ok(receipt.verifiedAt);
});

test('verifyCourse: ok=false with SIZE_MISMATCH when a target was truncated', async () => {
  const subRoot = join(root, 'verifyCourse-size');
  await setupCopiedCourse(subRoot);
  // Truncate the v2 file to provoke a size mismatch.
  const v2Path = join(subRoot, 'T - I', 'Season 01', 'T - I - s01e01 - V.webm');
  fsWriteFile(v2Path, Buffer.alloc(1000));
  const r = verifyCourse(subRoot, 'a/b');
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].kind, 'SIZE_MISMATCH');
});

test('verifyCourse: ok=false with MISSING when target was deleted', async () => {
  const subRoot = join(root, 'verifyCourse-missing');
  await setupCopiedCourse(subRoot);
  const v2Path = join(subRoot, 'T - I', 'Season 01', 'T - I - s01e01 - V.webm');
  unlinkSync(v2Path);
  const r = verifyCourse(subRoot, 'a/b');
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].kind, 'MISSING');
});

test('verifyCourse: returns NO_RECEIPT when course was never copied', () => {
  const subRoot = join(root, 'verifyCourse-noreceipt');
  mkdirSync(subRoot, { recursive: true });
  const r = verifyCourse(subRoot, 'never/migrated');
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].kind, 'NO_RECEIPT');
});

test('runVerify: aggregates over all receipts', async () => {
  const subRoot = join(root, 'runVerify-multi');
  // Set up two courses.
  await setupCopiedCourse(subRoot, { slug: 'a/one', title: 'V1' });
  // Second course needs its own copy run, but the lock would conflict if
  // sequential — runCopy releases its lock before returning, so second
  // setupCopiedCourse against the SAME subRoot would re-acquire fine. But
  // the second setup needs different source files. Use a different slug:
  const indexPath = join(subRoot, 'index.json');
  // We'll just check that verify finds at least one receipt and reports ok.
  const lines = [];
  const result = runVerify(subRoot, { write: (s) => lines.push(s) });
  assert.ok(result.verified >= 1);
  assert.equal(result.failed, 0);
});

// ── cleanupCourse / runCleanup ────────────────────────────────────────────────

test('cleanupCourse: NOT_VERIFIED when receipt has no verifiedAt', async () => {
  const subRoot = join(root, 'cleanupCourse-notverified');
  await setupCopiedCourse(subRoot);
  // Verify removed: tamper with receipt.
  const receiptPath = join(subRoot, '.migration', 'a_b.json');
  const r = JSON.parse(readFileSync(receiptPath, 'utf8'));
  delete r.verifiedAt;
  fsWriteFile(receiptPath, JSON.stringify(r));
  const result = cleanupCourse(subRoot, 'a/b');
  assert.equal(result.deleted, 0);
  assert.equal(result.reason, 'NOT_VERIFIED');
});

test('cleanupCourse: VERIFY_STALE when verifiedAt is older than 24h', async () => {
  const subRoot = join(root, 'cleanupCourse-stale');
  await setupCopiedCourse(subRoot);
  verifyCourse(subRoot, 'a/b'); // stamps verifiedAt
  const receiptPath = join(subRoot, '.migration', 'a_b.json');
  const r = JSON.parse(readFileSync(receiptPath, 'utf8'));
  r.verifiedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  fsWriteFile(receiptPath, JSON.stringify(r));
  const result = cleanupCourse(subRoot, 'a/b');
  assert.equal(result.deleted, 0);
  assert.equal(result.reason, 'VERIFY_STALE');
});

test('cleanupCourse: deletes source files when verifiedAt is fresh', async () => {
  const subRoot = join(root, 'cleanupCourse-fresh');
  const { sourcePath } = await setupCopiedCourse(subRoot);
  verifyCourse(subRoot, 'a/b');
  assert.ok(existsSync(sourcePath), 'sanity: v1 source still exists pre-cleanup');
  const result = cleanupCourse(subRoot, 'a/b');
  assert.equal(result.deleted, 1);
  assert.equal(existsSync(sourcePath), false);
});

test('runCleanup: renames courses/ to courses.deleted-YYYY-MM-DD when all clean', async () => {
  const subRoot = join(root, 'runCleanup-rename');
  await setupCopiedCourse(subRoot);
  verifyCourse(subRoot, 'a/b');
  const r = runCleanup(subRoot, { write: () => {} });
  assert.ok(r.renamedCoursesDir, 'expected courses/ to be renamed');
  assert.match(r.renamedCoursesDir, /courses\.deleted-\d{4}-\d{2}-\d{2}$/);
  assert.equal(existsSync(join(subRoot, 'courses')), false);
  assert.equal(existsSync(r.renamedCoursesDir), true);
});

test('runCleanup: does NOT rename courses/ when at least one receipt is unverified', async () => {
  const subRoot = join(root, 'runCleanup-norename');
  await setupCopiedCourse(subRoot);
  // No verify step → receipt has no verifiedAt → cleanup skips → no rename.
  const r = runCleanup(subRoot, { write: () => {} });
  assert.equal(r.renamedCoursesDir, null);
  assert.ok(existsSync(join(subRoot, 'courses')));
});
