import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const setupScript = join(__dir, '..', '..', 'lib', 'setup.js');

test('exits 1 with invalid credentials message on bad login', { timeout: 90000 }, () => {
  const result = spawnSync(
    process.execPath,
    [setupScript, '--validate'],
    {
      env: {
        ...process.env,
        MAESTRO_EMAIL: 'invalid@example.com',
        MAESTRO_PASSWORD: 'wrongpassword',
        MAESTRO_ROOT: '/tmp',
      },
      encoding: 'utf8',
      timeout: 90000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /login failed|invalid|credentials|error/i);
});
