#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { isStaleCache } from './index-utils.js';
import { info, warn, error } from './logger.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

export function formatCourseList(courses) {
  if (courses.length === 0) return '';

  const rows = courses
    .map(course => {
      const allVideos = course.categories.flatMap(c => c.videos);
      const total = allVideos.length;
      const completed = allVideos.filter(v => v.completed).length;
      return {
        category: course.category ?? '',
        title: course.title,
        author: course.instructor,
        type: course.contentType ?? '',
        lessons: total,
        done: completed === total && total > 0 ? 'Yes' : 'No',
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  const trunc = (s, len) => s.length > len ? s.slice(0, len - 1) + '…' : s;
  const pad = (s, len) => s.padEnd(len);

  const W = {
    category: Math.max(8, ...rows.map(r => r.category.length)),
    title: Math.min(45, Math.max(5, ...rows.map(r => r.title.length))),
    author: Math.min(24, Math.max(6, ...rows.map(r => r.author.length))),
    type: Math.max(4, ...rows.map(r => r.type.length)),
    lessons: 7,
    done: 4,
  };

  const header = [
    pad('Category', W.category),
    pad('Title', W.title),
    pad('Author', W.author),
    pad('Type', W.type),
    'Lessons'.padStart(W.lessons),
    'Done',
  ].join('  ');

  const sep = [W.category, W.title, W.author, W.type, W.lessons, W.done]
    .map(n => '-'.repeat(n))
    .join('  ');

  const dataRows = rows.map(r => [
    pad(trunc(r.category, W.category), W.category),
    pad(trunc(r.title, W.title), W.title),
    pad(trunc(r.author, W.author), W.author),
    pad(r.type, W.type),
    String(r.lessons).padStart(W.lessons),
    r.done,
  ].join('  '));

  return [header, sep, ...dataRows].join('\n');
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    error('MAESTRO_ROOT not set. Run /setup first.');
    process.exit(1);
  }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    info('No course catalogue found.\nRun /fetch-list to build the catalogue.');
    process.exit(0);
  }

  let indexData;
  try {
    indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    error('index.json is corrupted. Run /fetch-list to rebuild it.');
    process.exit(1);
  }

  if (!indexData.courses || indexData.courses.length === 0) {
    info('Course catalogue is empty.\nRun /fetch-list to populate it.');
    process.exit(0);
  }

  if (isStaleCache(indexData.lastFetched)) {
    warn(
      `catalogue was last fetched ${indexData.lastFetched ? new Date(indexData.lastFetched).toDateString() : 'never'} (>30 days ago).\n` +
      'Run /fetch-list to refresh it.',
    );
  }

  process.stdout.write(formatCourseList(indexData.courses) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
