#!/usr/bin/env node
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { config as dotenvConfig } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_DIR = join(__dir, '..', 'ui');
const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

export function createApp(root, uiDir = DEFAULT_UI_DIR) {
  const app = express();
  app.get('/', (_req, res) => res.sendFile(join(uiDir, 'index.html')));
  app.use(express.static(root));
  return app;
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });

  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    process.stderr.write('Error: MAESTRO_ROOT not set. Run /setup first.\n');
    process.exit(1);
  }

  const port = Number(process.env.MAESTRO_PORT ?? 8080);
  const app = createApp(root);
  app.listen(port, () => {
    process.stdout.write(`Maestro library running at http://localhost:${port}\n`);
    process.stdout.write(`Press Ctrl+C to stop.\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
