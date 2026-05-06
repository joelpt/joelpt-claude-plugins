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
