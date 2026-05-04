#!/usr/bin/env node
import { chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mergeCourses, atomicWriteJson } from './index-utils.js';

const BASE_URL = 'https://www.bbcmaestro.com';
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

dotenvConfig({ path: ENV_PATH, override: false });

function log(msg) { process.stdout.write(`${msg}\n`); }
function warn(msg) { process.stderr.write(`Warning: ${msg}\n`); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function jitter(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

async function withBackoff(label, fn) {
  const delays = [10000, 20000, 40000, 80000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const result = await fn();
    if (result !== 'RATE_LIMITED') return result;
    if (attempt === delays.length) {
      warn(`${label}: rate limited after ${delays.length + 1} attempts, skipping`);
      return null;
    }
    const wait = delays[attempt];
    warn(`${label}: rate limited (429/503), waiting ${wait / 1000}s...`);
    await sleep(wait);
  }
}

async function launchBrowser() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return { browser, context };
}

async function login(page, email, password) {
  await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#user_email').fill(email);
  await page.waitForSelector('input[type="submit"]:not([disabled])', { timeout: 8000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
    page.locator('input[type="submit"]').click(),
  ]);
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.locator('input[type="password"]').fill(password);
  await page.waitForSelector(
    'input[type="submit"]:not([disabled]), button[type="submit"]:not([disabled])',
    { timeout: 5000 },
  ).catch(() => {});

  const submitSels = ['input[type="submit"]', 'button[type="submit"]', 'button:has-text("Sign in")'];
  for (const sel of submitSels) {
    const loc = page.locator(sel).first();
    if (await loc.count() > 0) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
        loc.click(),
      ]);
      break;
    }
  }

  const url = page.url();
  const ok = !url.includes('sign_in') && !url.includes('sign-in') && !url.includes('/login');
  if (!ok) throw new Error(`Login failed — landed at ${url}`);
}

async function getCourseUrls(page) {
  const resp = await page.goto(`${BASE_URL}/courses`, { waitUntil: 'networkidle', timeout: 30000 });
  if (resp?.status() === 429 || resp?.status() === 503) return 'RATE_LIMITED';

  return page.evaluate((base) => {
    const seen = new Set();
    const results = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href;
      const m = href.match(/\/courses\/([^/]+\/[^/?#]+)(?:\/|$|\?|#)/);
      if (!m) continue;
      if (href.includes('/lessons/') || href.includes('/category/')) continue;
      const full = `${base}/courses/${m[1]}`;
      if (!seen.has(full)) { seen.add(full); results.push(full); }
    }
    return results;
  }, BASE_URL);
}

async function scrapeCoursePage(page, courseUrl) {
  const resp = await page.goto(courseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  if (resp?.status() === 429 || resp?.status() === 503) return 'RATE_LIMITED';

  return page.evaluate((courseUrl) => {
    const title =
      document.querySelector('h1')?.textContent?.trim() ??
      document.title.split('|')[0].trim();

    const slugParts = courseUrl.replace(/.*\/courses\//, '').split('/');
    const instructorSlug = slugParts[0] ?? '';
    const instructor = instructorSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const slug = slugParts.slice(0, 2).join('/');

    const allLessonLinks = [...document.querySelectorAll('a[href]')]
      .filter(a => a.href.includes('/lessons/') && a.href.includes(slugParts[0]))
      .map(a => ({
        href: a.href.split('?')[0].split('#')[0],
        text: a.textContent.trim().replace(/\s+/g, ' '),
      }))
      .filter(a => a.href.length > 0);

    const seen = new Set();
    const uniqueLessons = [];
    for (const l of allLessonLinks) {
      if (!seen.has(l.href)) { seen.add(l.href); uniqueLessons.push(l); }
    }

    const categories = [];
    let currentCat = null;

    const body = document.body;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);

    const lessonHrefSet = new Set(uniqueLessons.map(l => l.href));
    const categoryHeadings = new Set();

    for (const node of body.querySelectorAll('h2, h3, h4')) {
      const text = node.textContent.trim();
      if (text && text.length < 100) categoryHeadings.add(node);
    }

    if (categoryHeadings.size === 0 || uniqueLessons.length === 0) {
      categories.push({
        title: 'Lessons',
        lessonLinks: uniqueLessons,
      });
    } else {
      const bodyEl = document.body;
      const allNodes = [...bodyEl.querySelectorAll('*')];
      let currentCatTitle = 'Lessons';
      let currentLessons = [];

      for (const node of allNodes) {
        if (categoryHeadings.has(node)) {
          if (currentLessons.length > 0) {
            categories.push({ title: currentCatTitle, lessonLinks: currentLessons });
            currentLessons = [];
          }
          currentCatTitle = node.textContent.trim();
        } else if (node.tagName === 'A') {
          const href = node.href?.split('?')[0].split('#')[0];
          if (lessonHrefSet.has(href)) {
            currentLessons.push({ href, text: node.textContent.trim().replace(/\s+/g, ' ') });
          }
        }
      }
      if (currentLessons.length > 0) {
        categories.push({ title: currentCatTitle, lessonLinks: currentLessons });
      }
      if (categories.length === 0) {
        categories.push({ title: 'Lessons', lessonLinks: uniqueLessons });
      }
    }

    return { slug, title, instructor, courseUrl, categories };
  }, courseUrl);
}

async function getLessonManifest(page, lessonUrl) {
  let manifestUrl = null;

  const manifestPromise = page.waitForResponse(
    (r) => {
      const url = r.url();
      return url.includes('videos.cdn.bbcmaestro.com') && url.endsWith('.m3u8') && !url.includes('_1080') && !url.includes('_720') && !url.includes('_360') && !url.includes('_2160');
    },
    { timeout: 20000 },
  ).catch(() => null);

  const resp = await page.goto(lessonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (resp?.status() === 429 || resp?.status() === 503) return 'RATE_LIMITED';

  const manifestResp = await manifestPromise;
  manifestUrl = manifestResp?.url() ?? null;

  if (!manifestUrl) {
    const playBtn = page.locator('button[aria-label*="Play"], [class*="play-button"], [class*="playButton"]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click().catch(() => {});
      const retry = await page.waitForResponse(
        (r) => r.url().includes('videos.cdn.bbcmaestro.com') && r.url().endsWith('.m3u8'),
        { timeout: 10000 },
      ).catch(() => null);
      manifestUrl = retry?.url() ?? null;
    }
  }

  return manifestUrl;
}

async function crawl(email, password, root) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    log('Logging in to BBC Maestro...');
    await login(page, email, password);
    log('Login successful.');

    const courseUrls = await withBackoff('/courses page', () => getCourseUrls(page));
    if (!courseUrls || courseUrls.length === 0) {
      throw new Error('No courses found. Ensure your account has active subscriptions.');
    }
    log(`Found ${courseUrls.length} course(s).`);

    const existingIndex = (() => {
      const indexPath = join(root, 'index.json');
      if (!existsSync(indexPath)) return { courses: [] };
      try { return JSON.parse(readFileSync(indexPath, 'utf8')); } catch { return { courses: [] }; }
    })();

    const freshCourses = [];
    let newVideoCount = 0;

    for (let ci = 0; ci < courseUrls.length; ci++) {
      const courseUrl = courseUrls[ci];
      log(`[${ci + 1}/${courseUrls.length}] Scraping course: ${courseUrl}`);

      const courseData = await withBackoff(courseUrl, () => scrapeCoursePage(page, courseUrl));
      if (!courseData) {
        warn(`Skipping course ${courseUrl} — could not load page`);
        if (ci < courseUrls.length - 1) await sleep(jitter(3000, 6000));
        continue;
      }

      const categories = [];

      for (let catIdx = 0; catIdx < courseData.categories.length; catIdx++) {
        const cat = courseData.categories[catIdx];
        const videos = [];

        for (let li = 0; li < cat.lessonLinks.length; li++) {
          const lesson = cat.lessonLinks[li];
          const lessonLabel = `${courseData.slug} / ${cat.title} / lesson ${li + 1}`;
          log(`  Lesson ${li + 1}/${cat.lessonLinks.length}: ${lesson.href}`);

          const manifestUrl = await withBackoff(lessonLabel, () => getLessonManifest(page, lesson.href));

          if (!manifestUrl) {
            warn(`  Could not capture manifest for ${lesson.href}`);
          }

          videos.push({
            index: li + 1,
            title: lesson.text || `Lesson ${li + 1}`,
            lessonUrl: lesson.href,
            manifestUrl: manifestUrl ?? null,
          });

          if (li < cat.lessonLinks.length - 1) {
            await sleep(jitter(1500, 3500));
          }
        }

        categories.push({ title: cat.title, videos });
      }

      freshCourses.push({
        slug: courseData.slug,
        title: courseData.title,
        instructor: courseData.instructor,
        courseUrl: courseData.courseUrl,
        categories,
      });

      if (ci < courseUrls.length - 1) await sleep(jitter(3000, 6000));
    }

    const mergedCourses = mergeCourses(existingIndex.courses ?? [], freshCourses);

    const existingVideoUrls = new Set(
      (existingIndex.courses ?? []).flatMap(c => c.categories.flatMap(cat => cat.videos.map(v => v.lessonUrl))),
    );
    const allMergedVideos = mergedCourses.flatMap(c => c.categories.flatMap(cat => cat.videos));
    newVideoCount = allMergedVideos.filter(v => !existingVideoUrls.has(v.lessonUrl)).length;

    const indexData = {
      lastFetched: new Date().toISOString(),
      courses: mergedCourses,
    };

    await atomicWriteJson(join(root, 'index.json'), indexData);

    const totalVideos = allMergedVideos.length;
    log(`\nCatalogue updated: ${mergedCourses.length} courses, ${totalVideos} total videos (${newVideoCount} new since last fetch).`);
    log('Run /list to browse, or /download <course> to start downloading.');
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const email = process.env.MAESTRO_EMAIL?.trim();
  const password = process.env.MAESTRO_PASSWORD?.trim();
  const root = process.env.MAESTRO_ROOT?.trim();

  if (!email) { process.stderr.write('Error: MAESTRO_EMAIL not set. Run /setup first.\n'); process.exit(1); }
  if (!password) { process.stderr.write('Error: MAESTRO_PASSWORD not set. Run /setup first.\n'); process.exit(1); }
  if (!root) { process.stderr.write('Error: MAESTRO_ROOT not set. Run /setup first.\n'); process.exit(1); }

  try {
    await crawl(email, password, root);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
