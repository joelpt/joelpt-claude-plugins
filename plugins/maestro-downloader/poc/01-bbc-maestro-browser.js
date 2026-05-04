/**
 * POC: BBC Maestro browser automation + DRM detection
 *
 * Goals:
 *   1. Verify Playwright can log in to BBC Maestro
 *   2. Detect DRM (HLS #EXT-X-KEY) — if present, stop; plugin premise fails
 *   3. Scrape course list structure
 *   4. Navigate into a course, extract video metadata
 *   5. Capture .ts fragment URL patterns
 *
 * Run: node poc/01-bbc-maestro-browser.js
 * Output: JSON findings to stdout + screenshots in poc/screenshots/
 */

import { chromium } from 'playwright';
import { createWriteStream, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dir, '..', '.env') });

mkdirSync(join(__dir, 'screenshots'), { recursive: true });

const EMAIL = process.env.BBC_EMAIL;
const PASSWORD = process.env.BBC_PASSWORD;
const BASE_URL = 'https://www.bbcmaestro.com';

if (!EMAIL || !PASSWORD) {
  console.error('Missing BBC_EMAIL or BBC_PASSWORD in .env');
  process.exit(1);
}

const findings = {
  loginSuccess: false,
  postLoginUrl: null,
  courseListUrl: null,
  courses: [],
  firstCourseUrl: null,
  videoItems: [],
  manifests: [],
  tsFragments: [],
  drm: { detected: false, details: null },
  antiBot: [],
  errors: [],
  domSnapshots: {},
};

function log(msg) {
  process.stderr.write(`[poc] ${msg}\n`);
}

async function screenshot(page, name) {
  const p = join(__dir, 'screenshots', `${name}.png`);
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  log(`screenshot: ${name}.png`);
}

function parseDrm(manifestBody) {
  const keyLines = manifestBody.split('\n').filter(l => l.startsWith('#EXT-X-KEY'));
  if (keyLines.length === 0) return null;
  const methods = keyLines.map(l => {
    const m = l.match(/METHOD=([^,\s]+)/);
    return m ? m[1] : 'UNKNOWN';
  });
  return { keyLines, methods };
}

async function tryFill(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) {
        await loc.fill(value);
        return sel;
      }
    } catch {}
  }
  return null;
}

async function tryClick(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) {
        await loc.click();
        return sel;
      }
    } catch {}
  }
  return null;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    // Mask navigator.webdriver
    javaScriptEnabled: true,
  });

  // Mask automation flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  // Intercept all responses for HLS manifests and .ts fragments
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();

    if (status === 429 || status === 503) {
      findings.antiBot.push({ type: 'rate-limit', status, url });
    }

    if (url.includes('.m3u8')) {
      try {
        const body = await response.text();
        const drm = parseDrm(body);
        findings.manifests.push({ url, status, body: body.substring(0, 2000), drm });
        if (drm) {
          findings.drm.detected = true;
          findings.drm.details = drm;
        }
      } catch (e) {
        findings.manifests.push({ url, status, error: e.message });
      }
    }

    if (url.match(/\.ts(\?|$)/) && !url.includes('.ts.map')) {
      if (findings.tsFragments.length < 5) {
        findings.tsFragments.push({ url, status });
      }
    }
  });

  try {
    // ── Step 1: Homepage ──────────────────────────────────────────────────
    log('Navigating to homepage...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await screenshot(page, '01-homepage');

    // ── Step 2: Login page ────────────────────────────────────────────────
    log('Navigating to login...');
    const loginUrls = [
      `${BASE_URL}/sign-in`,
      `${BASE_URL}/login`,
      `${BASE_URL}/account/login`,
    ];
    let loginLanded = false;
    for (const url of loginUrls) {
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (resp && resp.status() < 400) {
          loginLanded = true;
          break;
        }
      } catch {}
    }

    // Also try clicking a sign-in link on the page if direct nav failed
    if (!loginLanded) {
      await tryClick(page, [
        'a:has-text("Sign in")', 'a:has-text("Log in")',
        'a[href*="sign-in"]', 'a[href*="login"]',
      ]);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    await screenshot(page, '02-login-page');
    findings.domSnapshots.loginPage = await page.content().then(h => h.substring(0, 3000));

    // ── Step 3: Fill login form ───────────────────────────────────────────
    log('Filling login form...');
    const emailFilled = await tryFill(page, [
      'input[type="email"]', 'input[name="email"]',
      'input[id="email"]', 'input[placeholder*="email" i]',
      'input[autocomplete="email"]',
    ], EMAIL);

    const passFilled = await tryFill(page, [
      'input[type="password"]', 'input[name="password"]',
      'input[id="password"]', 'input[autocomplete="current-password"]',
    ], PASSWORD);

    log(`Email field: ${emailFilled}, Password field: ${passFilled}`);

    if (!emailFilled || !passFilled) {
      findings.errors.push(`Login form fields not found. email=${emailFilled} pass=${passFilled}`);
      findings.domSnapshots.loginFormMissing = await page.content().then(h => h.substring(0, 5000));
    }

    await screenshot(page, '03-login-form-filled');

    // Submit
    const submitSel = await tryClick(page, [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Continue")',
      'form button',
    ]);
    log(`Submit button: ${submitSel}`);

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await screenshot(page, '04-after-login');

    findings.postLoginUrl = page.url();
    findings.loginSuccess =
      !findings.postLoginUrl.includes('/sign-in') &&
      !findings.postLoginUrl.includes('/login') &&
      !findings.postLoginUrl.includes('/register');

    log(`Login success: ${findings.loginSuccess} — URL: ${findings.postLoginUrl}`);

    if (!findings.loginSuccess) {
      findings.errors.push(`Login failed. Current URL: ${findings.postLoginUrl}`);
      findings.domSnapshots.afterLoginFail = await page.content().then(h => h.substring(0, 3000));
    }

    // ── Step 4: Course list ───────────────────────────────────────────────
    log('Navigating to course list...');
    const courseListCandidates = [
      `${BASE_URL}/courses`,
      `${BASE_URL}/browse`,
      `${BASE_URL}/discover`,
      `${BASE_URL}/catalog`,
    ];

    for (const url of courseListCandidates) {
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (resp && resp.status() < 400) {
          findings.courseListUrl = page.url();
          break;
        }
      } catch {}
    }

    await screenshot(page, '05-course-list');
    findings.domSnapshots.courseListPage = await page.content().then(h => h.substring(0, 5000));

    // Extract course links
    findings.courses = await page.evaluate(() => {
      const seen = new Set();
      return [...document.querySelectorAll('a')]
        .filter(a => {
          const href = a.href || '';
          return (
            href.includes('/courses/') ||
            href.includes('/course/') ||
            a.closest('[class*="course"]') ||
            a.closest('[class*="Course"]')
          ) && !seen.has(href) && seen.add(href);
        })
        .slice(0, 20)
        .map(a => ({
          href: a.href,
          text: a.textContent.trim().substring(0, 80),
          classes: a.className,
        }));
    });

    log(`Found ${findings.courses.length} course links`);

    // ── Step 5: First course page ─────────────────────────────────────────
    const firstCourse = findings.courses.find(c => c.href && c.href !== BASE_URL + '/');
    if (firstCourse) {
      findings.firstCourseUrl = firstCourse.href;
      log(`Navigating to first course: ${firstCourse.href}`);
      await page.goto(firstCourse.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await screenshot(page, '06-first-course');
      findings.domSnapshots.firstCoursePage = await page.content().then(h => h.substring(0, 5000));

      // Extract video/lesson items
      findings.videoItems = await page.evaluate(() => {
        const candidates = [
          ...document.querySelectorAll('[class*="lesson"], [class*="video"], [class*="episode"], [class*="chapter"]'),
          ...document.querySelectorAll('li a[href*="/video"], li a[href*="/lesson"], li a[href*="/episode"]'),
        ];
        return candidates.slice(0, 20).map(el => ({
          tag: el.tagName,
          class: (el.className || '').substring(0, 80),
          text: el.textContent.trim().substring(0, 100),
          href: el.href || el.querySelector('a')?.href || '',
        }));
      });

      log(`Found ${findings.videoItems.length} video items`);

      // ── Step 6: Attempt to trigger video playback ──────────────────────
      const firstVideo = findings.videoItems.find(v => v.href);
      if (firstVideo) {
        log(`Navigating to first video: ${firstVideo.href}`);
        await page.goto(firstVideo.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await screenshot(page, '07-video-page');
        findings.domSnapshots.firstVideoPage = await page.content().then(h => h.substring(0, 5000));
      }

      // Try clicking play button on whatever page we're on
      log('Attempting to click play button...');
      const playClicked = await tryClick(page, [
        'button[aria-label*="play" i]',
        'button[class*="play"]',
        '[class*="PlayButton"]',
        '[data-testid*="play"]',
        '.play-button',
        'button:has-text("Play")',
        'video',
      ]);
      log(`Play button: ${playClicked}`);

      if (playClicked) {
        await page.waitForTimeout(5000);
        await screenshot(page, '08-video-playing');
      }

      // Wait extra time for HLS to initialize
      await page.waitForTimeout(4000);
      await screenshot(page, '09-after-playback-wait');
    }

  } catch (err) {
    findings.errors.push(err.message);
    log(`Error: ${err.message}`);
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
