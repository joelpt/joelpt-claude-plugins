#!/usr/bin/env node
/**
 * capture-fixtures.js — log in to BBC Maestro, visit a curated set of course
 * pages, and save each one's post-render HTML to `tst/fixtures/<slug>.post-render.html`.
 *
 * Phase 1.4 of the v2 plan: the scraper rewrite (Phase 1.5) is TDD'd against
 * these fixtures. The reason this is a separate user-triggered script rather
 * than part of the autonomous run: it crawls the user's live account.
 *
 * Output structure:
 *   tst/fixtures/
 *     README.md
 *     eric-vetro-singing.post-render.html
 *     alan-moore-...
 *     ...
 *
 * Usage:
 *   node lib/capture-fixtures.js                  # capture the default 6 courses
 *   node lib/capture-fixtures.js course1 course2  # capture specific slugs
 *
 * The default course list targets the known-multi-category-broken courses
 * (Phase 1.4 spec) so the scraper can be debugged against the failing cases:
 *   eric-vetro/singing
 *   agatha-christie/writing
 *   owen-o-kane/a-life-less-anxious
 *   mark-ronson/music-production
 *   alan-moore/writing-fiction
 *   oliver-burkeman/time-management
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { info, warn, error } from './logger.js';

const BASE_URL = 'https://www.bbcmaestro.com';
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

const DEFAULT_SLUGS = [
  'eric-vetro/singing',
  'agatha-christie/writing',
  'owen-o-kane/a-life-less-anxious',
  'mark-ronson/music-production',
  'alan-moore/writing-fiction',
  'oliver-burkeman/time-management',
];

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
    info('reCAPTCHA detected; navigating directly to /courses (auth tokens already set server-side)');
    await page.goto(`${BASE_URL}/courses`, { waitUntil: 'networkidle', timeout: 30000 });
    const finalUrl = page.url();
    if (finalUrl.includes('sign_in') || finalUrl.includes('sign-in')) {
      throw new Error(`Authentication failed after CAPTCHA bypass — still at ${finalUrl}`);
    }
  }
}

function fixtureFilenameFor(slug) {
  return slug.replace(/[/\\]/g, '_') + '.post-render.html';
}

async function captureSlug(page, slug, fixturesDir) {
  const url = `${BASE_URL}/courses/${slug}`;
  info(`Capturing ${url}`);
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!resp || resp.status() >= 400) {
    warn(`  ${url} responded ${resp?.status() ?? 'no-response'} — skipping`);
    return false;
  }
  // page.content() returns the POST-render HTML, which is what page.evaluate()
  // sees. Critical: do NOT use raw HTTP response body — the BBC Maestro app
  // is rendered client-side after hydration.
  const html = await page.content();
  const outPath = join(fixturesDir, fixtureFilenameFor(slug));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  info(`  → ${outPath} (${html.length} bytes)`);
  return true;
}

export async function captureFixtures(email, password, slugs, fixturesDir) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  try {
    info('Logging in to BBC Maestro...');
    await login(page, email, password);
    info('Login successful.');
    let ok = 0, skipped = 0;
    for (const slug of slugs) {
      try {
        const captured = await captureSlug(page, slug, fixturesDir);
        if (captured) ok++; else skipped++;
      } catch (e) {
        warn(`  ${slug}: ${e.message}`);
        skipped++;
      }
      // Conservative inter-page delay so we don't trip rate limiting.
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
    }
    return { captured: ok, skipped, total: slugs.length };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function writeFixturesReadme(fixturesDir) {
  const path = join(fixturesDir, 'README.md');
  if (existsSync(path)) return;
  const content = `# Fixtures

HTML captures of BBC Maestro course pages, used by Phase 1.5 scrapeCoursePage tests.

Each \`<slug>.post-render.html\` is the output of \`await page.content()\` after the page reached
\`networkidle\` — i.e. the same DOM that the in-browser scraper's \`page.evaluate()\` sees.
Do NOT replace these with raw HTTP response bodies — BBC Maestro renders client-side and
the pre-hydration HTML is missing most of the data the scraper reads.

Generated by \`node lib/capture-fixtures.js\`.
`;
  writeFileSync(path, content, 'utf8');
  info(`Wrote ${path}`);
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const email = process.env.MAESTRO_EMAIL?.trim();
  const password = process.env.MAESTRO_PASSWORD?.trim();
  if (!email || !password) {
    error('MAESTRO_EMAIL or MAESTRO_PASSWORD not set. Run /setup first.');
    process.exit(1);
  }
  const slugs = process.argv.slice(2).filter(s => !s.startsWith('-'));
  const targets = slugs.length > 0 ? slugs : DEFAULT_SLUGS;
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tst', 'fixtures');

  info(`Capturing ${targets.length} course fixture(s) → ${fixturesDir}`);
  const result = await captureFixtures(email, password, targets, fixturesDir);
  writeFixturesReadme(fixturesDir);
  info(`\nDone: ${result.captured} captured, ${result.skipped} skipped (of ${result.total})`);
  if (result.skipped > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { error(e.message); process.exit(1); });
}
