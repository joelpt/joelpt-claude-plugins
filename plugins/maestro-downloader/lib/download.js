#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { deriveManifestUrl, deriveOutputPath, atomicWriteJson, getEncoderSettings, buildFfmpegArgs, profileForContentType, MIN_COMPLETE_FILE_BYTES } from './index-utils.js';
import { info as _info, warn as _warn, debug, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

const debugEnabled = process.env.DEBUG === 'true' || process.argv.includes('--debug');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;
const FRAME_STALL_MS = 45_000;
const MIN_STALL_FRAME = 500;
const MIN_SKIP_OUTPUT_BYTES = 1_000_000;
const NON_TTY_PROGRESS_INTERVAL_MS = 30_000;

// ── Progress helpers (pure, exported for tests) ───────────────────────────────

export function parseTimeSeconds(timeStr) {
  const m = timeStr?.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]) : null;
}

export function parseDurationSec(stderrBuf) {
  const m = stderrBuf?.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
  return m ? parseTimeSeconds(m[1]) : null;
}

export function parseFfmpegProgress(chunk) {
  const timeM = chunk?.match(/time=\s*(-?\d+:\d+:\d+(?:\.\d+)?)/);
  if (!timeM) return null;
  const sizeM = chunk.match(/size=\s*(\d+)\s*Ki?B/i);
  const fpsM = chunk.match(/fps=\s*([\d.]+)/);
  const speedM = chunk.match(/speed=\s*([\d.]+)x/);
  return {
    timeSec: parseTimeSeconds(timeM[1]),
    sizeKb: sizeM ? parseInt(sizeM[1]) : null,
    fps: fpsM ? parseFloat(fpsM[1]) : null,
    speed: speedM ? parseFloat(speedM[1]) : null,
  };
}

export function fmtSize(kb) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}MB`;
  return `${kb}kB`;
}

export function fmtEta(currentSec, totalSec, speed) {
  if (!speed || speed <= 0 || !totalSec || currentSec >= totalSec) return '';
  const remaining = (totalSec - currentSec) / speed;
  if (remaining <= 0) return '';
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

// Returns true if the video needs to be (re-)downloaded.
// Trusts index.json's completed flag only when the file on disk meets the
// minimum size; partial downloads from killed ffmpeg runs pass size > 0 but
// will be under the threshold.
export function needsDownload(video) {
  if (!video.completed) return true;
  if (!video.localPath) return true;
  try {
    return statSync(video.localPath).size < MIN_COMPLETE_FILE_BYTES;
  } catch {
    return true;
  }
}

// ── TTY progress bar (non-exported, display-only) ────────────────────────────

let progressLineActive = false;

function renderBar(ratio, width = 28) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function clearProgress() {
  if (progressLineActive) {
    process.stdout.write('\r\x1b[2K');
    progressLineActive = false;
  }
}

function drawProgress(timeSec, totalSec, sizeKb, fps, speed) {
  let line;
  if (totalSec !== null && totalSec > 0 && timeSec !== null && timeSec >= 0) {
    const ratio = Math.min(timeSec / totalSec, 1);
    const pct = Math.round(ratio * 100);
    const parts = [`[${renderBar(ratio)}] ${String(pct).padStart(3)}%`];
    if (fps && fps > 0) parts.push(`fps=${Math.round(fps)}`);
    if (sizeKb) parts.push(fmtSize(sizeKb));
    const eta = fmtEta(timeSec, totalSec, speed);
    if (eta) parts.push(eta);
    line = '  ' + parts.join('  ');
  } else {
    const parts = ['  [encoding...]'];
    if (fps && fps > 0) parts.push(`fps=${Math.round(fps)}`);
    if (sizeKb) parts.push(fmtSize(sizeKb));
    line = parts.join('  ');
  }
  process.stdout.write('\r' + line.padEnd(process.stdout.columns ?? 80));
  progressLineActive = true;
}

// ── Local info/warn wrappers — auto-clear progress bar before printing ────────

function info(msg) { clearProgress(); _info(msg); }
function warn(msg) { clearProgress(); _warn(msg); }

// ── ffmpeg process ────────────────────────────────────────────────────────────

async function runFfmpeg(inputUrl, outputPath, settings) {
  return new Promise((resolve) => {
    let stderrBuf = '';
    let lastFrame = -1;
    let lastFrameAt = Date.now();
    let killedForStall = false;
    let lastSegmentUrl = null;
    let totalDurationSec = null;
    let lastNonTtyReport = Date.now();

    const args = buildFfmpegArgs(inputUrl, outputPath, settings);
    debug(`nice -n 20 ffmpeg ${args.join(' ')}`);
    const proc = spawn('nice', ['-n', '20', 'ffmpeg', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });

    const watchdog = setTimeout(() => {
      warn(`ffmpeg exceeded ${FFMPEG_TIMEOUT_MS / 60000} min timeout — killing`);
      proc.kill('SIGKILL');
    }, FFMPEG_TIMEOUT_MS);

    // Kills ffmpeg when CDN stalls mid-segment (socket stays alive so -timeout doesn't fire).
    const frameWatchdog = setInterval(() => {
      const frame = parseLastFrame(stderrBuf);
      if (frame !== null && frame > lastFrame) {
        lastFrame = frame;
        lastFrameAt = Date.now();
      }
      const stallMs = Date.now() - lastFrameAt;
      if (lastFrame >= 0 && stallMs > FRAME_STALL_MS && !killedForStall) {
        warn(`CDN stall at frame ${lastFrame} (${Math.round(stallMs / 1000)}s no progress) — killing for retry`);
        killedForStall = true;
        proc.kill('SIGKILL');
      }
    }, 5000);

    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf = (stderrBuf + chunk).slice(-4096);

      const seg = chunk.match(/Opening '(https?:\/\/[^']+\.ts)' for reading/);
      if (seg) lastSegmentUrl = seg[1];

      if (totalDurationSec === null) {
        totalDurationSec = parseDurationSec(stderrBuf);
      }

      const progress = parseFfmpegProgress(chunk);
      if (progress?.timeSec !== null && progress?.timeSec >= 0) {
        if (process.stdout.isTTY) {
          drawProgress(progress.timeSec, totalDurationSec, progress.sizeKb, progress.fps, progress.speed);
        } else {
          const now = Date.now();
          if (now - lastNonTtyReport >= NON_TTY_PROGRESS_INTERVAL_MS) {
            lastNonTtyReport = now;
            const parts = [];
            if (totalDurationSec && totalDurationSec > 0) {
              parts.push(`${Math.round(progress.timeSec / totalDurationSec * 100)}%`);
            }
            if (progress.fps && progress.fps > 0) parts.push(`fps=${Math.round(progress.fps)}`);
            if (progress.sizeKb) parts.push(fmtSize(progress.sizeKb));
            const eta = fmtEta(progress.timeSec, totalDurationSec, progress.speed);
            if (eta) parts.push(eta);
            if (parts.length) _info(`  [${parts.join('  ')}]`);
          }
        }
      }

      if (debugEnabled) process.stderr.write(chunk);
    });

    proc.on('close', (code) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      clearProgress();
      resolve({ code, stderr: stderrBuf, killedForStall, stallFrame: killedForStall ? lastFrame : null, lastSegmentUrl });
    });

    proc.on('error', (err) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      clearProgress();
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
  const segName = badSegmentUrl.split('/').pop();
  info(`  [patch] Bad segment: ${segName} — fetching manifest to skip it`);
  const manifestText = await fetchManifest(variantUrl);
  if (!manifestText) {
    warn('  [patch] Could not fetch manifest — skipping video');
    return false;
  }
  const patched = patchManifest(manifestText, badSegmentUrl);
  if (patched === manifestText) {
    warn(`  [patch] Segment ${segName} not found in manifest — skipping video`);
    return false;
  }
  info(`  [patch] Patched out ${segName}, re-encoding without it`);
  const tmpDir = mkdtempSync(join(tmpdir(), 'maestro-skip-'));
  const tmpManifest = join(tmpDir, 'playlist.m3u8');
  try {
    writeFileSync(tmpManifest, patched);
    const { code } = await runFfmpeg(`file://${tmpManifest}`, outputPath, settings);
    if (code !== 0) {
      warn(`  [patch] Re-encode exited ${code} — video failed`);
      return false;
    }
    const { size } = statSync(outputPath);
    if (size < MIN_SKIP_OUTPUT_BYTES) {
      warn(`  [patch] Output only ${fmtSize(Math.round(size / 1024))} — likely connectivity loss, discarding`);
      return false;
    }
    info(`  [patch] Succeeded — ${segName} omitted from final file`);
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
    if (attempt > 0) {
      info(`  [attempt ${attempt + 1}/${delays.length + 1}] retrying...`);
    }
    const { code, stderr, killedForStall, stallFrame, lastSegmentUrl: segUrl } = await runFfmpeg(inputUrl, outputPath, settings);
    if (code === 0) return true;
    lastStderr = stderr;
    if (segUrl) lastSegmentUrl = segUrl;

    if (killedForStall && stallFrame !== null && stallFrame >= MIN_STALL_FRAME) {
      stallFrames.push(stallFrame);
    }

    if (stallFrames.length >= 3 && isConsistentStall(stallFrames)) {
      if (lastSegmentUrl) return attemptSegmentSkip(inputUrl, outputPath, settings, lastSegmentUrl);
    }

    const retriable = isRateLimitError(stderr) || isNetworkError(stderr) || killedForStall;
    if (!retriable || attempt === delays.length) {
      const snippet = lastStderr.trim().split('\n').pop()?.slice(-120) ?? '';
      warn(`  ffmpeg failed (exit ${code})${snippet ? ': ' + snippet : ''}`);
      return false;
    }

    const wait = delays[attempt];
    const reason = killedForStall ? `CDN stall at frame ${stallFrame}`
      : isRateLimitError(stderr) ? 'rate limited (429/503)'
      : 'network error';
    info(`  [retry ${attempt + 1}/${delays.length}] ${reason} — waiting ${wait / 1000}s`);
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
  const pending = allVideos.filter(v => needsDownload(v));
  const redownloads = pending.filter(v => v.completed).length;
  const total = allVideos.length;

  info(`Course: ${course.title} — ${course.instructor}`);
  info(`Quality: ${encoderSettings.description}`);
  info(`Videos: ${total} total, ${pending.length} to download, ${total - pending.length} confirmed on disk`);
  if (redownloads > 0) {
    info(`  Note: ${redownloads} previously-completed video(s) have missing or undersized files — re-downloading`);
  }

  if (pending.length === 0) {
    info('All videos confirmed on disk.');
    process.exit(0);
  }

  let downloaded = 0;
  let failed = 0;
  const sessionStart = Date.now();

  for (const video of pending) {
    if (!video.manifestUrl) {
      info(`\n[${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title} — no manifest URL (run /fetch-list)`);
      failed++;
      continue;
    }

    const inputUrl = deriveManifestUrl(video.manifestUrl, encoderSettings.resolution);
    const outputPath = deriveOutputPath(root, course.slug, video.categoryTitle, video.index, video.title);

    const redownloadTag = video.completed ? '  [re-download: file missing or undersized]' : '';
    info(`\n[${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title}${redownloadTag}`);
    info(`  Category: ${video.categoryTitle}`);
    info(`  Output:   ${outputPath}`);

    mkdirSync(dirname(outputPath), { recursive: true });

    const videoStart = Date.now();
    const success = await downloadVideoWithBackoff(inputUrl, outputPath, encoderSettings);

    if (success) {
      downloaded++;
      await recordCompletion(indexPath, course.slug, video.lessonUrl, outputPath);
      const elapsed = fmtElapsed(Date.now() - videoStart);
      let sizeStr = '';
      try { sizeStr = ` — ${fmtSize(Math.round(statSync(outputPath).size / 1024))}`; } catch {}
      info(`  ✓ Done in ${elapsed}${sizeStr}`);
    } else {
      failed++;
      info(`  ✗ Failed`);
    }
  }

  info(`\nComplete: ${downloaded} downloaded, ${failed} failed  [${fmtElapsed(Date.now() - sessionStart)}]`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
