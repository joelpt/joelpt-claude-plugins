import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';

import { isRateLimitError, isNetworkError, recordCompletion, parseLastFrame, parseTimeSeconds, parseDurationSec, parseFfmpegProgress, fmtSize, fmtEta, fmtElapsed, fmtTimestamp, needsDownload, sweepPartFiles, derivePartPath, runCourse, computeRateMBs, isProgressLine, downloadVideoWithBackoff, DOWNLOAD_DELAYS_MS, DOWNLOAD_FALLBACK_DELAYS_MS, CDN_STALL_PAUSE_MS, INTER_VIDEO_DELAY_MIN_MS, INTER_VIDEO_DELAY_MAX_MS } from '../lib/download.js';

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

test('recordCompletion: refuses to write when a live migration lock is held', async () => {
  const { acquireLock, releaseLock } = await import('../lib/migration-lock.js');
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-locked-'));
  const indexPath = writeTmpIndex(dir, makeIndex());
  acquireLock(dir, { pid: process.pid });
  try {
    await assert.rejects(
      recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/lesson-1.webm'),
      /Migration in progress/,
    );
    // Index untouched.
    const after = JSON.parse(readFileSync(indexPath, 'utf8'));
    assert.equal(after.courses[0].categories[0].videos[0].completed, false);
  } finally {
    releaseLock(dir);
  }
});

test('recordCompletion: proceeds normally when only a stale lock exists', async () => {
  const { __testing } = await import('../lib/migration-lock.js');
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-stale-'));
  const indexPath = writeTmpIndex(dir, makeIndex());
  mkdirSync(join(dir, '.migration'), { recursive: true });
  writeFileSync(__testing.lockPath(dir), JSON.stringify({ pid: 99999999, startedAt: '2024-01-01T00:00:00.000Z' }));
  // Stale lock (PID dead) must not block.
  await recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/lesson-1.webm');
  const after = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(after.courses[0].categories[0].videos[0].completed, true);
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

test('recordCompletion: writes actualResolution when provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());
  await recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/l.webm', '720p');
  const video = JSON.parse(readFileSync(indexPath, 'utf8')).courses[0].categories[0].videos[0];
  assert.equal(video.actualResolution, '720p');
});

test('recordCompletion: omits actualResolution when not provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dl-test-'));
  const indexPath = writeTmpIndex(dir, makeIndex());
  await recordCompletion(indexPath, 'test/course', 'https://bbcmaestro.com/lessons/1', '/dl/l.webm');
  const video = JSON.parse(readFileSync(indexPath, 'utf8')).courses[0].categories[0].videos[0];
  assert.equal(video.actualResolution, undefined);
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


// ── parseTimeSeconds ──────────────────────────────────────────────────────────

test('parseTimeSeconds: parses HH:MM:SS.xx into total seconds', () => {
  assert.ok(Math.abs(parseTimeSeconds('00:12:34.56') - 754.56) < 0.001);
});

test('parseTimeSeconds: handles hours correctly', () => {
  assert.equal(parseTimeSeconds('01:00:00.00'), 3600);
});

test('parseTimeSeconds: returns zero for all-zero timestamp', () => {
  assert.equal(parseTimeSeconds('00:00:00.00'), 0);
});

test('parseTimeSeconds: returns null for empty string', () => {
  assert.equal(parseTimeSeconds(''), null);
});

test('parseTimeSeconds: returns null for invalid format', () => {
  assert.equal(parseTimeSeconds('not-a-time'), null);
});

test('parseTimeSeconds: parses minutes and seconds without hours', () => {
  assert.ok(Math.abs(parseTimeSeconds('00:02:46.08') - 166.08) < 0.001);
});

// ── parseDurationSec ──────────────────────────────────────────────────────────

test('parseDurationSec: extracts duration from ffmpeg header output', () => {
  const stderr = '  Duration: 00:12:34.56, start: 0.000000, bitrate: 1234 kb/s';
  assert.ok(Math.abs(parseDurationSec(stderr) - 754.56) < 0.001);
});

test('parseDurationSec: returns null when no Duration line present', () => {
  assert.equal(parseDurationSec('Stream #0:0: Video: h264'), null);
});

test('parseDurationSec: returns null for empty string', () => {
  assert.equal(parseDurationSec(''), null);
});

// ── parseFfmpegProgress ───────────────────────────────────────────────────────

const PROGRESS_LINE = 'frame= 4152 fps= 10 q=30.0 size=   26112KiB time=00:02:46.08 bitrate=1288.0kbits/s speed=0.4x elapsed=0:06:54.87    ';

test('parseFfmpegProgress: extracts timeSec from KiB progress line', () => {
  const r = parseFfmpegProgress(PROGRESS_LINE);
  assert.ok(r !== null);
  assert.ok(Math.abs(r.timeSec - 166.08) < 0.001);
});

test('parseFfmpegProgress: extracts sizeKb from KiB progress line', () => {
  assert.equal(parseFfmpegProgress(PROGRESS_LINE).sizeKb, 26112);
});

test('parseFfmpegProgress: extracts fps from progress line', () => {
  assert.equal(parseFfmpegProgress(PROGRESS_LINE).fps, 10);
});

test('parseFfmpegProgress: extracts speed from progress line', () => {
  assert.equal(parseFfmpegProgress(PROGRESS_LINE).speed, 0.4);
});

test('parseFfmpegProgress: returns null when no time= token present', () => {
  assert.equal(parseFfmpegProgress('frame= 100 fps= 25 q=31.0 size=1024KiB'), null);
});

test('parseFfmpegProgress: handles size=N/A startup output (sizeKb is null)', () => {
  const startup = 'frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=N/A';
  const r = parseFfmpegProgress(startup);
  assert.ok(r !== null);
  assert.equal(r.speed, null);
});

test('parseFfmpegProgress: handles kB (lowercase) as well as KiB', () => {
  const kbLine = 'frame=  100 fps= 25 q=31.0 size=    4096kB time=00:00:04.00 bitrate=8192.0kbits/s speed=3.0x';
  const r = parseFfmpegProgress(kbLine);
  assert.equal(r.sizeKb, 4096);
});

// ── fmtSize ───────────────────────────────────────────────────────────────────

test('fmtSize: returns kB label for values under 1024', () => {
  assert.equal(fmtSize(512), '512kB');
});

test('fmtSize: returns kB for exactly 1023', () => {
  assert.equal(fmtSize(1023), '1023kB');
});

test('fmtSize: returns MB for values >= 1024', () => {
  assert.equal(fmtSize(1024), '1.0MB');
});

test('fmtSize: formats fractional MB correctly', () => {
  assert.equal(fmtSize(1536), '1.5MB');
});

test('fmtSize: returns GB for values >= 1024*1024', () => {
  assert.equal(fmtSize(1024 * 1024), '1.0GB');
});

// ── fmtEta ────────────────────────────────────────────────────────────────────

test('fmtEta: returns seconds-only string for short remaining time', () => {
  assert.equal(fmtEta(75, 100, 1), '25s');
});

test('fmtEta: returns Xm Ys format for >60s remaining', () => {
  assert.equal(fmtEta(0, 100, 1), '1m40s');
});

test('fmtEta: returns empty string when totalSec is 0', () => {
  assert.equal(fmtEta(0, 0, 1), '');
});

test('fmtEta: returns empty string when speed is null', () => {
  assert.equal(fmtEta(0, 100, null), '');
});

test('fmtEta: returns empty string when speed is 0', () => {
  assert.equal(fmtEta(0, 100, 0), '');
});

test('fmtEta: returns empty string when current >= total (already done)', () => {
  assert.equal(fmtEta(100, 100, 1), '');
});

// ── fmtTimestamp ──────────────────────────────────────────────────────────────

test('fmtTimestamp: returns HH:MM:SS from a given date', () => {
  const d = new Date();
  d.setHours(14, 23, 11, 0);
  assert.equal(fmtTimestamp(d), '14:23:11');
});

test('fmtTimestamp: zero-pads single-digit components', () => {
  const d = new Date();
  d.setHours(9, 5, 3, 0);
  assert.equal(fmtTimestamp(d), '09:05:03');
});

// ── fmtElapsed ────────────────────────────────────────────────────────────────

test('fmtElapsed: returns 0s for zero ms', () => {
  assert.equal(fmtElapsed(0), '0s');
});

test('fmtElapsed: returns seconds only for under one minute', () => {
  assert.equal(fmtElapsed(1000), '1s');
  assert.equal(fmtElapsed(59000), '59s');
});

test('fmtElapsed: returns Xm0s for exactly one minute', () => {
  assert.equal(fmtElapsed(60000), '1m0s');
});

test('fmtElapsed: returns Xm Ys for longer durations', () => {
  assert.equal(fmtElapsed(90000), '1m30s');
});

// ── needsDownload ─────────────────────────────────────────────────────────────

test('needsDownload: returns true when completed is false', () => {
  assert.equal(needsDownload({ completed: false, localPath: null }), true);
});

test('needsDownload: returns true when completed but localPath is null', () => {
  assert.equal(needsDownload({ completed: true, localPath: null }), true);
});

test('needsDownload: returns true when completed but file does not exist on disk', () => {
  assert.equal(needsDownload({ completed: true, localPath: '/no/such/path/ghost.webm' }), true);
});

test('needsDownload: returns true when completed but file is under minimum size', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-nd-'));
  const tmpFile = join(tmpDir, 'partial.webm');
  writeFileSync(tmpFile, Buffer.alloc(999_999));
  assert.equal(needsDownload({ completed: true, localPath: tmpFile }), true);
});

test('needsDownload: returns false when completed and file meets minimum size with Cues element', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-nd-'));
  const tmpFile = join(tmpDir, 'complete.webm');
  const buf = Buffer.alloc(1_100_000);
  // Place valid Cues element near end: ID + 1-byte VINT + CuePoint child
  buf[1_099_980] = 0x1c; buf[1_099_981] = 0x53; buf[1_099_982] = 0xbb; buf[1_099_983] = 0x6b;
  buf[1_099_984] = 0x85; buf[1_099_985] = 0xbb;
  writeFileSync(tmpFile, buf);
  assert.equal(needsDownload({ completed: true, localPath: tmpFile }), false);
});

test('needsDownload: returns true when completed and file is large but lacks Cues (partial download)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-nd-'));
  const tmpFile = join(tmpDir, 'partial.webm');
  writeFileSync(tmpFile, Buffer.alloc(5_000_000)); // 5 MB, no Cues
  assert.equal(needsDownload({ completed: true, localPath: tmpFile }), true);
});

// ── derivePartPath ────────────────────────────────────────────────────────────

test('derivePartPath: appends .part to the output path', () => {
  assert.equal(derivePartPath('/downloads/courses/foo/bar.webm'), '/downloads/courses/foo/bar.webm.part');
});

// ── sweepPartFiles ────────────────────────────────────────────────────────────

test('sweepPartFiles: deletes all .part files under courses dir and returns count', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-sweep-'));
  const coursesDir = join(root, 'courses', 'alice', 'course-a', 'videos', 'Intro');
  mkdirSync(coursesDir, { recursive: true });
  writeFileSync(join(coursesDir, '1-Lesson.webm.part'), 'partial');
  writeFileSync(join(coursesDir, '2-Lesson.webm.part'), 'partial');
  writeFileSync(join(coursesDir, '3-Lesson.webm'), 'complete'); // should not be deleted

  const count = sweepPartFiles(root);

  assert.equal(count, 2);
  assert.equal(existsSync(join(coursesDir, '1-Lesson.webm.part')), false);
  assert.equal(existsSync(join(coursesDir, '2-Lesson.webm.part')), false);
  assert.equal(existsSync(join(coursesDir, '3-Lesson.webm')), true);
});

test('sweepPartFiles: returns 0 when no .part files exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-sweep-'));
  mkdirSync(join(root, 'courses'), { recursive: true });
  assert.equal(sweepPartFiles(root), 0);
});

test('sweepPartFiles: returns 0 when courses dir does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-sweep-'));
  assert.equal(sweepPartFiles(root), 0);
});

// ── runCourse ─────────────────────────────────────────────────────────────────

test('runCourse: returns {downloaded:0, failed:0} when course slug not found', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-rc-'));
  const indexPath = join(root, 'index.json');
  writeFileSync(indexPath, JSON.stringify({ courses: [] }));
  const result = await runCourse('no/such-course', root, indexPath);
  assert.deepEqual(result, { downloaded: 0, failed: 0 });
});

test('runCourse: returns {downloaded:0, failed:0} immediately when signal already aborted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maestro-rc-'));
  const indexPath = join(root, 'index.json');
  writeFileSync(indexPath, JSON.stringify({
    courses: [{
      slug: 'test/course', title: 'T', instructor: 'I', courseUrl: '',
      categories: [{
        title: 'A',
        videos: [{ index: 1, title: 'V', lessonUrl: '', manifestUrl: 'https://cdn/v.m3u8',
                   completed: false, downloadedAt: null, localPath: null }],
      }],
    }],
  }));
  const ac = new AbortController();
  ac.abort();
  const result = await runCourse('test/course', root, indexPath, { signal: ac.signal });
  assert.deepEqual(result, { downloaded: 0, failed: 0 });
});

// ── normalizeCpu ──────────────────────────────────────────────────────────────

import { normalizeCpu } from '../lib/download.js';

test('normalizeCpu: divides raw per-core % by core count', () => {
  assert.equal(normalizeCpu(685, 8), 86);
});

test('normalizeCpu: caps at 100 when all cores maxed', () => {
  assert.equal(normalizeCpu(850, 8), 100);
});

test('normalizeCpu: single core 100% stays 100', () => {
  assert.equal(normalizeCpu(100, 1), 100);
});

test('normalizeCpu: rounds fractional result', () => {
  assert.equal(normalizeCpu(50, 8), 6);
});

// ── computeRateMBs ──────────────────────────────────────────────────────────

test('computeRateMBs: returns null for fewer than 2 samples', () => {
  assert.equal(computeRateMBs([]), null);
  assert.equal(computeRateMBs([{ ts: 0, bytes: 1000 }]), null);
});

test('computeRateMBs: returns null when window is under 1 second', () => {
  const samples = [{ ts: 0, bytes: 0 }, { ts: 500, bytes: 1_000_000 }];
  assert.equal(computeRateMBs(samples), null);
});

test('computeRateMBs: returns null when bytes did not increase', () => {
  const samples = [{ ts: 0, bytes: 5_000_000 }, { ts: 5000, bytes: 5_000_000 }];
  assert.equal(computeRateMBs(samples), null);
});

test('computeRateMBs: computes correct MB/s from oldest to newest sample', () => {
  // 5 MB in 5 s = 1 MB/s
  const samples = [{ ts: 0, bytes: 0 }, { ts: 5000, bytes: 5_000_000 }];
  assert.ok(Math.abs(computeRateMBs(samples) - 1) < 0.001, 'expected ~1 MB/s');
});

test('computeRateMBs: uses oldest-to-newest span across multiple samples', () => {
  // 10 MB delivered over 2 s window = 5 MB/s
  const samples = [
    { ts: 0, bytes: 0 },
    { ts: 1000, bytes: 3_000_000 },
    { ts: 2000, bytes: 10_000_000 },
  ];
  assert.ok(Math.abs(computeRateMBs(samples) - 5) < 0.001, 'expected ~5 MB/s');
});

// ── finalizePart ──────────────────────────────────────────────────────────────
// Guards the .part → .webm rename. ffmpeg can exit 0 with a truncated output
// (HLS retry-exhaustion EOFs the stream gracefully), so we must verify the
// Matroska Cues trailer is present before promoting the .part file.

import { finalizePart } from '../lib/download.js';
import { unlinkSync } from 'node:fs';
import { writeWebmWithCues } from './helpers.js';

test('finalizePart: renames .part to final path when Cues trailer present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-finalize-'));
  const outputPath = join(dir, '1-Lesson.webm');
  const partPath = outputPath + '.part';
  writeWebmWithCues(partPath);

  const ok = finalizePart(partPath, outputPath);

  assert.equal(ok, true);
  assert.equal(existsSync(outputPath), true);
  assert.equal(existsSync(partPath), false);
});

test('finalizePart: refuses to rename and deletes .part when Cues missing (truncated)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-finalize-'));
  const outputPath = join(dir, '1-Lesson.webm');
  const partPath = outputPath + '.part';
  // Substantial size but no Cues element — what ffmpeg leaves on retry-exhaustion
  writeFileSync(partPath, Buffer.alloc(2_000_000));

  const ok = finalizePart(partPath, outputPath);

  assert.equal(ok, false, 'must not promote a truncated file');
  assert.equal(existsSync(outputPath), false, 'no orphan .webm at output path');
  assert.equal(existsSync(partPath), false, 'truncated .part should be cleaned up to free disk');
});

test('finalizePart: returns false and does not throw when .part file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-finalize-'));
  const outputPath = join(dir, '1-Lesson.webm');
  const partPath = outputPath + '.part';

  const ok = finalizePart(partPath, outputPath);

  assert.equal(ok, false);
  assert.equal(existsSync(outputPath), false);
});

test('finalizePart: refuses to rename a sub-1MB .part file (under-threshold partial)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-finalize-'));
  const outputPath = join(dir, '1-Lesson.webm');
  const partPath = outputPath + '.part';
  writeFileSync(partPath, Buffer.alloc(500_000));

  const ok = finalizePart(partPath, outputPath);

  assert.equal(ok, false);
  assert.equal(existsSync(outputPath), false);
});

// ── isProgressLine ────────────────────────────────────────────────────────────

test('isProgressLine: returns true for a raw ffmpeg progress chunk', () => {
  const line = '\rframe=  454 fps=8.4 q=30.0 size=    1280KiB time=00:00:18.16 bitrate= 577.4kbits/s speed=0.337x';
  assert.equal(isProgressLine(line), true);
});

test('isProgressLine: returns false for codec/stream info lines', () => {
  assert.equal(isProgressLine("Input #0, hls, from 'https://cdn.example.com/video.m3u8':"), false);
  assert.equal(isProgressLine('Stream #0:0: Video: h264, yuv420p, 1920x1080, 25 fps'), false);
  assert.equal(isProgressLine('Error: Connection timed out'), false);
});

test('isProgressLine: returns false for empty string', () => {
  assert.equal(isProgressLine(''), false);
});

test('finalizePart: accepts Cues element with CRC-32 (0xBF) first content byte (ffmpeg v8.1+ format)', () => {
  // ffmpeg v8.1+ emits a CRC-32 EBML element (0xBF) inside the Cues container
  // before CuePoint entries (0xBB). Earlier code required 0xBB as first content
  // byte and falsely rejected these as truncated — causing infinite retry loops.
  const dir = mkdtempSync(join(tmpdir(), 'maestro-finalize-'));
  const outputPath = join(dir, '1-Lesson.webm');
  const partPath = outputPath + '.part';
  const buf = Buffer.alloc(1_001_000);
  const pos = buf.length - 20;
  buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b; // Cues ID
  buf[pos + 4] = 0x85; // VINT: 1-byte length (high bit set)
  buf[pos + 5] = 0xbf; // CRC-32 element, NOT 0xBB CuePoint
  writeFileSync(partPath, buf);

  const ok = finalizePart(partPath, outputPath);

  assert.equal(ok, true, 'must accept valid Cues regardless of first content byte');
  assert.equal(existsSync(outputPath), true);
  assert.equal(existsSync(partPath), false);
});

// ── downloadVideoWithBackoff ──────────────────────────────────────────────────

const CDN_STALL_RESULT = { code: 1, stderr: '', killedForStall: true, stallFrame: 500, lastSegmentUrl: null };
const LOW_FRAME_STALL_RESULT = { code: 1, stderr: '', killedForStall: true, stallFrame: 50, lastSegmentUrl: null };
const NETWORK_ERROR_RESULT = { code: 1, stderr: 'Connection reset by peer', killedForStall: false, stallFrame: null, lastSegmentUrl: null };
const SUCCESS_RESULT = { code: 0, stderr: '', killedForStall: false, stallFrame: null, lastSegmentUrl: null };

test('DOWNLOAD_FALLBACK_DELAYS_MS are one-quarter of DOWNLOAD_DELAYS_MS', () => {
  assert.equal(DOWNLOAD_FALLBACK_DELAYS_MS.length, DOWNLOAD_DELAYS_MS.length);
  for (let i = 0; i < DOWNLOAD_DELAYS_MS.length; i++) {
    assert.equal(DOWNLOAD_FALLBACK_DELAYS_MS[i], Math.round(DOWNLOAD_DELAYS_MS[i] / 4));
  }
});

test('downloadVideoWithBackoff: returns success on first attempt without sleeping', async () => {
  const slept = [];
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    _runFfmpeg: async () => SUCCESS_RESULT,
    _finalizePart: () => true,
    _sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.success, true);
  assert.equal(slept.length, 0);
});

test('downloadVideoWithBackoff: pauses CDN_STALL_PAUSE_MS after 1st CDN stall, then succeeds', async () => {
  const slept = [];
  let call = 0;
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    _runFfmpeg: async () => (++call === 1 ? CDN_STALL_RESULT : SUCCESS_RESULT),
    _finalizePart: () => true,
    _sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.success, true);
  assert.equal(slept.length, 1);
  assert.equal(slept[0], CDN_STALL_PAUSE_MS);
});

test('downloadVideoWithBackoff: returns {success:false, reason:"stall"} after 2 CDN stalls', async () => {
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    _runFfmpeg: async () => CDN_STALL_RESULT,
    _finalizePart: () => false,
    _sleep: () => Promise.resolve(),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'stall');
});

test('downloadVideoWithBackoff: CDN stall below MIN_STALL_FRAME consumes a delay slot, not CDN pause', async () => {
  const slept = [];
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    delays: [100],
    _runFfmpeg: async () => LOW_FRAME_STALL_RESULT,
    _finalizePart: () => false,
    _sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.success, false);
  assert.ok(slept.includes(100), `expected delay 100 in slept: ${JSON.stringify(slept)}`);
  assert.ok(!slept.includes(CDN_STALL_PAUSE_MS), 'must not use CDN_STALL_PAUSE_MS for sub-threshold stalls');
});

test('downloadVideoWithBackoff: network error retries per delay array until exhausted', async () => {
  const slept = [];
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    delays: [10, 20],
    _runFfmpeg: async () => NETWORK_ERROR_RESULT,
    _finalizePart: () => false,
    _sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.success, false);
  assert.deepEqual(slept, [10, 20]);
});

test('downloadVideoWithBackoff: truncated exit-0 retries and returns reason "truncated"', async () => {
  // ffmpeg exits 0 but _finalizePart returns false (no Matroska trailer) — should
  // retry the configured number of times then give up with reason "truncated"
  const slept = [];
  const result = await downloadVideoWithBackoff('https://cdn/v.m3u8', '/out/v.webm', {}, {
    delays: [5],
    _runFfmpeg: async () => ({ code: 0, stderr: '', killedForStall: false, stallFrame: null, lastSegmentUrl: null }),
    _finalizePart: () => false,
    _sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'truncated');
  assert.deepEqual(slept, [5]);
});

test('intervideo delays are doubled for human-like appearance', () => {
  // Verify intervideo delays are 30s-90s (doubled from original 15s-45s)
  // to appear more human and less bot-like during course downloads
  assert.equal(INTER_VIDEO_DELAY_MIN_MS, 30_000);
  assert.equal(INTER_VIDEO_DELAY_MAX_MS, 90_000);
});
