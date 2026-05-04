/**
 * POC v3: 2-step login + find accessible courses + authenticated video DRM check
 *
 * v2 finding: Login is 2-step (email → /users/identity → password → sign in).
 * Submit button starts disabled; Stimulus.js enables it on email input.
 *
 * Goals:
 *   1. Complete 2-step login successfully
 *   2. Find which courses this account has access to
 *   3. Navigate to an accessible course, extract lesson URLs
 *   4. Capture and check authenticated lesson video manifests for DRM
 *
 * Run: node poc/03-login-fix-and-course-access.js
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dir, '..', '.env') });

mkdirSync(join(__dir, 'screenshots'), { recursive: true });

const EMAIL = process.env.BBC_EMAIL;
const PASSWORD = process.env.BBC_PASSWORD;
const BASE_URL = 'https://www.bbcmaestro.com';

const findings = {
  loginSuccess: false,
  postLoginUrl: null,
  accessibleCourses: [],
  firstAccessibleCourse: null,
  lessons: [],
  firstLesson: null,
  manifestBodies: [],
  tsFragments: [],
  drm: { detected: false, details: null },
  errors: [],
};

function log(msg) { process.stderr.write(`[poc3] ${msg}\n`); }

async function screenshot(page, name) {
  await page.screenshot({ path: join(__dir, 'screenshots', `v3-${name}.png`), fullPage: false }).catch(() => {});
  log(`screenshot: v3-${name}.png`);
}

function parseDrm(body) {
  const keyLines = body.split('\n').filter(l => l.startsWith('#EXT-X-KEY'));
  if (!keyLines.length) return null;
  return {
    keyLines,
    methods: keyLines.map(l => { const m = l.match(/METHOD=([^,\s]+)/); return m?.[1] ?? 'UNKNOWN'; }),
    uris: keyLines.map(l => { const m = l.match(/URI="([^"]+)"/); return m?.[1] ?? null; }),
  };
}

async function run() {
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
  const page = await context.newPage();

  // Intercept manifests via route so body is readable
  await page.route('**/*.m3u8', async (route, request) => {
    const response = await route.fetch();
    const body = await response.text().catch(() => null);
    if (body) {
      const drm = parseDrm(body);
      findings.manifestBodies.push({ url: request.url(), body: body.substring(0, 3000), drm });
      if (drm) {
        findings.drm.detected = true;
        findings.drm.details = drm;
      }
    }
    await route.fulfill({ response });
  });

  page.on('response', (r) => {
    const url = r.url();
    if (url.match(/\.ts(\?|$)/) && !url.includes('.ts.map') && findings.tsFragments.length < 5) {
      findings.tsFragments.push({ url, status: r.status() });
    }
  });

  try {
    // ── Step 1: Email ─────────────────────────────────────────────────────
    log('Navigating to sign-in...');
    await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, '01-email-step');

    // Fill email field
    await page.locator('#user_email').fill(EMAIL);
    log('Email filled');

    // Wait for Stimulus to enable the Continue button
    await page.waitForSelector('input[type="submit"]:not([disabled])', { timeout: 8000 });
    log('Submit button enabled');

    // Click Continue and wait for the password step
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.locator('input[type="submit"]').click(),
    ]);
    await screenshot(page, '02-password-step');
    log(`After email submit, URL: ${page.url()}`);

    // ── Step 2: Password ──────────────────────────────────────────────────
    // Wait for password field
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    log('Password field found');

    await page.locator('input[type="password"]').fill(PASSWORD);
    log('Password filled');

    await screenshot(page, '03-password-filled');

    // Submit — wait for Stimulus to enable again or just force-click
    await page.waitForSelector('input[type="submit"]:not([disabled]), button[type="submit"]:not([disabled])', {
      timeout: 5000,
    }).catch(() => {});

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

    findings.postLoginUrl = page.url();
    findings.loginSuccess =
      !findings.postLoginUrl.includes('sign_in') &&
      !findings.postLoginUrl.includes('sign-in') &&
      !findings.postLoginUrl.includes('/login');

    log(`Post-login URL: ${findings.postLoginUrl}`);
    log(`Login success: ${findings.loginSuccess}`);
    await screenshot(page, '04-post-login');

    if (!findings.loginSuccess) {
      const errMsg = await page.evaluate(() => {
        const el = document.querySelector('.alert, .flash, [class*="error"], [class*="alert"]');
        return el?.textContent.trim() ?? null;
      });
      findings.errors.push(`Login failed. URL: ${findings.postLoginUrl}. Error: ${errMsg}`);
    }

    // ── Step 3: Find accessible courses ──────────────────────────────────
    log('Checking accessible courses...');
    await page.goto(`${BASE_URL}/courses`, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, '05-courses-page');

    // Look for courses where user has access (usually shown with a "Start" or "Continue" button
    // rather than "Buy Now" — or courses that link to /courses/xxx/lessons/yyy)
    findings.accessibleCourses = await page.evaluate((base) => {
      const results = [];
      const courseCards = document.querySelectorAll('[class*="poster"], [class*="course-card"], [class*="vc-poster"]');

      for (const card of courseCards) {
        const links = [...card.querySelectorAll('a[href]')];
        const courseLink = links.find(a =>
          a.href.includes('/courses/') &&
          !a.href.includes('/category/') &&
          !a.href.includes('/subscribe')
        );
        if (!courseLink) continue;

        const text = card.textContent.trim().substring(0, 150);
        const hasAccess =
          text.toLowerCase().includes('continue') ||
          text.toLowerCase().includes('start') ||
          text.toLowerCase().includes('resume') ||
          card.querySelector('[class*="progress"], [class*="started"], [class*="access"]');

        results.push({
          href: courseLink.href,
          text,
          hasAccess: !!hasAccess,
        });
      }

      // Also try direct check: courses that link to /lessons/ directly
      const lessonLinks = [...document.querySelectorAll('a[href*="/lessons/"]')]
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60), hasAccess: true }));

      return [...results, ...lessonLinks].slice(0, 30);
    }, BASE_URL);

    log(`Found ${findings.accessibleCourses.length} course entries`);

    // Navigate to "My Courses" or account page if it exists
    const myCoursesSels = ['a[href*="/my-courses"], a[href*="/dashboard"], a[href*="/account"]', 'a:has-text("My courses")', 'a:has-text("Dashboard")'];
    for (const sel of myCoursesSels) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          const href = await loc.getAttribute('href');
          log(`Found account/dashboard link: ${href}`);
          await page.goto(href.startsWith('http') ? href : `${BASE_URL}${href}`, { waitUntil: 'networkidle', timeout: 20000 });
          await screenshot(page, '06-my-courses');

          // Get courses from this page
          const myCourses = await page.evaluate((base) => {
            return [...document.querySelectorAll('a[href]')]
              .filter(a => a.href.includes('/courses/') && !a.href.includes('/category/'))
              .slice(0, 20)
              .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 80) }));
          }, BASE_URL);
          findings.myCourses = myCourses;
          log(`My courses page: ${myCourses.length} entries`);
          break;
        }
      } catch {}
    }

    // Pick first course with access, or first course overall
    const courseToTry =
      findings.accessibleCourses.find(c => c.hasAccess) ||
      findings.myCourses?.[0] ||
      findings.accessibleCourses[0];

    if (!courseToTry) {
      findings.errors.push('No accessible course found');
    } else {
      findings.firstAccessibleCourse = courseToTry.href;
      log(`Trying course: ${courseToTry.href}`);

      await page.goto(courseToTry.href, { waitUntil: 'networkidle', timeout: 30000 });
      await screenshot(page, '07-course-page');

      // Extract lesson links from course page
      findings.lessons = await page.evaluate((base) => {
        const links = [...document.querySelectorAll('a[href]')]
          .filter(a =>
            a.href.includes('/lessons/') ||
            a.href.includes('/videos/') ||
            a.href.includes('/watch/')
          )
          .slice(0, 20)
          .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 80) }));

        // Also look for video sources embedded on the course page
        const videoSrcs = [...document.querySelectorAll('video source[src], video[src]')]
          .map(el => ({ type: 'video', src: el.src || el.getAttribute('src') }));

        return [...links, ...videoSrcs];
      }, BASE_URL);

      log(`Lessons found: ${findings.lessons.length}`);

      // Navigate to first actual lesson
      const firstLesson = findings.lessons.find(l => l.href);
      if (firstLesson) {
        findings.firstLesson = firstLesson.href;
        log(`Navigating to lesson: ${firstLesson.href}`);
        await page.goto(firstLesson.href, { waitUntil: 'networkidle', timeout: 30000 });
        await screenshot(page, '08-lesson-page');

        // Let video player initialize
        await page.waitForTimeout(7000);
        await screenshot(page, '09-after-player-init');

        // Check for inline manifest URLs in page scripts
        const inlineManifests = await page.evaluate(() => {
          const scripts = [...document.querySelectorAll('script:not([src])')];
          const urls = [];
          for (const s of scripts) {
            const matches = s.textContent.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
            if (matches) urls.push(...matches);
          }
          return [...new Set(urls)].slice(0, 10);
        });
        findings.inlineManifests = inlineManifests;
        log(`Inline manifests in scripts: ${JSON.stringify(inlineManifests)}`);

        // Give more time for HLS fetches
        await page.waitForTimeout(5000);
        await screenshot(page, '10-final');
      }
    }

  } catch (err) {
    findings.errors.push(err.message);
    log(`Error: ${err.message}`);
    try { await screenshot(page, 'error'); } catch {}
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return findings;
}

run().then(f => {
  console.log(JSON.stringify(f, null, 2));
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
