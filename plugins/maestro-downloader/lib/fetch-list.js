#!/usr/bin/env node
import { chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mergeCourses, atomicWriteJson } from './index-utils.js';
import { info, warn, debug, error } from './logger.js';

const BASE_URL = 'https://www.bbcmaestro.com';
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

dotenvConfig({ path: ENV_PATH, override: false });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function jitter(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

let globalAdaptiveDelayMs = 2000;

async function withBackoff(label, fn) {
  const delays = [10000, 20000, 40000, 80000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const result = await fn();
      if (result !== 'RATE_LIMITED') return result;
      if (attempt === delays.length) {
        warn(`${label}: rate limited after ${delays.length + 1} attempts, skipping`);
        return null;
      }
      const wait = delays[attempt];
      warn(`${label}: rate limited (429/503), waiting ${wait / 1000}s...`);
      await sleep(wait);
    } catch (err) {
      if (err.message.includes('Timeout') || err.message.includes('timeout')) {
        if (attempt === delays.length) {
          warn(`${label}: timeout after ${delays.length + 1} attempts, skipping`);
          return null;
        }
        const wait = delays[attempt];
        warn(`${label}: timeout, waiting ${wait / 1000}s before retry...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
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
  const isSignInPage = url.includes('sign_in') || url.includes('sign-in') || url.includes('/login');
  if (isSignInPage) {
    debug('reCAPTCHA detected; navigating directly to /courses (auth tokens already set server-side)');
    await page.goto(`${BASE_URL}/courses`, { waitUntil: 'networkidle', timeout: 30000 });
    const finalUrl = page.url();
    const stillBlocked = finalUrl.includes('sign_in') || finalUrl.includes('sign-in');
    if (stillBlocked) throw new Error(`Authentication failed after CAPTCHA bypass — still at ${finalUrl}`);
  }
}

async function getCourseUrls(page) {
  const resp = await page.goto(`${BASE_URL}/courses`, { waitUntil: 'networkidle', timeout: 60000 });
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
  const resp = await page.goto(courseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  if (resp?.status() === 429 || resp?.status() === 503) {
    globalAdaptiveDelayMs += 30000;
    warn(`⚠ 429 HIT | Global delay now: ${(globalAdaptiveDelayMs / 1000).toFixed(1)}s`);
    return 'RATE_LIMITED';
  }

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
    const body = document.body;
    const lessonHrefSet = new Set(uniqueLessons.map(l => l.href));
    const categoryHeadings = new Set();
    const NAV_HEADING = /explore|browse|all courses|see all/i;

    for (const node of body.querySelectorAll('h2, h3, h4')) {
      const text = node.textContent.trim();
      if (text && text.length < 100 && !NAV_HEADING.test(text)) categoryHeadings.add(node);
    }

    if (categoryHeadings.size === 0 || uniqueLessons.length === 0) {
      categories.push({ title: 'Lessons', lessonLinks: uniqueLessons });
    } else {
      const allNodes = [...body.querySelectorAll('*')];
      let currentCatTitle = 'Lessons';
      let currentLessons = [];
      const assignedHrefs = new Set();

      for (const node of allNodes) {
        if (categoryHeadings.has(node)) {
          if (currentLessons.length > 0) {
            categories.push({ title: currentCatTitle, lessonLinks: currentLessons });
            currentLessons = [];
          }
          currentCatTitle = node.textContent.trim();
        } else if (node.tagName === 'A') {
          const href = node.href?.split('?')[0].split('#')[0];
          if (lessonHrefSet.has(href) && !assignedHrefs.has(href)) {
            assignedHrefs.add(href);
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
      return url.includes('videos.cdn.bbcmaestro.com') && url.endsWith('.m3u8') &&
        !url.includes('_1080') && !url.includes('_720') && !url.includes('_360') && !url.includes('_2160');
    },
    { timeout: 20000 },
  ).catch(() => null);

  const resp = await page.goto(lessonUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (resp?.status() === 429 || resp?.status() === 503) {
    globalAdaptiveDelayMs += 30000;
    warn(`⚠ 429 HIT | Global delay now: ${(globalAdaptiveDelayMs / 1000).toFixed(1)}s`);
    return 'RATE_LIMITED';
  }

  const manifestResp = await manifestPromise;
  manifestUrl = manifestResp?.url() ?? null;
  if (manifestUrl) debug(`manifest captured: ${manifestUrl}`);

  if (!manifestUrl) {
    const playBtn = page.locator('button[aria-label*="Play"], [class*="play-button"], [class*="playButton"]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click().catch(() => {});
      const retry = await page.waitForResponse(
        (r) => r.url().includes('videos.cdn.bbcmaestro.com') && r.url().endsWith('.m3u8'),
        { timeout: 10000 },
      ).catch(() => null);
      manifestUrl = retry?.url() ?? null;
      if (manifestUrl) debug(`manifest captured (via play click): ${manifestUrl}`);
    }
  }

  return manifestUrl;
}

async function crawl(email, password, root, resumeMode) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    info('Logging in to BBC Maestro...');
    await login(page, email, password);
    info('Login successful.');

    const courseUrls = await withBackoff('/courses page', () => getCourseUrls(page));
    if (!courseUrls || courseUrls.length === 0) {
      throw new Error('No courses found. Ensure your account has active subscriptions.');
    }
    info(`Found ${courseUrls.length} course(s).`);

    const indexPath = join(root, 'index.json');
    const existingIndex = (() => {
      if (!existsSync(indexPath)) return { courses: [] };
      try { return JSON.parse(readFileSync(indexPath, 'utf8')); } catch { return { courses: [] }; }
    })();

    let accumulatedCourses = existingIndex.courses ?? [];

    const existingSlugs = new Set(
      resumeMode
        ? accumulatedCourses.filter(c => c.categories.every(cat => cat.videos.every(v => v.manifestUrl !== null))).map(c => c.slug)
        : [],
    );

    const pendingUrls = courseUrls.filter((url) => {
      const slugParts = url.replace(/.*\/courses\//, '').split('/');
      const slug = slugParts.slice(0, 2).join('/');
      return !existingSlugs.has(slug);
    });

    if (resumeMode) {
      info(`Resume mode: ${existingSlugs.size} complete, ${pendingUrls.length} pending`);
    }

    const startingVideoUrls = new Set(
      (existingIndex.courses ?? []).flatMap(c => c.categories.flatMap(cat => cat.videos.map(v => v.lessonUrl))),
    );

    info(`\nSerial crawl with adaptive throttling. Initial delay: ${(globalAdaptiveDelayMs / 1000).toFixed(1)}s`);

    let lastStatusTime = Date.now();
    for (let ci = 0; ci < pendingUrls.length; ci++) {
      const courseUrl = pendingUrls[ci];
      const globalIdx = existingSlugs.size + ci + 1;
      const label = `[${globalIdx}/${courseUrls.length}]`;

      // Status every 60 seconds
      const now = Date.now();
      if (now - lastStatusTime >= 60000) {
        info(`[STATUS] Course ${globalIdx}/${courseUrls.length} | Delay: ${(globalAdaptiveDelayMs / 1000).toFixed(1)}s`);
        lastStatusTime = now;
      }

      info(`${label} Scraping: ${courseUrl}`);

      const courseData = await withBackoff(label, () => scrapeCoursePage(page, courseUrl));
      if (!courseData) {
        warn(`${label}: skipped`);
        await sleep(jitter(globalAdaptiveDelayMs, globalAdaptiveDelayMs + 1000));
        continue;
      }

      const categories = [];

      for (let catIdx = 0; catIdx < courseData.categories.length; catIdx++) {
        const cat = courseData.categories[catIdx];
        const videos = [];

        for (let li = 0; li < cat.lessonLinks.length; li++) {
          const lesson = cat.lessonLinks[li];
          debug(`${label} Lesson ${li + 1}/${cat.lessonLinks.length}`);

          const manifestUrl = await withBackoff(label, () => getLessonManifest(page, lesson.href));

          if (!manifestUrl) {
            warn(`${label}: no manifest for lesson ${li + 1}`);
          }

          videos.push({
            index: li + 1,
            title: lesson.text || `Lesson ${li + 1}`,
            lessonUrl: lesson.href,
            manifestUrl: manifestUrl ?? null,
          });

          // Write partial progress after each lesson
          const partialCourse = {
            slug: courseData.slug,
            title: courseData.title,
            instructor: courseData.instructor,
            courseUrl: courseData.courseUrl,
            categories: [...categories, { title: cat.title, videos }],
          };
          const partialAccumulated = mergeCourses(accumulatedCourses, [partialCourse]);
          await atomicWriteJson(indexPath, {
            lastFetched: new Date().toISOString(),
            courses: partialAccumulated,
          });

          if (li < cat.lessonLinks.length - 1) {
            await sleep(jitter(globalAdaptiveDelayMs, globalAdaptiveDelayMs + 1000));
          }
        }

        categories.push({ title: cat.title, videos });
      }

      const newCourse = {
        slug: courseData.slug,
        title: courseData.title,
        instructor: courseData.instructor,
        courseUrl: courseData.courseUrl,
        categories,
      };
      accumulatedCourses = mergeCourses(accumulatedCourses, [newCourse]);
      await atomicWriteJson(indexPath, {
        lastFetched: new Date().toISOString(),
        courses: accumulatedCourses,
      });
      debug(`Persisted: ${accumulatedCourses.length} courses (course complete)`);

      if (ci < pendingUrls.length - 1) {
        await sleep(jitter(globalAdaptiveDelayMs, globalAdaptiveDelayMs + 1000));
      }
    }

    const allMergedVideos = accumulatedCourses.flatMap(c => c.categories.flatMap(cat => cat.videos));
    const newVideoCount = allMergedVideos.filter(v => !startingVideoUrls.has(v.lessonUrl)).length;
    info(`\n✓ Complete: ${accumulatedCourses.length} courses, ${allMergedVideos.length} videos (${newVideoCount} new)`);
    info('Run /list to browse, or /download <course> to start downloading.');
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const email = process.env.MAESTRO_EMAIL?.trim();
  const password = process.env.MAESTRO_PASSWORD?.trim();
  const root = process.env.MAESTRO_ROOT?.trim();
  const resumeMode = process.argv.includes('--resume');

  if (!email) { error('MAESTRO_EMAIL not set. Run /setup first.'); process.exit(1); }
  if (!password) { error('MAESTRO_PASSWORD not set. Run /setup first.'); process.exit(1); }
  if (!root) { error('MAESTRO_ROOT not set. Run /setup first.'); process.exit(1); }

  try {
    await crawl(email, password, root, resumeMode);
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
