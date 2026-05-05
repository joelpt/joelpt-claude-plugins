#!/usr/bin/env node
/**
 * One-time cleanup: deduplicates lessons across categories and removes nav-heading
 * categories ("Explore all courses", etc.) from already-scraped index.json entries.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson } from './index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
dotenvConfig({ path: ENV_PATH, override: false });

const NAV_HEADING = /explore|browse|all courses|see all/i;

function cleanCourse(course) {
  const assignedHrefs = new Set();
  const cleanedCategories = [];

  for (const cat of course.categories) {
    if (NAV_HEADING.test(cat.title)) continue;

    const dedupedVideos = cat.videos.filter(v => {
      if (assignedHrefs.has(v.lessonUrl)) return false;
      assignedHrefs.add(v.lessonUrl);
      return true;
    });

    if (dedupedVideos.length > 0) {
      cleanedCategories.push({ ...cat, videos: dedupedVideos });
    }
  }

  if (cleanedCategories.length === 0) {
    cleanedCategories.push({
      title: 'Lessons',
      videos: course.categories.flatMap(c => c.videos).filter(v => {
        if (assignedHrefs.has(v.lessonUrl)) return false;
        assignedHrefs.add(v.lessonUrl);
        return true;
      }),
    });
  }

  return { ...course, categories: cleanedCategories };
}

async function main() {
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) { console.error('MAESTRO_ROOT not set'); process.exit(1); }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) { console.error('No index.json found'); process.exit(1); }

  const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  const before = indexData.courses.reduce((n, c) => n + c.categories.flatMap(cat => cat.videos).length, 0);

  indexData.courses = indexData.courses.map(cleanCourse);

  const after = indexData.courses.reduce((n, c) => n + c.categories.flatMap(cat => cat.videos).length, 0);

  await atomicWriteJson(indexPath, indexData);
  console.log(`Done. Videos: ${before} → ${after} (removed ${before - after} duplicates/nav entries)`);
  console.log(`Courses: ${indexData.courses.length}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
