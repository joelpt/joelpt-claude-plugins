#!/usr/bin/env node
/**
 * Credential validator for the maestro-downloader plugin.
 * Usage: node lib/setup.js --validate
 * Reads MAESTRO_EMAIL, MAESTRO_PASSWORD from environment.
 * Exits 0 on successful login, 1 on failure.
 */

import { chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, error } from './logger.js';

const BASE_URL = 'https://www.bbcmaestro.com';
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

// Load .env if present; process.env values already set (e.g. in tests) take precedence
dotenvConfig({ path: ENV_PATH, override: false });

function fail(msg) {
  error(msg);
  process.exit(1);
}

async function validateCredentials(email, password) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
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

    info('Connecting to BBC Maestro...');
    await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });

    // Step 1: email
    await page.locator('#user_email').fill(email);
    await page.waitForSelector('input[type="submit"]:not([disabled])', { timeout: 8000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.locator('input[type="submit"]').click(),
    ]);

    // Step 2: password
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

    const postLoginUrl = page.url();
    const loginSuccess =
      !postLoginUrl.includes('sign_in') &&
      !postLoginUrl.includes('sign-in') &&
      !postLoginUrl.includes('/login');

    if (!loginSuccess) {
      const errMsg = await page.evaluate(() => {
        const el = document.querySelector('.alert, .flash, [class*="error"], [class*="alert"]');
        return el?.textContent.trim() ?? null;
      });
      return { success: false, error: errMsg ?? `Login failed — landed at ${postLoginUrl}` };
    }

    return { success: true };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!process.argv.includes('--validate')) {
    error('Usage: node lib/setup.js --validate');
    process.exit(1);
  }

  const email = process.env.MAESTRO_EMAIL?.trim();
  const password = process.env.MAESTRO_PASSWORD?.trim();
  const root = process.env.MAESTRO_ROOT?.trim();

  if (!email) fail('MAESTRO_EMAIL is not set. Run /setup to configure credentials.');
  if (!password) fail('MAESTRO_PASSWORD is not set. Run /setup to configure credentials.');
  if (!root) fail('MAESTRO_ROOT is not set. Run /setup to configure credentials.');

  try {
    const result = await validateCredentials(email, password);
    if (result.success) {
      info('Login successful. Credentials are valid.');
      process.exit(0);
    } else {
      fail(`Login failed: ${result.error}`);
    }
  } catch (err) {
    fail(`Login error: ${err.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
