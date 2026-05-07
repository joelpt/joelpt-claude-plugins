import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';

import {
  mergeCourses,
  atomicWriteJson,
  isStaleCache,
  derive1080pUrl,
  deriveOutputPath,
  sanitizeFilename,
  buildFfmpegArgs,
  getEncoderSettings,
  hasCompletionCues,
  isFileComplete,
  MIN_COMPLETE_FILE_BYTES,
} from '../lib/index-utils.js';

// ── mergeCourses ────────────────────────────────────────────────────────────

test('mergeCourses: fresh data with no existing returns fresh with completed:false on all videos', () => {
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Intro',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
            },
          ],
        },
      ],
    },
  ];

  const result = mergeCourses([], fresh);

  assert.equal(result.length, 1);
  assert.equal(result[0].slug, 'alice/course-a');
  const video = result[0].categories[0].videos[0];
  assert.equal(video.completed, false);
  assert.equal(video.downloadedAt, null);
  assert.equal(video.localPath, null);
});

test('mergeCourses: preserves completed/downloadedAt/localPath on already-known videos', () => {
  const existing = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Intro',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
              completed: true,
              downloadedAt: '2026-05-01T10:00:00Z',
              localPath: '/downloads/lesson-1.webm',
            },
          ],
        },
      ],
    },
  ];
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Intro',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video-new.m3u8',
            },
          ],
        },
      ],
    },
  ];

  const result = mergeCourses(existing, fresh);

  const video = result[0].categories[0].videos[0];
  assert.equal(video.completed, true);
  assert.equal(video.downloadedAt, '2026-05-01T10:00:00Z');
  assert.equal(video.localPath, '/downloads/lesson-1.webm');
  assert.equal(video.manifestUrl, 'https://cdn.example.com/HLS/video-new.m3u8');
});

test('mergeCourses: inserts newly discovered videos with completed:false', () => {
  const existing = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Intro',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
              completed: true,
              downloadedAt: '2026-05-01T10:00:00Z',
              localPath: '/downloads/lesson-1.webm',
            },
          ],
        },
      ],
    },
  ];
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Intro',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
            },
            {
              index: 2,
              title: 'Bonus Lesson',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/bonus',
              manifestUrl: 'https://cdn.example.com/HLS/bonus.m3u8',
            },
          ],
        },
      ],
    },
  ];

  const result = mergeCourses(existing, fresh);

  assert.equal(result[0].categories[0].videos.length, 2);
  const bonus = result[0].categories[0].videos[1];
  assert.equal(bonus.title, 'Bonus Lesson');
  assert.equal(bonus.completed, false);
  assert.equal(bonus.downloadedAt, null);
  assert.equal(bonus.localPath, null);
});

test('mergeCourses: adds entirely new course from fresh data', () => {
  const existing = [];
  const fresh = [
    {
      slug: 'bob/course-b',
      title: 'Course B',
      instructor: 'Bob',
      courseUrl: 'https://bbcmaestro.com/courses/bob/course-b',
      categories: [{ title: 'Section 1', videos: [] }],
    },
  ];

  const result = mergeCourses(existing, fresh);

  assert.equal(result.length, 1);
  assert.equal(result[0].slug, 'bob/course-b');
});

test('mergeCourses: preserves existing courses absent from fresh data (partial crawl / skipped course)', () => {
  const existing = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Lessons',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
              completed: true,
              downloadedAt: '2026-05-01T10:00:00Z',
              localPath: '/downloads/lesson-1.webm',
            },
          ],
        },
      ],
    },
    {
      slug: 'bob/course-b',
      title: 'Course B',
      instructor: 'Bob',
      courseUrl: 'https://bbcmaestro.com/courses/bob/course-b',
      categories: [{ title: 'Lessons', videos: [] }],
    },
  ];
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [
        {
          title: 'Lessons',
          videos: [
            {
              index: 1,
              title: 'Lesson 1',
              lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
              manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
            },
          ],
        },
      ],
    },
  ];

  const result = mergeCourses(existing, fresh);

  assert.equal(result.length, 2, 'both courses should be present');
  assert.ok(result.some(c => c.slug === 'bob/course-b'), 'bob/course-b should be preserved');
  const alice = result.find(c => c.slug === 'alice/course-a');
  assert.equal(alice.categories[0].videos[0].completed, true, 'completed flag preserved on re-crawled course');
});

// ── atomicWriteJson ─────────────────────────────────────────────────────────

test('atomicWriteJson: writes JSON to target path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-test-'));
  const target = join(dir, 'index.json');

  await atomicWriteJson(target, { hello: 'world' });

  const content = JSON.parse(readFileSync(target, 'utf8'));
  assert.deepEqual(content, { hello: 'world' });
});

test('atomicWriteJson: no temp file remains after write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-test-'));
  const target = join(dir, 'index.json');

  await atomicWriteJson(target, { x: 1 });

  let tmpExists = false;
  try {
    readFileSync(target + '.tmp');
    tmpExists = true;
  } catch (_) {}
  assert.equal(tmpExists, false);
});

// ── isStaleCache ────────────────────────────────────────────────────────────

test('isStaleCache: returns true when lastFetched is null', () => {
  assert.equal(isStaleCache(null), true);
});

test('isStaleCache: returns true when lastFetched is undefined', () => {
  assert.equal(isStaleCache(undefined), true);
});

test('isStaleCache: returns true when lastFetched is more than 30 days ago', () => {
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isStaleCache(old), true);
});

test('isStaleCache: returns false when lastFetched is within 30 days', () => {
  const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isStaleCache(recent), false);
});

test('isStaleCache: returns false when lastFetched is today', () => {
  assert.equal(isStaleCache(new Date().toISOString()), false);
});

// ── derive1080pUrl ──────────────────────────────────────────────────────────

test('derive1080pUrl: replaces .m3u8 with _1080.m3u8', () => {
  const master = 'https://videos.cdn.bbcmaestro.com/22_OwenOKane/HLS/22_OwenOKane.m3u8';
  const expected = 'https://videos.cdn.bbcmaestro.com/22_OwenOKane/HLS/22_OwenOKane_1080.m3u8';
  assert.equal(derive1080pUrl(master), expected);
});

test('derive1080pUrl: handles real-world BBC Maestro URL format', () => {
  const master =
    'https://videos.cdn.bbcmaestro.com/22_OwenOKane_ALifeLessAnxious_Lesson22_DareToDream_HEVC/HLS/22_OwenOKane_ALifeLessAnxious_Lesson22_DareToDream_HEVC.m3u8';
  const result = derive1080pUrl(master);
  assert.match(result, /_1080\.m3u8$/);
  assert.equal(result.endsWith('_HEVC_1080.m3u8'), true);
});

// ── deriveOutputPath ────────────────────────────────────────────────────────

test('deriveOutputPath: builds correct path structure', () => {
  const result = deriveOutputPath(
    '/downloads',
    'owen-o-kane/a-life-less-anxious',
    'Main Lessons',
    22,
    'Dare to Dream',
  );
  assert.equal(result, '/downloads/courses/owen-o-kane/a-life-less-anxious/videos/Main Lessons/22-Dare to Dream.webm');
});

test('deriveOutputPath: sanitizes category and video title for filesystem', () => {
  const result = deriveOutputPath(
    '/downloads',
    'bob/course-b',
    'Q&A: Session/Review',
    3,
    'What is: Design?',
  );
  assert.ok(!result.includes(':'));
  assert.ok(!result.includes('?'));
  assert.ok(result.endsWith('.webm'));
});

// ── sanitizeFilename ────────────────────────────────────────────────────────

test('sanitizeFilename: removes characters unsafe for filenames', () => {
  assert.equal(sanitizeFilename('Hello: World?'), 'Hello- World');
});

test('sanitizeFilename: preserves spaces and hyphens', () => {
  assert.equal(sanitizeFilename('A Life Less Anxious'), 'A Life Less Anxious');
});

test('sanitizeFilename: handles slash in name', () => {
  const result = sanitizeFilename('Q&A/Session');
  assert.ok(!result.includes('/'));
});

// ── buildFfmpegArgs ─────────────────────────────────────────────────────────

test('buildFfmpegArgs: includes reconnect flags before -i to prevent CDN segment hangs', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm', settings);
  const iIdx = args.indexOf('-i');
  const preamble = args.slice(0, iIdx);

  assert.ok(iIdx > 0, '-i flag must be present');

  const timeoutIdx = preamble.indexOf('-timeout');
  assert.ok(timeoutIdx !== -1, '-timeout flag must appear before -i');
  assert.equal(preamble[timeoutIdx + 1], '30000000', '-timeout must be 30000000 microseconds');

  const reconnectIdx = preamble.indexOf('-reconnect');
  assert.ok(reconnectIdx !== -1, '-reconnect flag must appear before -i');
  assert.equal(preamble[reconnectIdx + 1], '1');

  const reconnectStreamedIdx = preamble.indexOf('-reconnect_streamed');
  assert.ok(reconnectStreamedIdx !== -1, '-reconnect_streamed flag must appear before -i');
  assert.equal(preamble[reconnectStreamedIdx + 1], '1');

  const reconnectDelayIdx = preamble.indexOf('-reconnect_delay_max');
  assert.ok(reconnectDelayIdx !== -1, '-reconnect_delay_max flag must appear before -i');
  assert.equal(preamble[reconnectDelayIdx + 1], '5');
});

test('buildFfmpegArgs: output path is last arg', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm', settings);
  assert.equal(args[args.length - 1], '/out/video.webm');
});

test('buildFfmpegArgs: includes protocol_whitelist for HLS over HTTPS', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm', settings);
  const pwIdx = args.indexOf('-protocol_whitelist');
  assert.ok(pwIdx !== -1);
  assert.ok(args[pwIdx + 1].includes('https'));
  assert.ok(args[pwIdx + 1].includes('crypto'));
});

// ── hasCompletionCues ─────────────────────────────────────────────────────────

// Builds a buffer that mimics a complete WebM: large enough and with a valid
// Cues element (1c 53 bb 6b + 1-byte VINT + 0xBB CuePoint child) near the end,
// exactly as ffmpeg's mkv_write_trailer() places it.
function makeWebmWithCues(size = MIN_COMPLETE_FILE_BYTES + 100_000) {
  const buf = Buffer.alloc(size);
  const pos = size - 20;
  buf[pos] = 0x1c;
  buf[pos + 1] = 0x53;
  buf[pos + 2] = 0xbb;
  buf[pos + 3] = 0x6b;
  buf[pos + 4] = 0x85; // 1-byte VINT (high bit set → length=5)
  buf[pos + 5] = 0xbb; // CuePoint child element ID
  return buf;
}

function writeTmpWebm(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-cues-'));
  const p = join(dir, 'test.webm');
  writeFileSync(p, buf);
  return p;
}

test('hasCompletionCues: returns true for file with Cues element near end', () => {
  assert.equal(hasCompletionCues(writeTmpWebm(makeWebmWithCues())), true);
});

test('hasCompletionCues: returns false for file without Cues element', () => {
  assert.equal(hasCompletionCues(writeTmpWebm(Buffer.alloc(MIN_COMPLETE_FILE_BYTES + 100_000))), false);
});

test('hasCompletionCues: returns false for file below minimum size', () => {
  assert.equal(hasCompletionCues(writeTmpWebm(makeWebmWithCues(MIN_COMPLETE_FILE_BYTES - 1))), false);
});

test('hasCompletionCues: returns false for non-existent file', () => {
  assert.equal(hasCompletionCues('/no/such/path/missing.webm'), false);
});

test('hasCompletionCues: returns false for Cues ID with wrong child byte (not 0xBB)', () => {
  const size = MIN_COMPLETE_FILE_BYTES + 100_000;
  const buf = Buffer.alloc(size);
  const pos = size - 20;
  buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b;
  buf[pos + 4] = 0x85;
  buf[pos + 5] = 0x00; // not CuePoint
  assert.equal(hasCompletionCues(writeTmpWebm(buf)), false);
});

test('hasCompletionCues: handles 2-byte VINT size encoding', () => {
  const size = MIN_COMPLETE_FILE_BYTES + 100_000;
  const buf = Buffer.alloc(size);
  const pos = size - 20;
  buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b;
  buf[pos + 4] = 0x40; buf[pos + 5] = 0x20; // 2-byte VINT
  buf[pos + 6] = 0xbb; // CuePoint at content offset 2
  assert.equal(hasCompletionCues(writeTmpWebm(buf)), true);
});

test('hasCompletionCues: ignores placeholder Cues in file header (first few KB)', () => {
  const size = MIN_COMPLETE_FILE_BYTES + 100_000;
  const buf = Buffer.alloc(size);
  // Header-region placeholder at offset 102 (like ffmpeg's EBMLVoid stub)
  buf[102] = 0x1c; buf[103] = 0x53; buf[104] = 0xbb; buf[105] = 0x6b;
  buf[106] = 0x85; buf[107] = 0xbb;
  // No real Cues in the last 200KB
  assert.equal(hasCompletionCues(writeTmpWebm(buf)), false);
});

// ── isFileComplete ────────────────────────────────────────────────────────────

test('isFileComplete: returns true for complete file with Cues', () => {
  assert.equal(isFileComplete(writeTmpWebm(makeWebmWithCues())), true);
});

test('isFileComplete: returns false for null path', () => {
  assert.equal(isFileComplete(null), false);
});

test('isFileComplete: returns false for undefined path', () => {
  assert.equal(isFileComplete(undefined), false);
});

test('isFileComplete: returns false for non-existent path', () => {
  assert.equal(isFileComplete('/no/such/path/missing.webm'), false);
});
