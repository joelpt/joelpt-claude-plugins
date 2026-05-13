import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';

import {
  mergeCourses,
  atomicWriteJson,
  loadIndex,
  isStaleCache,
  derive1080pUrl,
  buildFfmpegArgs,
  getEncoderSettings,
  hasCompletionCues,
  isFileComplete,
  MIN_COMPLETE_FILE_BYTES,
} from '../lib/index-utils.js';
import { legacyDeriveOutputPath as deriveOutputPath, legacySanitizeFilename as sanitizeFilename } from '../lib/layout.js';
import { IndexValidationError } from '../lib/schema.js';

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

test('mergeCourses: preserves actualResolution when present on existing video', () => {
  const existing = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [{
        title: 'Intro',
        videos: [{
          index: 1,
          title: 'Lesson 1',
          lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
          manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
          completed: true,
          downloadedAt: '2026-05-01T10:00:00Z',
          localPath: '/downloads/lesson-1.webm',
          actualResolution: '720p',
        }],
      }],
    },
  ];
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [{
        title: 'Intro',
        videos: [{
          index: 1,
          title: 'Lesson 1',
          lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
          manifestUrl: 'https://cdn.example.com/HLS/video-new.m3u8',
        }],
      }],
    },
  ];
  const video = mergeCourses(existing, fresh)[0].categories[0].videos[0];
  assert.equal(video.actualResolution, '720p');
});

test('mergeCourses: omits actualResolution when absent from existing video', () => {
  const existing = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [{
        title: 'Intro',
        videos: [{
          index: 1,
          title: 'Lesson 1',
          lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
          manifestUrl: 'https://cdn.example.com/HLS/video.m3u8',
          completed: true,
          downloadedAt: '2026-05-01T10:00:00Z',
          localPath: '/downloads/lesson-1.webm',
        }],
      }],
    },
  ];
  const fresh = [
    {
      slug: 'alice/course-a',
      title: 'Course A',
      instructor: 'Alice',
      courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
      categories: [{
        title: 'Intro',
        videos: [{
          index: 1,
          title: 'Lesson 1',
          lessonUrl: 'https://bbcmaestro.com/courses/alice/course-a/lessons/lesson-1',
          manifestUrl: 'https://cdn.example.com/HLS/video-new.m3u8',
        }],
      }],
    },
  ];
  const video = mergeCourses(existing, fresh)[0].categories[0].videos[0];
  assert.equal(video.actualResolution, undefined);
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

test('sanitizeFilename: strips ampersand', () => {
  assert.equal(sanitizeFilename('Grooming & positive nail trims'), 'Grooming positive nail trims');
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

test('buildFfmpegArgs: includes -reconnect_on_network_error 1 to reconnect on TCP/TLS errors', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm', settings);
  const iIdx = args.indexOf('-i');
  const preamble = args.slice(0, iIdx);
  const idx = preamble.indexOf('-reconnect_on_network_error');
  assert.ok(idx !== -1, '-reconnect_on_network_error must be present before -i');
  assert.equal(preamble[idx + 1], '1');
});

test('buildFfmpegArgs: output path is last arg', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm', settings);
  assert.equal(args[args.length - 1], '/out/video.webm');
});

test('buildFfmpegArgs: -f matroska precedes output path so .part extension does not cause EINVAL', () => {
  const settings = getEncoderSettings('speech', false);
  const args = buildFfmpegArgs('https://cdn.example.com/video_1080.m3u8', '/out/video.webm.part', settings);
  const outIdx = args.indexOf('/out/video.webm.part');
  assert.ok(outIdx > 0, 'output path must be present');
  assert.equal(args[outIdx - 2], '-f', '-f flag must immediately precede output path');
  assert.equal(args[outIdx - 1], 'matroska', 'format must be matroska');
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

// ── v2 mergeCourses: subcategory recursion (data-loss bug fix) ───────────────

test('mergeCourses v2: preserves completed when video moves from cat.videos to subcategory', () => {
  // This is the precise blind spot the v1 code had: existing index has video
  // under `cat.videos`; fresh-scrape (with new selectors) puts it under
  // `cat.subcategories[].videos`. Completion state must survive the relocation.
  const existing = [{
    slug: 'eric/singing',
    title: 'Sing',
    instructor: 'Eric',
    courseUrl: 'https://x/c',
    categories: [{
      title: 'Vocal Exercises',
      videos: [{
        bbcMaestroIndex: 1,
        title: 'Breathing 1',
        lessonUrl: 'https://x/lesson/breathing-1',
        manifestUrl: 'https://x/m.m3u8',
        completed: true,
        downloadedAt: '2026-05-01T00:00:00.000Z',
        localPath: '/x/file.webm',
      }],
    }],
  }];
  const fresh = [{
    slug: 'eric/singing',
    title: 'Sing',
    instructor: 'Eric',
    courseUrl: 'https://x/c',
    categories: [{
      title: 'Vocal Exercises',
      subcategories: [{
        title: 'Breathing Fundamentals',
        videos: [{
          bbcMaestroIndex: 1,
          title: 'Breathing 1 (updated)',
          lessonUrl: 'https://x/lesson/breathing-1',
          manifestUrl: 'https://x/m.m3u8',
        }],
      }],
    }],
  }];
  const result = mergeCourses(existing, fresh);
  const movedVideo = result[0].categories[0].subcategories[0].videos[0];
  assert.equal(movedVideo.completed, true, 'completion must survive cat→subcat relocation');
  assert.equal(movedVideo.downloadedAt, '2026-05-01T00:00:00.000Z');
  assert.equal(movedVideo.localPath, '/x/file.webm');
  // Scraper-state still wins (overwrite):
  assert.equal(movedVideo.title, 'Breathing 1 (updated)');
});

test('mergeCourses v2: preserves completed when video moves from subcategory to cat.videos', () => {
  // The reverse direction also matters.
  const existing = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [{
      title: 'Cat',
      subcategories: [{ title: 'Sub', videos: [{
        bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
        completed: true, downloadedAt: '2026-05-01T00:00:00.000Z', localPath: '/x/v.webm',
      }]}],
    }],
  }];
  const fresh = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [{ title: 'Cat', videos: [{
      bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
    }]}],
  }];
  const moved = mergeCourses(existing, fresh)[0].categories[0].videos[0];
  assert.equal(moved.completed, true);
  assert.equal(moved.localPath, '/x/v.webm');
});

test('mergeCourses v2: deeply nested subcategories are walked', () => {
  // Defensive: even if scraper produces deeper trees, the walk must reach them.
  const existing = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [{
      title: 'Top',
      subcategories: [{
        title: 'Mid',
        subcategories: [{
          title: 'Leaf',
          videos: [{
            bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
            completed: true, downloadedAt: '2026-05-01T00:00:00.000Z', localPath: '/x/v.webm',
          }],
        }],
      }],
    }],
  }];
  const fresh = structuredClone(existing); // identical shape; just exercising the walk
  delete fresh[0].categories[0].subcategories[0].subcategories[0].videos[0].completed;
  delete fresh[0].categories[0].subcategories[0].subcategories[0].videos[0].downloadedAt;
  delete fresh[0].categories[0].subcategories[0].subcategories[0].videos[0].localPath;
  const merged = mergeCourses(existing, fresh);
  const v = merged[0].categories[0].subcategories[0].subcategories[0].videos[0];
  assert.equal(v.completed, true);
  assert.equal(v.localPath, '/x/v.webm');
});

test('mergeCourses v2: preserves course-level subscribed field', () => {
  const existing = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: true, contentType: 'music',
    categories: [{ title: 'C', videos: [] }],
  }];
  const fresh = [{
    slug: 'a/b', title: 'T-updated', instructor: 'I', courseUrl: 'https://x',
    categories: [{ title: 'C-updated', videos: [] }],
  }];
  const out = mergeCourses(existing, fresh)[0];
  assert.equal(out.subscribed, true, 'subscribed user-state must be preserved');
  assert.equal(out.contentType, 'music');
  assert.equal(out.title, 'T-updated', 'title scraper-state must overwrite');
});

test('mergeCourses v2: fresh course (no existing) defaults subscribed=false and contentType=default', () => {
  // Required so a freshly-discovered course passes v2 schema validation
  // (which makes both fields required). Without these defaults the first
  // post-migration write would reject mid-flight.
  const fresh = [{
    slug: 'new/course', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [{ title: 'C', videos: [] }],
  }];
  const out = mergeCourses([], fresh)[0];
  assert.equal(out.subscribed, false);
  assert.equal(out.contentType, 'default');
});

test('mergeCourses v2: fresh contentType wins over default when supplied', () => {
  const fresh = [{
    slug: 'new/course', title: 'T', instructor: 'I', courseUrl: 'https://x',
    contentType: 'music',
    categories: [{ title: 'C', videos: [] }],
  }];
  const out = mergeCourses([], fresh)[0];
  assert.equal(out.contentType, 'music');
});

test('mergeCourses v2: existing user-state beats fresh and beats default', () => {
  const existing = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    subscribed: true, contentType: 'visual',
    categories: [{ title: 'C', videos: [] }],
  }];
  const fresh = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    contentType: 'music',
    categories: [{ title: 'C', videos: [] }],
  }];
  const out = mergeCourses(existing, fresh)[0];
  assert.equal(out.subscribed, true);
  assert.equal(out.contentType, 'visual');
});

test('mergeCourses v2: duplicate lessonUrl in existing — completed entry wins', () => {
  // Defensive: if an existing index somehow contains two videos with the same
  // lessonUrl (one completed, one not), the completion state must survive.
  const existing = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [
      { title: 'A', videos: [{
        bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
        completed: false, downloadedAt: null, localPath: null,
      }]},
      { title: 'B', videos: [{
        bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
        completed: true, downloadedAt: '2026-05-01T00:00:00.000Z', localPath: '/x/v.webm',
      }]},
    ],
  }];
  const fresh = [{
    slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
    categories: [{ title: 'C', videos: [{
      bbcMaestroIndex: 1, title: 'V', lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
    }]}],
  }];
  const out = mergeCourses(existing, fresh)[0].categories[0].videos[0];
  assert.equal(out.completed, true, 'completed-true duplicate must win the dedup');
  assert.equal(out.localPath, '/x/v.webm');
});

// ── atomicWriteJson + loadIndex: v2 validation hook ──────────────────────────

test('atomicWriteJson: v2 payload validates before writing; rejects malformed and leaves no .tmp', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-aw-'));
  const dest = join(tmpDir, 'index.json');
  // Valid v2 payload writes cleanly.
  const good = {
    schemaVersion: 2,
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [{
      slug: 'a/b', title: 'T', instructor: 'I', courseUrl: 'https://x',
      subscribed: true, contentType: 'music',
      categories: [{ title: 'C', videos: [{
        bbcMaestroIndex: 1, title: 'V',
        lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
        completed: false, downloadedAt: null, localPath: null,
      }]}],
    }],
  };
  assert.doesNotThrow(() => atomicWriteJson(dest, good));
  // Malformed v2 payload is rejected; .tmp must not be left behind (we
  // validate BEFORE the tmp write, so a throw never touches the filesystem).
  const bad = { ...good, schemaVersion: 2, lastFetched: 'not-a-date' };
  assert.throws(() => atomicWriteJson(dest, bad), IndexValidationError);
  assert.equal(existsSync(dest + '.tmp'), false, 'failed v2 validation must not leave a .tmp behind');
});

test('atomicWriteJson: pre-v2 payload (no schemaVersion) passes through', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-aw-'));
  const dest = join(tmpDir, 'index.json');
  // No schemaVersion → don't validate. This is the migration-safety path.
  const v1ish = { lastFetched: '2026-05-13T00:00:00.000Z', courses: [] };
  assert.doesNotThrow(() => atomicWriteJson(dest, v1ish));
  const read = JSON.parse(readFileSync(dest, 'utf8'));
  assert.equal(read.lastFetched, '2026-05-13T00:00:00.000Z');
});

test('loadIndex: validates v2 file, accepts pre-v2 file', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-li-'));
  const dest = join(tmpDir, 'index.json');
  // Pre-v2: passes through.
  writeFileSync(dest, JSON.stringify({ lastFetched: '2026-05-13T00:00:00.000Z', courses: [] }));
  assert.doesNotThrow(() => loadIndex(dest));
  // Valid v2: passes.
  writeFileSync(dest, JSON.stringify({
    schemaVersion: 2,
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [],
  }));
  assert.doesNotThrow(() => loadIndex(dest));
  // Malformed v2: rejected.
  writeFileSync(dest, JSON.stringify({
    schemaVersion: 2,
    lastFetched: 'not-a-date',
    courses: [],
  }));
  assert.throws(() => loadIndex(dest), IndexValidationError);
});
