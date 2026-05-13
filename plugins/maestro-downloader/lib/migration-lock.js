import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCK_BASENAME = 'in-progress.lock';

function lockPath(root) {
  return join(root, '.migration', LOCK_BASENAME);
}

/**
 * Acquire the migration lockfile. Refuses if a live lock already exists.
 * A stale lock (PID dead) is detected and removed automatically with a warning.
 * Returns the lock-file absolute path so callers can `releaseLock` later.
 * Throws on a live conflicting lock.
 */
export function acquireLock(root, { pid = process.pid, now = () => new Date().toISOString() } = {}) {
  const path = lockPath(root);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    let prior;
    try {
      prior = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      prior = { pid: null, startedAt: null, _corrupt: true };
    }
    if (prior.pid && isProcessAlive(prior.pid)) {
      const err = new Error(
        `Migration already in progress (PID ${prior.pid}, started ${prior.startedAt}). ` +
        `If you're sure no migrate.js is running, remove the stale lock at: ${path}`,
      );
      err.code = 'MIGRATION_LOCKED';
      err.lockHolder = prior;
      throw err;
    }
    // Stale or corrupt lock: clear and re-acquire.
    unlinkSync(path);
  }
  const content = { pid, startedAt: now(), version: 1 };
  writeFileSync(path, JSON.stringify(content, null, 2), { encoding: 'utf8', flag: 'wx' });
  return path;
}

/** Release the lockfile. No-op if it's already gone. */
export function releaseLock(root) {
  const path = lockPath(root);
  try {
    unlinkSync(path);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/** True if a (live or stale) lockfile exists for this root. */
export function isLocked(root) {
  return existsSync(lockPath(root));
}

/** Inspect the lock without modifying it. Returns:
 *    `null` if no lock file
 *    `{ pid, startedAt, alive: boolean }` otherwise (alive=false means stale)
 */
export function inspectLock(root) {
  const path = lockPath(root);
  if (!existsSync(path)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { pid: null, startedAt: null, alive: false, corrupt: true };
  }
  return { ...data, alive: data.pid ? isProcessAlive(data.pid) : false };
}

/** Install SIGINT/SIGTERM handlers that release the lock on exit. Returns a
 *  cleanup function that removes the handlers and releases. Idempotent.
 */
export function installShutdownReleaser(root, { signals = ['SIGINT', 'SIGTERM'] } = {}) {
  let released = false;
  const handler = () => {
    if (released) return;
    released = true;
    try { releaseLock(root); } catch { /* swallow on shutdown */ }
    process.exit(130);
  };
  for (const sig of signals) process.on(sig, handler);
  return () => {
    released = true;
    for (const sig of signals) process.off(sig, handler);
    try { releaseLock(root); } catch { /* idempotent */ }
  };
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    // Signal 0: existence check only; doesn't actually signal.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the PID exists but we can't signal it → still alive
    if (e.code === 'EPERM') return true;
    return false;
  }
}

/** For tests only — expose the path computation. */
export const __testing = { lockPath };

/** Reusable helper for callers (e.g. recordCompletion) that need to refuse to
 *  write while a migration is running. Returns null if writeable; otherwise
 *  returns an error message string describing the holder.
 */
export function blockedBecauseMigrating(root) {
  const ins = inspectLock(root);
  if (!ins) return null;
  if (!ins.alive) return null; // stale lock — let the migrator clean it up
  return `Migration in progress (PID ${ins.pid}, started at ${ins.startedAt}). ` +
    `Stop migrate.js before writing to index.json.`;
}
