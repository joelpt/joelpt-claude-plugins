#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { isStaleCache } from './index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

export function formatCourseList(courses) {
  const lines = [];
  for (const course of courses) {
    const allVideos = course.categories.flatMap(c => c.videos);
    const totalVideos = allVideos.length;
    const completedVideos = allVideos.filter(v => v.completed).length;
    lines.push(`\n${course.title} — ${course.instructor}`);
    lines.push(`  ${course.slug}  [${completedVideos}/${totalVideos} downloaded]`);
    for (const cat of course.categories) {
      const catCompleted = cat.videos.filter(v => v.completed).length;
      lines.push(`    ${cat.title}: ${catCompleted}/${cat.videos.length} videos`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    process.stderr.write('Error: MAESTRO_ROOT not set. Run /setup first.\n');
    process.exit(1);
  }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    process.stdout.write('No course catalogue found.\nRun /fetch-list to build the catalogue.\n');
    process.exit(0);
  }

  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    process.stderr.write('Error: index.json is corrupted. Run /fetch-list to rebuild it.\n');
    process.exit(1);
  }

  if (!indexData.courses || indexData.courses.length === 0) {
    process.stdout.write('Course catalogue is empty.\nRun /fetch-list to populate it.\n');
    process.exit(0);
  }

  if (isStaleCache(indexData.lastFetched)) {
    process.stdout.write(
      `Warning: catalogue was last fetched ${indexData.lastFetched ? new Date(indexData.lastFetched).toDateString() : 'never'} (>30 days ago).\n` +
      'Run /fetch-list to refresh it.\n\n',
    );
  }

  process.stdout.write(formatCourseList(indexData.courses) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
