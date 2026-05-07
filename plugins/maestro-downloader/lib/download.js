#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { deriveManifestUrl, deriveOutputPath, atomicWriteJson, getEncoderSettings, buildFfmpegArgs, profileForContentType } from './index-utils.js';
import { info, warn, debug, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000; // 20 min hard ceiling
const FRAME_STALL_MS = 45_000;            // 45s with no frame advance = CDN segment stall
const MIN_STALL_FRAME = 500;              // stall must be >500 frames in to qualify for segment-skip
const MIN_SKIP_OUTPUT_BYTES = 1_000_000; // <1 MB after segment-skip = treat as failed (connectivity loss)

async function runFfmpeg(inputUrl, outputPath, settings) {
  return new Promise((resolve) => {
    let stderrBuf = '';
    let lastFrame = -1;
    let lastFrameAt = Date.now();
    let killedForStall = false;
    let lastSegmentUrl = null;

    const args = buildFfmpegArgs(inputUrl, outputPath, settings);
    debug(`nice -n 20 ffmpeg ${args.join(' ')}`);
    const proc = spawn('nice', ['-n', '20', 'ffmpeg', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });

    const watchdog = setTimeout(() => {
      warn(`ffmpeg exceeded ${FFMPEG_TIMEOUT_MS / 60000} min timeout — killing`);
      proc.kill('SIGKILL');
    }, FFMPEG_TIMEOUT_MS);

    // Frame-advance watchdog: kills ffmpeg when CDN stalls mid-segment.
    // -timeout 30000000 does not fire when the CDN sends partial segment data then
    // goes silent — the socket stays alive so no timeout is triggered.
    const frameWatchdog = setInterval(() => {
      const frame = parseLastFrame(stderrBuf);
      if (frame !== null && frame > lastFrame) {
        lastFrame = frame;
        lastFrameAt = Date.now();
      }
      const stallMs = Date.now() - lastFrameAt;
      if (lastFrame >= 0 && stallMs > FRAME_STALL_MS && !killedForStall) {
        warn(`ffmpeg stalled at frame ${lastFrame} for ${Math.round(stallMs / 1000)}s — killing for retry`);
        killedForStall = true;
        proc.kill('SIGKILL');
      }
    }, 5000);

    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf = (stderrBuf + chunk).slice(-4096);
      const seg = chunk.match(/Opening '(https?:\/\/[^']+\.ts)' for reading/);
      if (seg) lastSegmentUrl = seg[1];
      process.stderr.write(chunk);
    });
    proc.on('close', (code) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      resolve({ code, stderr: stderrBuf, killedForStall, stallFrame: killedForStall ? lastFrame : null, lastSegmentUrl });
    });
    proc.on('error', (err) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      resolve({ code: -1, stderr: err.message, killedForStall, stallFrame: null });
    });
  });
}

export function isRateLimitError(stderr) {
  return /server returned (429|503)|too many requests|service unavailable/i.test(stderr);
}

export function isNetworkError(stderr) {
  return /timed out|connection reset|connection refused|broken pipe/i.test(stderr);
}

export function parseLastFrame(stderrBuf) {
  const matches = stderrBuf.match(/frame=\s*(\d+)/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[matches.length - 1].replace(/frame=\s*/, ''), 10);
}

export async function recordCompletion(indexPath, courseSlug, lessonUrl, outputPath) {
  const fresh = JSON.parse(readFileSync(indexPath, 'utf8'));
  const course = (fresh.courses ?? []).find(c => c.slug === courseSlug);
  if (!course) throw new Error(`Course not found in index: ${courseSlug}`);
  let found = false;
  for (const cat of course.categories) {
    const vidIdx = cat.videos.findIndex(v => v.lessonUrl === lessonUrl);
    if (vidIdx !== -1) {
      cat.videos[vidIdx] = {
        ...cat.videos[vidIdx],
        completed: true,
        downloadedAt: new Date().toISOString(),
        localPath: outputPath,
      };
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Video not found in index: ${lessonUrl}`);
  await atomicWriteJson(indexPath, fresh);
}

export function extractBadSegmentUrl(stderrBuf) {
  const matches = [...stderrBuf.matchAll(/Opening '(https?:\/\/[^']+\.ts)' for reading/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

export function patchManifest(manifestText, badSegmentUrl) {
  const badFilename = badSegmentUrl.split('/').pop();
  const lines = manifestText.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === badSegmentUrl || trimmed.endsWith(badFilename)) {
      if (result.length > 0 && result[result.length - 1].trimStart().startsWith('#EXTINF:')) {
        result.pop();
      }
      continue;
    }
    result.push(lines[i]);
  }
  return result.join('\n');
}

export function isConsistentStall(stallFrames) {
  if (stallFrames.length < 2) return false;
  const max = Math.max(...stallFrames);
  const min = Math.min(...stallFrames);
  return max === 0 ? false : (max - min) / max < 0.10;
}

async function fetchManifest(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function attemptSegmentSkip(variantUrl, outputPath, settings, badSegmentUrl) {
  info(`Segment skip: fetching manifest to patch out bad segment ${badSegmentUrl.split('/').pop()}`);
  const manifestText = await fetchManifest(variantUrl);
  if (!manifestText) {
    warn('Segment skip: could not fetch manifest — skipping');
    return false;
  }
  const patched = patchManifest(manifestText, badSegmentUrl);
  if (patched === manifestText) {
    warn(`Segment skip: bad segment not found in manifest — skipping`);
    return false;
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-skip-'));
  const tmpManifest = join(tmpDir, 'playlist.m3u8');
  try {
    writeFileSync(tmpManifest, patched);
    const { code } = await runFfmpeg(`file://${tmpManifest}`, outputPath, settings);
    if (code !== 0) {
      warn(`Segment skip: ffmpeg exited ${code}`);
      return false;
    }
    const { size } = statSync(outputPath);
    if (size < MIN_SKIP_OUTPUT_BYTES) {
      warn(`Segment skip: output too small (${size} bytes) — likely a connectivity failure, discarding`);
      return false;
    }
    info(`Segment skip: succeeded — one segment omitted from output`);
    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadVideoWithBackoff(inputUrl, outputPath, settings) {
  const delays = [5000, 10000, 20000, 40000, 60000];
  const stallFrames = [];
  let lastStderr = '';

  let lastSegmentUrl = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { code, stderr, killedForStall, stallFrame, lastSegmentUrl: segUrl } = await runFfmpeg(inputUrl, outputPath, settings);
    if (code === 0) return true;
    lastStderr = stderr;
    if (segUrl) lastSegmentUrl = segUrl;

    if (killedForStall && stallFrame !== null && stallFrame >= MIN_STALL_FRAME) {
      stallFrames.push(stallFrame);
    }

    // After 3 consistent stalls at the same segment, skip the bad segment immediately
    // rather than burning all remaining retries on the same dead CDN segment.
    if (stallFrames.length >= 3 && isConsistentStall(stallFrames)) {
      if (lastSegmentUrl) return attemptSegmentSkip(inputUrl, outputPath, settings, lastSegmentUrl);
    }

    const retriable = isRateLimitError(stderr) || isNetworkError(stderr) || killedForStall;
    if (!retriable || attempt === delays.length) {
      warn(`ffmpeg failed (exit ${code})`);
      return false;
    }
    const wait = delays[attempt];
    const reason = killedForStall ? 'CDN segment stall'
      : isRateLimitError(stderr) ? 'Rate limited'
      : 'Network error';
    debug(`backoff: waiting ${wait / 1000}s (attempt ${attempt + 1})`);
    info(`${reason} — waiting ${wait / 1000}s before retry ${attempt + 1}...`);
    await sleep(wait);
  }
  return false;
}

async function main() {
  const root = process.env.MAESTRO_ROOT?.trim();
  const qualityEnv = process.env.MAESTRO_QUALITY?.trim();
  if (!root) { error('MAESTRO_ROOT not set. Run /setup first.'); process.exit(1); }
  if (!qualityEnv) { error('MAESTRO_QUALITY not set. Run /setup first.'); process.exit(1); }

  const args = process.argv.slice(2);
  const profileIdx = args.indexOf('--profile');
  const profile = profileIdx !== -1 ? args[profileIdx + 1] : 'speech';
  const archive = args.includes('--archive');
  const courseSlug = args
    .filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--profile')
    .join(' ').trim();

  const validProfiles = ['speech', 'music', 'lean', 'visual'];
  if (!validProfiles.includes(profile)) {
    error(`Invalid --profile: ${profile}. Must be one of: ${validProfiles.join(', ')}`);
    process.exit(1);
  }

  if (!courseSlug) {
    error(
      'Usage: node lib/download.js <course-slug> [--profile speech|music|lean] [--archive]\n' +
      'Example: node lib/download.js mark-ronson/music-production --profile music\n' +
      'Example: node lib/download.js oliver-burkeman/time-management --profile lean\n' +
      'Example: node lib/download.js jojo-moyes/writing-love-stories --archive'
    );
    process.exit(1);
  }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    error('No index.json found. Run /fetch-list first.');
    process.exit(1);
  }

  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    error('index.json is corrupted. Run /fetch-list to rebuild it.');
    process.exit(1);
  }

  const course = (indexData.courses ?? []).find(
    (c) => c.slug === courseSlug || c.slug.endsWith(`/${courseSlug}`) || c.title.toLowerCase() === courseSlug.toLowerCase(),
  );
  if (!course) {
    const available = (indexData.courses ?? []).map(c => c.slug).join('\n  ');
    error(`Course not found: "${courseSlug}"\nAvailable courses:\n  ${available}`);
    process.exit(1);
  }

  const effectiveProfile = profileIdx !== -1
    ? profile
    : profileForContentType(course.contentType);
  const encoderSettings = getEncoderSettings(effectiveProfile, archive);

  const allVideos = course.categories.flatMap(cat =>
    cat.videos.map(v => ({ ...v, categoryTitle: cat.title })),
  );
  const pending = allVideos.filter(v => !v.completed);
  const total = allVideos.length;

  info(`Course: ${course.title} — ${course.instructor}`);
  info(`Quality: ${encoderSettings.description}`);
  info(`Videos: ${total} total, ${pending.length} to download, ${total - pending.length} already done`);

  if (pending.length === 0) {
    info('All videos already downloaded.');
    process.exit(0);
  }

  let downloaded = 0;
  let failed = 0;

  for (const video of pending) {
    if (!video.manifestUrl) {
      info(`  [SKIP] ${video.index}. ${video.title} — no manifest URL (run /fetch-list to capture it)`);
      failed++;
      continue;
    }

    const inputUrl = deriveManifestUrl(video.manifestUrl, encoderSettings.resolution);
    const outputPath = deriveOutputPath(root, course.slug, video.categoryTitle, video.index, video.title);

    info(`\n[${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title}`);
    info(`  → ${outputPath}`);

    mkdirSync(dirname(outputPath), { recursive: true });

    const success = await downloadVideoWithBackoff(inputUrl, outputPath, encoderSettings);

    if (success) {
      downloaded++;
      await recordCompletion(indexPath, course.slug, video.lessonUrl, outputPath);
      info(`  ✓ Done`);
    } else {
      failed++;
      info(`  ✗ Failed`);
    }
  }

  info(`\nComplete: ${downloaded} downloaded, ${failed} failed.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
