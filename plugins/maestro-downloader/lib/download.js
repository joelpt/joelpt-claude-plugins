#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { deriveManifestUrl, deriveOutputPath, atomicWriteJson, getEncoderSettings, buildFfmpegArgs, profileForContentType } from './index-utils.js';
import { info, warn, debug, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — covers any legitimate video length

async function runFfmpeg(inputUrl, outputPath, settings) {
  return new Promise((resolve) => {
    let stderrBuf = '';
    const args = buildFfmpegArgs(inputUrl, outputPath, settings);
    debug(`ffmpeg ${args.join(' ')}`);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'pipe'] });

    const watchdog = setTimeout(() => {
      warn(`ffmpeg exceeded ${FFMPEG_TIMEOUT_MS / 60000} min timeout — killing`);
      proc.kill('SIGKILL');
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf = (stderrBuf + chunk).slice(-4096);
      process.stderr.write(chunk);
    });
    proc.on('close', (code) => { clearTimeout(watchdog); resolve({ code, stderr: stderrBuf }); });
    proc.on('error', (err) => { clearTimeout(watchdog); resolve({ code: -1, stderr: err.message }); });
  });
}

export function isRateLimitError(stderr) {
  return /server returned (429|503)|too many requests|service unavailable/i.test(stderr);
}

export function isNetworkError(stderr) {
  return /timed out|connection reset|connection refused|broken pipe/i.test(stderr);
}

async function downloadVideoWithBackoff(inputUrl, outputPath, settings) {
  const delays = [5000, 10000, 20000, 40000, 60000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { code, stderr } = await runFfmpeg(inputUrl, outputPath, settings);
    if (code === 0) return true;
    const retriable = isRateLimitError(stderr) || isNetworkError(stderr);
    if (!retriable || attempt === delays.length) {
      warn(`ffmpeg failed (exit ${code})`);
      return false;
    }
    const wait = delays[attempt];
    const reason = isRateLimitError(stderr) ? 'Rate limited' : 'Network error';
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

  const validProfiles = ['speech', 'music', 'lean'];
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
      const catIdx = course.categories.findIndex(c => c.title === video.categoryTitle);
      const vidIdx = course.categories[catIdx].videos.findIndex(v => v.lessonUrl === video.lessonUrl);
      course.categories[catIdx].videos[vidIdx] = {
        ...course.categories[catIdx].videos[vidIdx],
        completed: true,
        downloadedAt: new Date().toISOString(),
        localPath: outputPath,
      };
      await atomicWriteJson(indexPath, indexData);
      info(`  ✓ Done`);
    } else {
      failed++;
      info(`  ✗ Failed`);
    }
  }

  info(`\nComplete: ${downloaded} downloaded, ${failed} failed.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
