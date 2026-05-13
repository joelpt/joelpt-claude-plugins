#!/usr/bin/env node
import express from 'express';
import { join, dirname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { info, error } from './logger.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_DIR = join(__dir, '..', 'ui');
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

/** Convert an absolute filesystem path to a URL path relative to root.
 *  Idempotent for already-relative paths. Returns the input unchanged if it
 *  isn't under root (e.g. a stale absolute path from a previous root). */
export function toRelativeUrl(absPath, root) {
  if (!absPath || typeof absPath !== 'string') return absPath;
  // Normalise both sides for the prefix check.
  const r = root.endsWith(sep) ? root : root + sep;
  if (!absPath.startsWith(r)) return absPath;
  const rel = absPath.slice(r.length).split(sep).join(posix.sep);
  return '/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** Walk the catalogue tree and rewrite every video.localPath to be a URL path
 *  relative to root. Handles both v1 (cat.videos only) and v2 (with
 *  subcategories[]) shapes. Returns the rewritten object. */
export function rewriteCatalogueForUrls(data, root) {
  if (!data || !Array.isArray(data.courses)) return data;
  function walkCategories(cats) {
    if (!Array.isArray(cats)) return;
    for (const cat of cats) {
      if (Array.isArray(cat.videos)) {
        for (const v of cat.videos) {
          if (v.localPath) v.localPath = toRelativeUrl(v.localPath, root);
        }
      }
      if (Array.isArray(cat.subcategories)) walkCategories(cat.subcategories);
    }
  }
  for (const c of data.courses) walkCategories(c.categories);
  return data;
}

export function createApp(root, uiDir = DEFAULT_UI_DIR) {
  const app = express();
  app.get('/', (_req, res) => res.sendFile(join(uiDir, 'index.html')));
  // Intercept index.json: rewrite absolute localPath fields to URL-relative
  // paths so the SPA can use them directly as <video src=>. Falls back to
  // static-served raw file if index.json is missing.
  app.get('/index.json', (_req, res) => {
    const indexPath = join(root, 'index.json');
    if (!existsSync(indexPath)) return res.status(404).send('index.json not found');
    let data;
    try { data = JSON.parse(readFileSync(indexPath, 'utf8')); } catch (e) {
      return res.status(500).send(`index.json parse error: ${e.message}`);
    }
    res.type('application/json').send(rewriteCatalogueForUrls(data, root));
  });
  app.use(express.static(root));
  return app;
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });

  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    error('MAESTRO_ROOT not set. Run /setup first.');
    process.exit(1);
  }

  const port = Number(process.env.MAESTRO_PORT ?? 8080);
  const app = createApp(root);
  app.listen(port, () => {
    info(`Maestro library running at http://localhost:${port}`);
    info('Press Ctrl+C to stop.');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
