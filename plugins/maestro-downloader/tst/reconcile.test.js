import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

import { reconcileCourse } from '../lib/reconcile.js';
import { deriveOutputPath } from '../lib/index-utils.js';

function makeCourse(videos = []) {
  return {
    slug: 'alice/course-a',
    title: 'Course A',
    instructor: 'Alice',
    courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
    categories: [
      {
        title: 'Intro',
        videos: videos.map((v, i) => ({
          index: i + 1,
          title: v.title ?? `Lesson ${i + 1}`,
          lessonUrl: `https://bbcmaestro.com/lessons/${i + 1}`,
          manifestUrl: 'https://cdn.example.com/video.m3u8',
          completed: v.completed ?? false,
          downloadedAt: v.downloadedAt ?? null,
          localPath: v.localPath ?? null,
        })),
      },
    ],
  };
}

function placeDiskFile(root, course, catTitle, index, title, size = 1_001_000) {
  const p = deriveOutputPath(root, course.slug, catTitle, index, title);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, Buffer.alloc(size));
  return p;
}

test('reconcileCourse: backfills completed=true when file exists on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{ title: 'Lesson 1' }]);

  placeDiskFile(root, course, 'Intro', 1, 'Lesson 1');

  const result = reconcileCourse(course, root);

  assert.equal(result.backfilled, 1);
  assert.equal(result.missing, 0);
  const video = course.categories[0].videos[0];
  assert.equal(video.completed, true);
  assert.equal(video.localPath, deriveOutputPath(root, course.slug, 'Intro', 1, 'Lesson 1'));
  assert.ok(video.downloadedAt);
});

test('reconcileCourse: leaves missing=1 when file does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{ title: 'Lesson 1' }]);

  const result = reconcileCourse(course, root);

  assert.equal(result.backfilled, 0);
  assert.equal(result.missing, 1);
  assert.equal(course.categories[0].videos[0].completed, false);
});

test('reconcileCourse: counts already-complete videos without touching them', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([
    { title: 'Lesson 1', completed: true, downloadedAt: '2026-05-01T00:00:00Z', localPath: '/old/path.webm' },
  ]);

  const result = reconcileCourse(course, root);

  assert.equal(result.alreadyComplete, 1);
  assert.equal(result.backfilled, 0);
  assert.equal(course.categories[0].videos[0].localPath, '/old/path.webm');
});

test('reconcileCourse: handles mix of complete, backfillable, and missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([
    { title: 'Lesson 1', completed: true, downloadedAt: '2026-05-01T00:00:00Z', localPath: '/done.webm' },
    { title: 'Lesson 2' },
    { title: 'Lesson 3' },
  ]);

  // Place lesson 2 on disk
  placeDiskFile(root, course, 'Intro', 2, 'Lesson 2');

  const result = reconcileCourse(course, root);

  assert.equal(result.alreadyComplete, 1);
  assert.equal(result.backfilled, 1);
  assert.equal(result.missing, 1);
});

test('reconcileCourse: does not backfill files below minimum size threshold (partial download)', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{ title: 'Lesson 1' }]);

  // 999 KB — non-zero but below the 1 MB minimum for a trustworthy complete file
  placeDiskFile(root, course, 'Intro', 1, 'Lesson 1', 999_999);

  const result = reconcileCourse(course, root);

  assert.equal(result.backfilled, 0, 'under-threshold file must not be counted as complete');
  assert.equal(result.missing, 1);
  assert.equal(course.categories[0].videos[0].completed, false);
});

test('reconcileCourse: does not backfill zero-byte files (incomplete partial)', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{ title: 'Lesson 1' }]);

  // Write zero-byte file (simulates killed ffmpeg with empty output)
  const p = deriveOutputPath(root, course.slug, 'Intro', 1, 'Lesson 1');
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');

  const result = reconcileCourse(course, root);

  assert.equal(result.backfilled, 0, 'zero-byte file must not be counted as complete');
  assert.equal(result.missing, 1);
});
