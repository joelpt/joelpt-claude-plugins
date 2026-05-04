import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const setupScript = join(__dir, '..', 'lib', 'setup.js');

function runSetup(env = {}) {
  return spawnSync(process.execPath, [setupScript, '--validate'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('exits 1 when MAESTRO_EMAIL is missing', () => {
  const result = runSetup({ MAESTRO_EMAIL: '', MAESTRO_PASSWORD: 'pw', MAESTRO_ROOT: '/tmp' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /MAESTRO_EMAIL/i);
});

test('exits 1 when MAESTRO_PASSWORD is missing', () => {
  const result = runSetup({ MAESTRO_EMAIL: 'user@example.com', MAESTRO_PASSWORD: '', MAESTRO_ROOT: '/tmp' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /MAESTRO_PASSWORD/i);
});

test('exits 1 when MAESTRO_ROOT is missing', () => {
  const result = runSetup({ MAESTRO_EMAIL: 'user@example.com', MAESTRO_PASSWORD: 'pw', MAESTRO_ROOT: '' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /MAESTRO_ROOT/i);
});

