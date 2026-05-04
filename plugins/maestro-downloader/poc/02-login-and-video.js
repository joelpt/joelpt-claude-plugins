/**
 * POC v2: Login fix + authenticated course video manifest DRM check
 *
 * Builds on v1 findings:
 *   - Login form is JS-rendered (Devise/Rails); must wait for password field
 *   - Course URL pattern: /courses/{instructor}/{course-slug}
 *   - HLS manifests at videos.cdn.bbcmaestro.com — v1 found no DRM on promo content
 *
 * This script verifies DRM status on actual course lesson videos (authenticated).
 *
 * Run: node poc/02-login-and-video.js
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

// Known course from v1 scrape — navigate directly
const TEST_COURSE_URL = `${BASE_URL}/courses/isabel-allende/magical-storytelling`;

const findings = {
  loginSuccess: false,
  postLoginUrl: null,
  loginMethod: null,
  courseHtml: null,
  lessons: [],
  manifests: [],
  manifestBodies: [],
  tsFragments: [],
  drm: { detected: false, details: null },
  errors: [],
};

function log(msg) { process.stderr.write(`[poc2] ${msg}\n`); }

async function screenshot(page, name) {
  await page.screenshot({ path: join(__dir, 'screenshots', `v2-${name}.png`), fullPage: false }).catch(() => {});
  log(`screenshot: v2-${name}.png`);
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

  // Use route interception so we can read manifest bodies before they expire
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
    if (url.includes('.m3u8')) {
      findings.manifests.push({ url, status: r.status() });
    }
  });

  try {
    // ── Login ─────────────────────────────────────────────────────────────
    log('Navigating to /users/sign_in...');
    await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, '01-signin-page');

    // Dump form HTML to understand structure
    const formHtml = await page.evaluate(() => {
      const form = document.querySelector('form');
      return form ? form.outerHTML.substring(0, 2000) : 'NO FORM FOUND';
    });
    findings.loginFormHtml = formHtml;
    log(`Form HTML: ${formHtml.substring(0, 200)}`);

    // Wait explicitly for password field (JS-rendered form)
    log('Waiting for password field...');
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    } catch {
      log('Password field timeout — trying fallback selectors...');
      findings.errors.push('password field not found within 10s');
    }

    await screenshot(page, '02-form-ready');

    // Fill email
    const emailSels = [
      'input[type="email"]',
      'input[name="user[email]"]',
      'input[name="email"]',
      '#user_email',
    ];
    let emailFilled = false;
    for (const sel of emailSels) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.fill(EMAIL);
          emailFilled = true;
          log(`Email filled with: ${sel}`);
          break;
        }
      } catch {}
    }

    // Fill password
    const passSels = [
      'input[type="password"]',
      'input[name="user[password]"]',
      'input[name="password"]',
      '#user_password',
    ];
    let passFilled = false;
    for (const sel of passSels) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.fill(PASSWORD);
          passFilled = true;
          log(`Password filled with: ${sel}`);
          break;
        }
      } catch {}
    }

    findings.loginMethod = { emailFilled, passFilled };

    if (!emailFilled || !passFilled) {
      findings.errors.push(`Form fields missing — email:${emailFilled} pass:${passFilled}`);
    }

    await screenshot(page, '03-filled');

    // Submit
    const submitSels = [
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'form button',
    ];
    for (const sel of submitSels) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0) {
          await Promise.all([
            page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle' }).catch(() => {}),
            loc.click(),
          ]);
          log(`Submitted with: ${sel}`);
          break;
        }
      } catch {}
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
      // Capture any error messages
      const errMsg = await page.evaluate(() => {
        const errEl = document.querySelector('.alert, .error, [class*="error"], [class*="flash"]');
        return errEl ? errEl.textContent.trim() : null;
      });
      findings.errors.push(`Login failed. URL: ${findings.postLoginUrl}. Error: ${errMsg}`);
    }

    // ── Navigate to test course ───────────────────────────────────────────
    log(`Navigating to course: ${TEST_COURSE_URL}`);
    await page.goto(TEST_COURSE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, '05-course-page');

    // Capture course page structure — look for lesson/chapter links
    findings.courseHtml = await page.content().then(h => h.substring(0, 8000));

    findings.lessons = await page.evaluate((base) => {
      const lessonLinks = [...document.querySelectorAll('a[href]')]
        .filter(a => {
          const href = a.href;
          return (
            href.includes('/lessons/') ||
            href.includes('/lesson/') ||
            href.includes('/videos/') ||
            href.includes('/watch/') ||
            a.closest('[class*="lesson"]') ||
            a.closest('[class*="chapter"]') ||
            a.closest('[class*="episode"]')
          );
        });
      // Also look for video-js sources
      const videoSources = [...document.querySelectorAll('video source, video[src]')]
        .map(el => ({ type: 'video-src', src: el.src || el.getAttribute('src') }));

      // Look for data attributes with manifest URLs
      const dataManifests = [...document.querySelectorAll('[data-manifest-url], [data-hls], [data-src*=".m3u8"]')]
        .map(el => ({ type: 'data-attr', url: el.dataset.manifestUrl || el.dataset.hls || el.dataset.src }));

      return [
        ...lessonLinks.slice(0, 20).map(a => ({ type: 'link', href: a.href, text: a.textContent.trim().substring(0, 80) })),
        ...videoSources,
        ...dataManifests,
      ];
    }, BASE_URL);

    log(`Found ${findings.lessons.length} lesson items`);

    // Try to find first actual lesson link
    const firstLesson = findings.lessons.find(l => l.type === 'link' && l.href);
    if (firstLesson) {
      log(`Navigating to first lesson: ${firstLesson.href}`);
      await page.goto(firstLesson.href, { waitUntil: 'networkidle', timeout: 30000 });
      await screenshot(page, '06-lesson-page');

      findings.lessonPageHtml = await page.content().then(h => h.substring(0, 5000));

      // Try to trigger video playback
      const playResult = await page.evaluate(() => {
        // Look for Video.js player and get its source
        if (window.videojs) {
          const players = Object.values(window.videojs.players || {});
          return players.map(p => ({
            src: p.currentSrc?.() ?? null,
            tech: p.techName_,
          }));
        }
        // Look for HLS source in page data
        const scripts = [...document.querySelectorAll('script:not([src])')];
        const hlsScript = scripts.find(s => s.textContent.includes('.m3u8'));
        if (hlsScript) {
          const match = hlsScript.textContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
          return match ? match.slice(0, 5).map(u => ({ type: 'inline-script', url: u })) : [];
        }
        return [];
      });
      findings.videojsSources = playResult;
      log(`Video.js sources: ${JSON.stringify(playResult)}`);

      // Wait for any HLS fetches triggered by the player
      await page.waitForTimeout(6000);
      await screenshot(page, '07-lesson-player-wait');
    }

    // Wait for more network activity
    await page.waitForTimeout(3000);

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
