#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { deriveManifestUrl, deriveOutputPath, atomicWriteJson, getEncoderSettings, buildFfmpegArgs, profileForContentType, isFileComplete, sleep, jitter } from './index-utils.js';
import { info as _info, warn as _warn, debug, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

const debugEnabled = process.env.DEBUG === 'true' || process.argv.includes('--debug');


const FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;
const FRAME_STALL_MS = 600_000;
const MIN_STALL_FRAME = 100;
const PROGRESS_INTERVAL_MS = 2_500;

export const DOWNLOAD_DELAYS_MS = [30, 60, 60, 90, 90].map(e => e * 1000 * 60);
export const DOWNLOAD_FALLBACK_DELAYS_MS = DOWNLOAD_DELAYS_MS.map(d => Math.round(d / 4));
export const CDN_STALL_PAUSE_MS = 3 * 60 * 1000;

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

export function fmtTimestamp(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Returns true if the video needs to be (re-)downloaded.
export function needsDownload(video) {
  if (!video.completed) return true;
  return !isFileComplete(video.localPath);
}

export function derivePartPath(outputPath) {
  return outputPath + '.part';
}

// Promotes a .part file to its final path, but ONLY if it carries a real
// Matroska Cues trailer. ffmpeg can exit 0 on a truncated output when the HLS
// reader gives up retrying a segment (-reconnect_delay_max), so exit code alone
// is not proof of completion. A failing .part is removed to free disk and
// surface the failure to the caller's retry logic.
export function finalizePart(partPath, outputPath) {
  if (!existsSync(partPath)) return false;
  if (!isFileComplete(partPath)) {
    try { unlinkSync(partPath); } catch { /* ignore */ }
    return false;
  }
  renameSync(partPath, outputPath);
  return true;
}

export function sweepPartFiles(root) {
  const coursesDir = join(root, 'courses');
  if (!existsSync(coursesDir)) return 0;
  return sweepDir(coursesDir);
}

function sweepDir(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += sweepDir(full);
    } else if (entry.name.endsWith('.part')) {
      try { unlinkSync(full); count++; } catch { /* ignore races */ }
    }
  }
  return count;
}

// ── Bandwidth rate ───────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 5_000;
export const INTER_VIDEO_DELAY_MIN_MS = 30_000;
export const INTER_VIDEO_DELAY_MAX_MS = 90_000;

// samples: [{ ts: number, bytes: number }], sorted oldest-first.
// Returns rolling average MB/s (encode output rate) across the full span,
// or null if insufficient data. Measures the .part file growth rate, not CDN
// download speed — the two differ by the AV1 compression ratio.
export function computeRateMBs(samples) {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const deltaMs = last.ts - first.ts;
  const deltaBytes = last.bytes - first.bytes;
  if (deltaMs < 1000 || deltaBytes <= 0) return null;
  return deltaBytes / (deltaMs / 1000) / 1_000_000;
}

// ── CPU polling ──────────────────────────────────────────────────────────────

const NUM_CPUS = cpus().length;

export function normalizeCpu(rawPct, numCpus) {
  return Math.min(100, Math.round(rawPct / numCpus));
}

function pollCpu(pid, callback) {
  execFile('ps', ['-o', '%cpu=', '-p', String(pid)], (err, stdout) => {
    if (err) return;
    const raw = parseFloat(stdout.trim());
    if (!isNaN(raw)) callback(normalizeCpu(raw, NUM_CPUS));
  });
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

function drawProgress(timeSec, totalSec, sizeKb, fps, speed, cpuPct = null, mbps = null) {
  let line;
  const mbpsPart = mbps != null ? `| ${mbps.toFixed(1)} MB/s |` : null;
  if (totalSec !== null && totalSec > 0 && timeSec !== null && timeSec >= 0) {
    const ratio = Math.min(timeSec / totalSec, 1);
    const pct = Math.round(ratio * 100);
    const parts = [`[${renderBar(ratio)}] ${String(pct).padStart(3)}%`];
    if (fps && fps > 0) parts.push(`fps=${Math.round(fps)}`);
    if (cpuPct != null) parts.push(`cpu:${Math.round(cpuPct)}%`);
    if (sizeKb) parts.push(fmtSize(sizeKb));
    if (mbpsPart) parts.push(mbpsPart);
    const eta = fmtEta(timeSec, totalSec, speed);
    if (eta) parts.push(eta);
    line = '  ' + parts.join('  ');
  } else {
    const parts = ['  [encoding...]'];
    if (fps && fps > 0) parts.push(`fps=${Math.round(fps)}`);
    if (cpuPct != null) parts.push(`cpu:${Math.round(cpuPct)}%`);
    if (sizeKb) parts.push(fmtSize(sizeKb));
    if (mbpsPart) parts.push(mbpsPart);
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
    let lastTimeSec = null;
    let lastSizeKb = null;
    let lastFps = null;
    let lastSpeed = null;
    let lastCpuPct = null;
    let lastMbps = null;
    const rateSamples = [];

    const args = buildFfmpegArgs(inputUrl, outputPath, settings);
    debug(`taskpolicy -c utility nice -n 20 ffmpeg ${args.join(' ')}`);
    const proc = spawn('taskpolicy', ['-c', 'utility', 'nice', '-n', '20', 'ffmpeg', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });

    drawProgress(null, null, null, null, null, null, null);
    const progressInterval = setInterval(() => {
      if (proc.pid) pollCpu(proc.pid, pct => { lastCpuPct = pct; });
      try {
        const bytes = statSync(outputPath).size;
        const ts = Date.now();
        rateSamples.push({ ts, bytes });
        const cutoff = ts - RATE_WINDOW_MS;
        while (rateSamples.length > 1 && rateSamples[0].ts < cutoff) rateSamples.shift();
        lastMbps = computeRateMBs(rateSamples);
      } catch { /* part file not yet created */ }
      drawProgress(lastTimeSec, totalDurationSec, lastSizeKb, lastFps, lastSpeed, lastCpuPct, lastMbps);
    }, PROGRESS_INTERVAL_MS);

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
        lastTimeSec = progress.timeSec;
        if (progress.sizeKb != null) lastSizeKb = progress.sizeKb;
        if (progress.fps != null) lastFps = progress.fps;
        if (progress.speed != null) lastSpeed = progress.speed;
      }

      if (debugEnabled && !isProgressLine(chunk)) process.stderr.write(chunk);
    });

    proc.on('close', (code) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      clearInterval(progressInterval);
      clearProgress();
      resolve({ code, stderr: stderrBuf, killedForStall, stallFrame: killedForStall ? lastFrame : null, lastSegmentUrl });
    });

    proc.on('error', (err) => {
      clearTimeout(watchdog);
      clearInterval(frameWatchdog);
      clearInterval(progressInterval);
      clearProgress();
      resolve({ code: -1, stderr: err.message, killedForStall, stallFrame: null });
    });
  });
}

// Returns true for ffmpeg's \r-terminated progress lines (frame=, fps=, time=, ...).
// Used to suppress these from debug forwarding — they conflict with our styled progress bar.
export function isProgressLine(chunk) {
  return /frame=\s*\d+/.test(chunk);
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

export async function recordCompletion(indexPath, courseSlug, lessonUrl, outputPath, resolution = null) {
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
        ...(resolution !== null && { actualResolution: resolution }),
      };
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Video not found in index: ${lessonUrl}`);
  await atomicWriteJson(indexPath, fresh);
}


export async function downloadVideoWithBackoff(inputUrl, outputPath, settings, {
  delays = DOWNLOAD_DELAYS_MS,
  _runFfmpeg = runFfmpeg,
  _sleep = sleep,
  _finalizePart = finalizePart,
} = {}) {
  const partPath = derivePartPath(outputPath);
  let lastStderr = '';
  let lastReason = 'encode-error';
  let stallCount = 0;
  let nonStallAttempt = 0;

  while (true) {
    if (nonStallAttempt > 0 || stallCount > 0) {
      info(`  [${fmtTimestamp()}] [attempt ${nonStallAttempt + 1}] retrying...`);
    }
    const { code, stderr, killedForStall, stallFrame } = await _runFfmpeg(inputUrl, partPath, settings);
    lastStderr = stderr;
    let truncatedExit0 = false;
    if (code === 0) {
      if (_finalizePart(partPath, outputPath)) return { success: true };
      // ffmpeg exited 0 but no Matroska trailer — HLS reader EOF'd after segment retries.
      const snippet = lastStderr.trim().split('\n').pop()?.slice(-120) ?? '';
      warn(`  ffmpeg exited 0 but output lacks Matroska trailer — truncated, will retry${snippet ? ': ' + snippet : ''}`);
      truncatedExit0 = true;
    }

    const isCdnStall = killedForStall && stallFrame !== null && stallFrame >= MIN_STALL_FRAME;

    if (isCdnStall) {
      stallCount++;
      if (stallCount >= 2) {
        return { success: false, reason: 'stall' };
      }
      info(`  [${fmtTimestamp()}] CDN stall at frame ${stallFrame} — pausing ${Math.round(CDN_STALL_PAUSE_MS / 60000)}m then retrying at same quality`);
      await _sleep(CDN_STALL_PAUSE_MS);
      continue;
    }

    const isRl = isRateLimitError(stderr);
    const isNet = isNetworkError(stderr);
    const retriable = isRl || isNet || killedForStall || truncatedExit0;

    if (killedForStall) lastReason = 'network';
    else if (isRl) lastReason = 'rate-limit';
    else if (truncatedExit0) lastReason = 'truncated';
    else if (isNet) lastReason = 'network';
    else lastReason = 'encode-error';

    if (!retriable || nonStallAttempt >= delays.length) {
      const snippet = lastStderr.trim().split('\n').pop()?.slice(-120) ?? '';
      warn(`  ffmpeg failed (exit ${code})${snippet ? ': ' + snippet : ''}`);
      return { success: false, reason: lastReason };
    }

    const wait = delays[nonStallAttempt];
    const retryLabel = lastReason === 'rate-limit' ? 'rate limited (429/503)'
      : lastReason === 'truncated' ? 'truncated output (HLS retry exhausted)'
      : 'network error';
    info(`  [retry ${nonStallAttempt + 1}/${delays.length}] ${retryLabel} — waiting ${Math.round(wait / 60000)}m`);
    await _sleep(wait);
    nonStallAttempt++;
  }
}

// Runs all pending downloads for one course. Caller is responsible for sweeping
// .part files and reconciling index.json before/after. signal is an optional
// AbortSignal; when aborted the current video finishes and the loop exits.
export async function runCourse(courseSlug, root, indexPath, { profile = null, archive = false, signal = null } = {}) {
  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    error('index.json is corrupted. Run /fetch-list to rebuild it.');
    return { downloaded: 0, failed: 0 };
  }

  const course = (indexData.courses ?? []).find(
    (c) => c.slug === courseSlug || c.slug.endsWith(`/${courseSlug}`) || c.title.toLowerCase() === courseSlug.toLowerCase(),
  );
  if (!course) {
    const available = (indexData.courses ?? []).map(c => c.slug).join('\n  ');
    error(`Course not found: "${courseSlug}"\nAvailable courses:\n  ${available}`);
    return { downloaded: 0, failed: 0 };
  }

  const effectiveProfile = profile ?? profileForContentType(course.contentType);
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
    return { downloaded: 0, failed: 0 };
  }

  let downloaded = 0;
  let failed = 0;
  const sessionStart = Date.now();

  for (let i = 0; i < pending.length; i++) {
    const video = pending[i];
    if (signal?.aborted) break;

    if (!video.manifestUrl) {
      info(`\n[${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title} — no manifest URL (run /fetch-list)`);
      failed++;
      continue;
    }

    const inputUrl = deriveManifestUrl(video.manifestUrl, encoderSettings.resolution);
    const outputPath = deriveOutputPath(root, course.slug, video.categoryTitle, video.index, video.title);

    const redownloadTag = video.completed ? '  [re-download: file missing or incomplete]' : '';
    info(`\n[${fmtTimestamp()}] [${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title}${redownloadTag}`);
    info(`  Category: ${video.categoryTitle}`);
    info(`  Output:   ${outputPath}`);

    mkdirSync(dirname(outputPath), { recursive: true });

    const videoStart = Date.now();
    let result = await downloadVideoWithBackoff(inputUrl, outputPath, encoderSettings);
    let actualResolution = null;

    if (!result.success && encoderSettings.resolution === '1080p' && result.reason !== 'rate-limit') {
      const fallbackUrl = deriveManifestUrl(video.manifestUrl, '720p');
      // stall already paused CDN_STALL_PAUSE_MS internally before giving up — no extra cooldown needed
      if (result.reason === 'network' || result.reason === 'truncated') {
        const cooldown = jitter(60_000, 120_000);
        info(`  [${fmtTimestamp()}] [720p fallback] 1080p exhausted (${result.reason}) — cooling ${Math.round(cooldown / 1000)}s then retrying at 720p`);
        await sleep(cooldown);
      } else {
        info(`  [${fmtTimestamp()}] [720p fallback] 1080p exhausted (${result.reason}) — retrying at 720p`);
      }
      result = await downloadVideoWithBackoff(fallbackUrl, outputPath, encoderSettings, { delays: DOWNLOAD_FALLBACK_DELAYS_MS });
      if (result.success) actualResolution = '720p';
    }

    if (result.success) {
      downloaded++;
      await recordCompletion(indexPath, course.slug, video.lessonUrl, outputPath, actualResolution);
      const elapsed = fmtElapsed(Date.now() - videoStart);
      let sizeStr = '';
      try { sizeStr = ` — ${fmtSize(Math.round(statSync(outputPath).size / 1024))}`; } catch {}
      info(`  ✓ Done in ${elapsed}${sizeStr}${actualResolution ? ' [720p fallback]' : ''}`);
    } else {
      failed++;
      info(`  ✗ Failed`);
    }

    const isLastVideo = i === pending.length - 1;
    if (!isLastVideo && !signal?.aborted) {
      const delay = jitter(INTER_VIDEO_DELAY_MIN_MS, INTER_VIDEO_DELAY_MAX_MS);
      info(`  Cooling down ${Math.round(delay / 1000)}s before next video...`);
      await sleep(delay);
    }
  }

  info(`\nComplete: ${downloaded} downloaded, ${failed} failed  [${fmtElapsed(Date.now() - sessionStart)}]`);
  return { downloaded, failed };
}

// Block idle sleep while we run. -w <pid> ties caffeinate's lifetime to ours,
// so it auto-releases the assertion on any exit (clean, crash, SIGKILL).
function preventIdleSleep() {
  const c = spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' });
  // ENOENT (non-macOS / CI / caffeinate missing) fires async — must listen or node crashes.
  c.on('error', () => { /* caffeinate not available; proceed without sleep block */ });
  c.unref();
}

async function main() {
  preventIdleSleep();
  const root = process.env.MAESTRO_ROOT?.trim();
  const qualityEnv = process.env.MAESTRO_QUALITY?.trim();
  if (!root) { error('MAESTRO_ROOT not set. Run /setup first.'); process.exit(1); }
  if (!qualityEnv) { error('MAESTRO_QUALITY not set. Run /setup first.'); process.exit(1); }

  const args = process.argv.slice(2);
  const profileIdx = args.indexOf('--profile');
  const profile = profileIdx !== -1 ? args[profileIdx + 1] : null;
  const archive = args.includes('--archive');
  const courseSlug = args
    .filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--profile')
    .join(' ').trim();

  const validProfiles = ['speech', 'music', 'lean', 'visual'];
  if (profile !== null && !validProfiles.includes(profile)) {
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

  const swept = sweepPartFiles(root);
  if (swept > 0) info(`Swept ${swept} orphaned .part file(s) from previous interrupted download(s)`);

  await runCourse(courseSlug, root, indexPath, { profile, archive });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
