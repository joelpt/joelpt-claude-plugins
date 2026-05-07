import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';

import { isRateLimitError, isNetworkError, recordCompletion, parseLastFrame, extractBadSegmentUrl, patchManifest, isConsistentStall } from '../lib/download.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeIndex(overrides = {}) {
  return {
    lastFetched: new Date().toISOString(),
    courses: [
      {
        slug: 'test/course',
        title: 'Test Course',
        instructor: 'Tester',
        courseUrl: 'https://bbcmaestro.com/courses/test/course',
        categories: [
          {
            title: 'Intro',
            videos: [
              {
                index: 1,
                title: 'Lesson 1',
                lessonUrl: 'https://bbcmaestro.com/lessons/1',
                manifestUrl: 'https://cdn.example.com/video.m3u8',
                completed: false,
                downloadedAt: null,
                localPath: null,
              },
              {
                index: 2,
                title: 'Lesson 2',
                lessonUrl: 'https://bbcmaestro.com/lessons/2',
                manifestUrl: 'https://cdn.example.com/video2.m3u8',
                completed: false,
                downloadedAt: null,
                localPath: null,
              },
            ],
          },
        ],
        ...overrides,
      },
    ],
  };
}

function writeTmpIndex(dir, data) {
  const p = join(dir, 'index.json');
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

// ── recordCompletion ─────────────────────────────────────────────────────────

test('recordCompletion: marks video completed, sets localPath and downloadedAt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());

  await recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/lesson-1.webm');

  const updated = JSON.parse(readFileSync(indexPath, 'utf8'));
  const video = updated.courses[0].categories[0].videos[0];
  assert.equal(video.completed, true);
  assert.equal(video.localPath, '/dl/lesson-1.webm');
  assert.ok(video.downloadedAt, 'downloadedAt should be set');
});

test('recordCompletion: does not clobber a concurrent completion written between calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());

  // Simulate external process completing lesson 2 after our process started
  const interleaved = makeIndex();
  interleaved.courses[0].categories[0].videos[1].completed = true;
  interleaved.courses[0].categories[0].videos[1].downloadedAt = '2026-05-06T00:00:00Z';
  interleaved.courses[0].categories[0].videos[1].localPath = '/dl/lesson-2.webm';
  writeFileSync(indexPath, JSON.stringify(interleaved, null, 2) + '\n');

  // Now record lesson 1 — should preserve lesson 2's completion
  await recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/lesson-1.webm');

  const updated = JSON.parse(readFileSync(indexPath, 'utf8'));
  const videos = updated.courses[0].categories[0].videos;
  assert.equal(videos[0].completed, true, 'lesson 1 should be completed');
  assert.equal(videos[1].completed, true, 'lesson 2 completion must not be clobbered');
  assert.equal(videos[1].localPath, '/dl/lesson-2.webm');
});

test('recordCompletion: throws if course slug not found in index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());

  await assert.rejects(
    () => recordCompletion(indexPath, 'no/such-course', 'https://bbcmaestro.com/lessons/1', '/dl/l.webm'),
    /Course not found/,
  );
});

test('recordCompletion: throws if lessonUrl not found in course', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());

  await assert.rejects(
    () => recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/999', '/dl/l.webm'),
    /Video not found/,
  );
});

test('isRateLimitError: returns true for HTTP 429 in stderr', () => {
  assert.equal(isRateLimitError('Server returned 429'), true);
});

test('isRateLimitError: returns true for HTTP 503 in stderr', () => {
  assert.equal(isRateLimitError('server returned 503'), true);
});

test('isRateLimitError: returns true for "too many requests" phrase', () => {
  assert.equal(isRateLimitError('HTTP error: too many requests'), true);
});

test('isRateLimitError: returns false for ordinary ffmpeg error', () => {
  assert.equal(isRateLimitError('No such file or directory'), false);
});

test('isRateLimitError: returns false for codec error', () => {
  assert.equal(isRateLimitError('Unknown encoder libsvtav1'), false);
});

test('isRateLimitError: returns false for empty string', () => {
  assert.equal(isRateLimitError(''), false);
});

test('isRateLimitError: returns false for 404 not found', () => {
  assert.equal(isRateLimitError('server returned 404'), false);
});

test('isRateLimitError: returns false for 500 internal server error', () => {
  assert.equal(isRateLimitError('server returned 500'), false);
});

// ── isNetworkError ───────────────────────────────────────────────────────────

test('isNetworkError: returns true for Operation timed out', () => {
  assert.equal(isNetworkError('Operation timed out'), true);
});

test('isNetworkError: returns true for Connection timed out', () => {
  assert.equal(isNetworkError('Connection timed out'), true);
});

test('isNetworkError: returns true for Connection reset by peer', () => {
  assert.equal(isNetworkError('Connection reset by peer'), true);
});

test('isNetworkError: returns true for Connection refused', () => {
  assert.equal(isNetworkError('Connection refused'), true);
});

test('isNetworkError: returns true for Broken pipe', () => {
  assert.equal(isNetworkError('Broken pipe'), true);
});

test('isNetworkError: returns false for 404 not found', () => {
  assert.equal(isNetworkError('server returned 404'), false);
});

test('isNetworkError: returns false for codec error', () => {
  assert.equal(isNetworkError('Unknown encoder libsvtav1'), false);
});

test('isNetworkError: returns false for empty string', () => {
  assert.equal(isNetworkError(''), false);
});

// ── parseLastFrame ───────────────────────────────────────────────────────────

test('parseLastFrame: extracts frame number from a single progress line', () => {
  const line = 'frame= 4152 fps= 10 q=30.0 size=   26112KiB time=00:02:46.08 bitrate=1288.0kbits/s speed=0.4x elapsed=0:06:54.87    ';
  assert.equal(parseLastFrame(line), 4152);
});

test('parseLastFrame: returns the LAST frame when multiple progress lines present', () => {
  const buf = 'frame= 100 fps= 25 q=31.0 size=1024KiB    frame= 250 fps= 25 q=31.0 size=2048KiB';
  assert.equal(parseLastFrame(buf), 250);
});

test('parseLastFrame: returns null for empty string', () => {
  assert.equal(parseLastFrame(''), null);
});

test('parseLastFrame: returns null when no frame= token present', () => {
  assert.equal(parseLastFrame('[https @ 0x9b4c16000] Opening segment.ts for reading'), null);
});

test('parseLastFrame: handles frame=0 (startup)', () => {
  assert.equal(parseLastFrame('frame=    0 fps=0.0 q=0.0 size=       0KiB'), 0);
});

// ── extractBadSegmentUrl ──────────────────────────────────────────────────────

test('extractBadSegmentUrl: extracts .ts URL from single Opening line', () => {
  const stderr = "[https @ 0x7f] Opening 'https://cdn.example.com/HLS/video_00045.ts' for reading";
  assert.equal(extractBadSegmentUrl(stderr), 'https://cdn.example.com/HLS/video_00045.ts');
});

test('extractBadSegmentUrl: returns the LAST .ts URL when multiple present', () => {
  const stderr = [
    "[https @ 0x7f] Opening 'https://cdn.example.com/HLS/video_00044.ts' for reading",
    "frame= 1234 fps=18",
    "[https @ 0x7f] Opening 'https://cdn.example.com/HLS/video_00045.ts' for reading",
    "frame= 1234 fps=18",
  ].join('\n');
  assert.equal(extractBadSegmentUrl(stderr), 'https://cdn.example.com/HLS/video_00045.ts');
});

test('extractBadSegmentUrl: returns null when no .ts URL present', () => {
  assert.equal(extractBadSegmentUrl('frame= 100 fps=18 q=30.0'), null);
});

test('extractBadSegmentUrl: returns null for empty string', () => {
  assert.equal(extractBadSegmentUrl(''), null);
});

// ── patchManifest ─────────────────────────────────────────────────────────────

const SAMPLE_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:7',
  '#EXTINF:6.006,',
  'https://cdn.example.com/HLS/video_00044.ts',
  '#EXTINF:6.006,',
  'https://cdn.example.com/HLS/video_00045.ts',
  '#EXTINF:6.006,',
  'https://cdn.example.com/HLS/video_00046.ts',
  '#EXT-X-ENDLIST',
].join('\n');

test('patchManifest: removes the target segment and its preceding EXTINF line', () => {
  const result = patchManifest(SAMPLE_MANIFEST, 'https://cdn.example.com/HLS/video_00045.ts');
  assert.ok(!result.includes('video_00045.ts'), 'bad segment URL should be removed');
  const lines = result.split('\n').filter(l => l.startsWith('#EXTINF:'));
  assert.equal(lines.length, 2, 'should have 2 EXTINF lines remaining (one per kept segment)');
});

test('patchManifest: keeps all other segments intact', () => {
  const result = patchManifest(SAMPLE_MANIFEST, 'https://cdn.example.com/HLS/video_00045.ts');
  assert.ok(result.includes('video_00044.ts'));
  assert.ok(result.includes('video_00046.ts'));
});

test('patchManifest: matches by filename when manifest uses relative paths', () => {
  const relativeManifest = [
    '#EXTM3U',
    '#EXTINF:6.006,',
    'video_00044.ts',
    '#EXTINF:6.006,',
    'video_00045.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const result = patchManifest(relativeManifest, 'https://cdn.example.com/HLS/video_00045.ts');
  assert.ok(!result.includes('video_00045.ts'));
  assert.ok(result.includes('video_00044.ts'));
});

test('patchManifest: returns manifest unchanged when segment not found', () => {
  const result = patchManifest(SAMPLE_MANIFEST, 'https://cdn.example.com/HLS/video_99999.ts');
  assert.equal(result, SAMPLE_MANIFEST);
});

// ── isConsistentStall ─────────────────────────────────────────────────────────

test('isConsistentStall: returns true for two identical frame counts', () => {
  assert.equal(isConsistentStall([5246, 5246]), true);
});

test('isConsistentStall: returns true when frames are within 10% of each other', () => {
  // 5000 and 5499 → spread = 499/5499 = 9.07% < 10%
  assert.equal(isConsistentStall([5000, 5499]), true);
});

test('isConsistentStall: returns false when frames exceed 10% spread', () => {
  // 5000 and 6000 → spread = 1000/6000 = 16.7% > 10%
  assert.equal(isConsistentStall([5000, 6000]), false);
});

test('isConsistentStall: returns false for a single element', () => {
  assert.equal(isConsistentStall([5246]), false);
});

test('isConsistentStall: returns false for empty array', () => {
  assert.equal(isConsistentStall([]), false);
});

test('isConsistentStall: returns true across 5 near-identical stall points (realistic retry set)', () => {
  // Simulate 5 retries all stalling at ~5246 ± tiny jitter
  assert.equal(isConsistentStall([5246, 5249, 5246, 5248, 5247]), true);
});

test('isConsistentStall: returns false when early failure mixed with deep stall (WiFi scenario)', () => {
  // First retry stalled deep; second retry failed at frame 0 (WiFi gone)
  assert.equal(isConsistentStall([5246, 0]), false);
});
