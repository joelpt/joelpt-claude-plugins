#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { derive1080pUrl, deriveOutputPath, atomicWriteJson } from './index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

function log(msg) { process.stdout.write(`${msg}\n`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runFfmpeg(inputUrl, outputPath) {
  return new Promise((resolve) => {
    let stderrBuf = '';
    const args = [
      '-y',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-i', inputUrl,
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'libsvtav1',
      '-crf', '28',
      '-preset', '6',
      '-c:a', 'libopus',
      '-b:a', '128k',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'pipe'] });
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf = (stderrBuf + chunk).slice(-4096);
      process.stderr.write(chunk);
    });
    proc.on('close', (code) => resolve({ code, stderr: stderrBuf }));
    proc.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });
}

export function isRateLimitError(stderr) {
  return /server returned (429|503)|too many requests|service unavailable/i.test(stderr);
}

async function downloadVideoWithBackoff(inputUrl, outputPath) {
  const delays = [10000, 20000, 40000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { code, stderr } = await runFfmpeg(inputUrl, outputPath);
    if (code === 0) return true;
    if (!isRateLimitError(stderr) || attempt === delays.length) {
      process.stderr.write(`ffmpeg failed (exit ${code})\n`);
      return false;
    }
    const wait = delays[attempt];
    log(`Rate limited — waiting ${wait / 1000}s before retry ${attempt + 1}...`);
    await sleep(wait);
  }
  return false;
}

async function main() {
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) { process.stderr.write('Error: MAESTRO_ROOT not set. Run /setup first.\n'); process.exit(1); }

  const args = process.argv.slice(2);
  const qualityIdx = args.indexOf('--quality');
  const quality4k = qualityIdx !== -1 && args[qualityIdx + 1] === '4k';
  const remaining = args.filter((a, i) => i !== qualityIdx && i !== qualityIdx + 1);
  const courseSlug = remaining.filter(a => !a.startsWith('--')).join(' ').trim();

  if (!courseSlug) {
    process.stderr.write('Usage: node lib/download.js <course-slug> [--quality 4k]\nExample: node lib/download.js owen-o-kane/a-life-less-anxious\n');
    process.exit(1);
  }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    process.stderr.write('No index.json found. Run /fetch-list first.\n');
    process.exit(1);
  }

  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    process.stderr.write('Error: index.json is corrupted. Run /fetch-list to rebuild it.\n');
    process.exit(1);
  }

  const course = (indexData.courses ?? []).find(
    (c) => c.slug === courseSlug || c.slug.endsWith(`/${courseSlug}`) || c.title.toLowerCase() === courseSlug.toLowerCase(),
  );
  if (!course) {
    const available = (indexData.courses ?? []).map(c => c.slug).join('\n  ');
    process.stderr.write(`Course not found: "${courseSlug}"\nAvailable courses:\n  ${available}\n`);
    process.exit(1);
  }

  const allVideos = course.categories.flatMap(cat =>
    cat.videos.map(v => ({ ...v, categoryTitle: cat.title })),
  );
  const pending = allVideos.filter(v => !v.completed);
  const total = allVideos.length;

  log(`Course: ${course.title} — ${course.instructor}`);
  log(`Videos: ${total} total, ${pending.length} to download, ${total - pending.length} already done`);

  if (pending.length === 0) {
    log('All videos already downloaded.');
    process.exit(0);
  }

  let downloaded = 0;
  let failed = 0;

  for (const video of pending) {
    if (!video.manifestUrl) {
      log(`  [SKIP] ${video.index}. ${video.title} — no manifest URL (run /fetch-list to capture it)`);
      failed++;
      continue;
    }

    const inputUrl = quality4k ? video.manifestUrl : derive1080pUrl(video.manifestUrl);
    const outputPath = deriveOutputPath(root, course.slug, video.categoryTitle, video.index, video.title);

    log(`\n[${downloaded + failed + 1}/${pending.length}] ${video.index}. ${video.title}`);
    log(`  → ${outputPath}`);

    mkdirSync(dirname(outputPath), { recursive: true });

    const success = await downloadVideoWithBackoff(inputUrl, outputPath);

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
      log(`  ✓ Done`);
    } else {
      failed++;
      log(`  ✗ Failed`);
    }
  }

  log(`\nComplete: ${downloaded} downloaded, ${failed} failed.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
