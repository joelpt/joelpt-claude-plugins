import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { MIN_COMPLETE_FILE_BYTES } from '../lib/index-utils.js';

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

function placeDiskFile(root, course, catTitle, index, title, size = 1_001_000, withCues = false) {
  const p = deriveOutputPath(root, course.slug, catTitle, index, title);
  mkdirSync(join(p, '..'), { recursive: true });
  const buf = Buffer.alloc(size);
  if (withCues) {
    const pos = size - 20;
    buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b;
    buf[pos + 4] = 0x85; buf[pos + 5] = 0xbb;
  }
  writeFileSync(p, buf);
  return p;
}

test('reconcileCourse: backfills completed=true when file exists on disk with valid Cues', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{ title: 'Lesson 1' }]);

  placeDiskFile(root, course, 'Intro', 1, 'Lesson 1', 1_001_000, true);

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

test('reconcileCourse: counts already-complete videos without touching them when file is valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  // Place a real complete file so the Cues check passes
  const filePath = placeDiskFile(root, makeCourse([{ title: 'Lesson 1' }]), 'Intro', 1, 'Lesson 1', 1_001_000, true);
  const course = makeCourse([
    { title: 'Lesson 1', completed: true, downloadedAt: '2026-05-01T00:00:00Z', localPath: filePath },
  ]);

  const result = reconcileCourse(course, root);

  assert.equal(result.alreadyComplete, 1);
  assert.equal(result.backfilled, 0);
  assert.equal(result.partialReset, 0);
  assert.equal(course.categories[0].videos[0].localPath, filePath);
});

test('reconcileCourse: handles mix of complete (valid), backfillable, and missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  // Lesson 1: already marked complete with a real Cues-bearing file
  const lesson1Path = placeDiskFile(root, makeCourse([{ title: 'Lesson 1' }]), 'Intro', 1, 'Lesson 1', 1_001_000, true);
  const course = makeCourse([
    { title: 'Lesson 1', completed: true, downloadedAt: '2026-05-01T00:00:00Z', localPath: lesson1Path },
    { title: 'Lesson 2' },
    { title: 'Lesson 3' },
  ]);

  // Place lesson 2 on disk with Cues so it can be backfilled
  placeDiskFile(root, course, 'Intro', 2, 'Lesson 2', 1_001_000, true);

  const result = reconcileCourse(course, root);

  assert.equal(result.alreadyComplete, 1);
  assert.equal(result.backfilled, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.partialReset, 0);
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

test('reconcileCourse: resets completed:true video when disk file lacks Cues (partial download)', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const filePath = deriveOutputPath(root, 'alice/course-a', 'Intro', 1, 'Lesson 1');
  // File on disk is big but has no Cues — simulates a killed mid-download
  const size = MIN_COMPLETE_FILE_BYTES + 100_000;
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Buffer.alloc(size));

  const course = makeCourse([{
    title: 'Lesson 1',
    completed: true,
    downloadedAt: '2026-05-01T00:00:00Z',
    localPath: filePath,
  }]);

  const result = reconcileCourse(course, root);

  assert.equal(result.partialReset, 1, 'partial file must be counted as reset');
  assert.equal(result.alreadyComplete, 0);
  const video = course.categories[0].videos[0];
  assert.equal(video.completed, false, 'video must be reset to incomplete');
  assert.equal(video.downloadedAt, null);
  assert.equal(video.localPath, null);
});

test('reconcileCourse: keeps completed:true video as complete when file has valid Cues', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const filePath = deriveOutputPath(root, 'alice/course-a', 'Intro', 1, 'Lesson 1');
  const size = MIN_COMPLETE_FILE_BYTES + 100_000;
  const buf = Buffer.alloc(size);
  const pos = size - 20;
  buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b;
  buf[pos + 4] = 0x85; buf[pos + 5] = 0xbb;
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, buf);

  const course = makeCourse([{
    title: 'Lesson 1',
    completed: true,
    downloadedAt: '2026-05-01T00:00:00Z',
    localPath: filePath,
  }]);

  const result = reconcileCourse(course, root);

  assert.equal(result.partialReset, 0);
  assert.equal(result.alreadyComplete, 1, 'complete file must count as alreadyComplete');
  assert.equal(course.categories[0].videos[0].completed, true, 'completed flag must be preserved');
});

test('reconcileCourse: resets completed:true video when localPath file is missing from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-reconcile-'));
  const course = makeCourse([{
    title: 'Lesson 1',
    completed: true,
    downloadedAt: '2026-05-01T00:00:00Z',
    localPath: '/no/such/path/1-Lesson 1.webm',
  }]);

  const result = reconcileCourse(course, root);

  assert.equal(result.partialReset, 1, 'missing file must be counted as reset');
  assert.equal(result.alreadyComplete, 0);
  const video = course.categories[0].videos[0];
  assert.equal(video.completed, false);
  assert.equal(video.localPath, null);
});
