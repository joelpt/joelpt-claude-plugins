import { statSync, createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Fetch a remote image and write it to `destPath`. Idempotent: if `destPath`
 *  already exists with a size matching the response's content-length, the file
 *  is left untouched and `{ skipped: true }` is returned.
 *
 *  Returns `{ skipped: false, bytesWritten }` on a fresh download, or
 *  `{ skipped: true }` when the existing file already matches.
 *
 *  Throws on HTTP error or network timeout.
 */
export async function downloadImage(url, destPath, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`artwork fetch timed out after ${timeoutMs}ms: ${url}`)), timeoutMs);
  let resp;
  try {
    resp = await fetchImpl(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching ${url}`);

  const lenHdr = resp.headers.get('content-length');
  const expectedSize = lenHdr ? Number(lenHdr) : null;

  if (expectedSize !== null) {
    try {
      const stat = statSync(destPath);
      if (stat.size === expectedSize) {
        // Drain the response body so the connection can close cleanly.
        if (resp.body) await resp.body.cancel().catch(() => {});
        return { skipped: true, bytesWritten: 0 };
      }
    } catch {
      // destPath doesn't exist → fall through to download
    }
  }

  mkdirSync(dirname(destPath), { recursive: true });
  let bytesWritten = 0;
  const reader = Readable.fromWeb(resp.body);
  reader.on('data', (chunk) => { bytesWritten += chunk.length; });
  await pipeline(reader, createWriteStream(destPath));
  return { skipped: false, bytesWritten };
}

/** Download a course's artwork into the show folder.
 *  Writes `poster.jpg`, `fanart.jpg` (if `course.posterUrl` / `course.fanartUrl`
 *  are set). Idempotent — pre-existing same-size files are skipped.
 *
 *  Returns `{ poster, fanart }` where each value is the result from
 *  `downloadImage` or `{ skipped: true, reason: 'no-url' }` when the URL is
 *  absent.
 */
export async function downloadArtwork(course, showDir, options = {}) {
  const out = {};
  if (course.posterUrl) {
    out.poster = await downloadImage(course.posterUrl, join(showDir, 'poster.jpg'), options);
  } else {
    out.poster = { skipped: true, reason: 'no-url' };
  }
  if (course.fanartUrl) {
    out.fanart = await downloadImage(course.fanartUrl, join(showDir, 'fanart.jpg'), options);
  } else {
    out.fanart = { skipped: true, reason: 'no-url' };
  }
  return out;
}
