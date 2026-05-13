import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');

let fakeHome;

before(() => {
  // Create a sentinel HOME with a real .env containing tripwire MAESTRO_* keys.
  // If any lib module's import-time code calls dotenv.config({ path: <thisHome>/.claude/plugins/maestro-downloader/.env }),
  // these keys WILL leak into the subprocess's env. The test then asserts they
  // didn't — which definitively proves dotenv wasn't called at import time.
  fakeHome = mkdtempSync(join(tmpdir(), 'maestro-import-probe-'));
  const envDir = join(fakeHome, '.claude', 'plugins', 'maestro-downloader');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(join(envDir, '.env'),
    'MAESTRO_EMAIL=tripwire@example.com\n' +
    'MAESTRO_PASSWORD=tripwire-password\n' +
    'MAESTRO_ROOT=/tmp/tripwire-root\n' +
    'MAESTRO_TRIPWIRE=1\n',
  );
});

after(() => {
  if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
});

/**
 * Spawn `node --input-type=module -e "<probe>"` in a clean env. PATH inherited;
 * every MAESTRO_* var stripped; HOME redirected to `fakeHome` which contains a
 * real .env file with tripwire values. Returns parsed { ok, leakedKeys }.
 */
function probe(modulePath) {
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith('MAESTRO_')) delete cleanEnv[k];
  }
  cleanEnv.HOME = fakeHome;

  const code = `
    import('${modulePath}')
      .then(() => {
        const present = Object.keys(process.env)
          .filter(k => k.startsWith('MAESTRO_'));
        process.stdout.write(JSON.stringify({ ok: true, leakedKeys: present }));
      })
      .catch((e) => {
        process.stderr.write(String(e?.stack ?? e));
        process.exit(2);
      });
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: pluginRoot,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
}

const LIB_MODULES = [
  './lib/fetch-list.js',
  './lib/download.js',
  './lib/queue.js',
  './lib/setup.js',
  './lib/list.js',
  './lib/reconcile.js',     // transitively imported by queue.js
  './lib/fix-index.js',     // standalone CLI script, but pattern consistency matters
  './lib/tag-courses.js',   // standalone CLI script, but pattern consistency matters
];

for (const mod of LIB_MODULES) {
  test(`importing ${mod} does not exit the process`, () => {
    const r = probe(mod);
    if (r.status !== 0) {
      assert.fail(`status=${r.status}, stderr=${r.stderr}`);
    }
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
  });

  test(`importing ${mod} does not invoke dotenv (tripwire .env exists; MAESTRO_* must NOT leak)`, () => {
    const r = probe(mod);
    assert.equal(r.status, 0, `probe failed: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.leakedKeys, [],
      `lib module triggered dotenv at import time; leaked keys: ${parsed.leakedKeys.join(', ')}`);
  });
}
