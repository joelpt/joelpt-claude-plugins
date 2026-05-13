import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planCourse, planAll, resolveSourcePath, runPlan } from '../lib/migrate.js';
import { legacyDeriveOutputPath, legacySanitizeFilename } from '../lib/layout.js';

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
