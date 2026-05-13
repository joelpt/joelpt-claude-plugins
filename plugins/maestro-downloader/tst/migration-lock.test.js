import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  releaseLock,
  isLocked,
  inspectLock,
  blockedBecauseMigrating,
  __testing,
} from '../lib/migration-lock.js';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'maestro-lock-'));
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test('acquireLock: creates .migration/in-progress.lock containing pid+startedAt', () => {
  const path = acquireLock(root, { pid: 12345, now: () => '2026-05-13T00:00:00.000Z' });
  assert.equal(path, __testing.lockPath(root));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.pid, 12345);
  assert.equal(data.startedAt, '2026-05-13T00:00:00.000Z');
  assert.ok(isLocked(root));
  releaseLock(root);
});

test('releaseLock: removes the lockfile; no-op if already gone', () => {
  acquireLock(root, { pid: 12345 });
  releaseLock(root);
  assert.equal(isLocked(root), false);
  // Second release is a no-op (doesn't throw)
  assert.doesNotThrow(() => releaseLock(root));
});

test('acquireLock: refuses when a LIVE lock already exists', () => {
  // The current process IS alive — pid=process.pid creates a live lock.
  acquireLock(root, { pid: process.pid });
  assert.throws(
    () => acquireLock(root, { pid: process.pid + 100 }),
    /Migration already in progress/,
  );
  releaseLock(root);
});

test('acquireLock: removes stale lock (PID dead) and proceeds', () => {
  // PID 1 should always be alive (init), but PID 99999999 is essentially
  // guaranteed dead. We write a stale lockfile by hand.
  const path = __testing.lockPath(root);
  mkdirSync(join(root, '.migration'), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid: 99999999, startedAt: '2024-01-01T00:00:00.000Z' }));
  // Should remove stale + acquire fresh.
  assert.doesNotThrow(() => acquireLock(root, { pid: process.pid }));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.pid, process.pid);
  releaseLock(root);
});

test('acquireLock: handles corrupt lockfile by clearing and re-acquiring', () => {
  const path = __testing.lockPath(root);
  mkdirSync(join(root, '.migration'), { recursive: true });
  writeFileSync(path, '{this is not valid json');
  assert.doesNotThrow(() => acquireLock(root, { pid: process.pid }));
  releaseLock(root);
});

test('inspectLock: returns null when no lockfile', () => {
  assert.equal(inspectLock(root), null);
});

test('inspectLock: returns alive=true when current process holds the lock', () => {
  acquireLock(root, { pid: process.pid });
  const info = inspectLock(root);
  assert.equal(info.pid, process.pid);
  assert.equal(info.alive, true);
  releaseLock(root);
});

test('inspectLock: returns alive=false for stale PID', () => {
  const path = __testing.lockPath(root);
  mkdirSync(join(root, '.migration'), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid: 99999999, startedAt: '2024-01-01T00:00:00.000Z' }));
  const info = inspectLock(root);
  assert.equal(info.pid, 99999999);
  assert.equal(info.alive, false);
  releaseLock(root);
});

test('blockedBecauseMigrating: returns null when no lock', () => {
  assert.equal(blockedBecauseMigrating(root), null);
});

test('blockedBecauseMigrating: returns error string when live lock exists', () => {
  acquireLock(root, { pid: process.pid });
  const msg = blockedBecauseMigrating(root);
  assert.match(msg, /Migration in progress/);
  assert.match(msg, new RegExp(String(process.pid)));
  releaseLock(root);
});

test('blockedBecauseMigrating: returns null when lock is stale', () => {
  const path = __testing.lockPath(root);
  mkdirSync(join(root, '.migration'), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid: 99999999, startedAt: '2024-01-01T00:00:00.000Z' }));
  // Stale lock should not block — the next migrate.js run will clean it up.
  assert.equal(blockedBecauseMigrating(root), null);
  releaseLock(root);
});
