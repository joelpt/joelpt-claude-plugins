import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadImage, downloadArtwork } from '../lib/artwork.js';

let workDir;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'maestro-artwork-test-'));
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** Build a stub fetch that returns a Response-like object with given body bytes. */
function stubFetch({ status = 200, body = Buffer.from('PNGDATA-128'.repeat(8)), contentLength = null, statusText = 'OK', failOnce = false } = {}) {
  let called = 0;
  let nextShouldFail = failOnce;
  const fakeFetch = async (_url, _opts) => {
    called++;
    if (nextShouldFail) {
      nextShouldFail = false;
      throw new Error('simulated network error');
    }
    const cl = contentLength ?? body.length;
    const headers = new Map([['content-length', String(cl)]]);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }),
    };
  };
  fakeFetch.callCount = () => called;
  return fakeFetch;
}

test('downloadImage writes file and reports bytesWritten on fresh download', async () => {
  const dest = join(workDir, 'fresh.jpg');
  const body = Buffer.from('image-bytes-here');
  const fetchImpl = stubFetch({ body });
  const result = await downloadImage('https://x/img.jpg', dest, { fetchImpl });
  assert.equal(result.skipped, false);
  assert.equal(result.bytesWritten, body.length);
  assert.equal(statSync(dest).size, body.length);
});

test('downloadImage skips when existing file size matches content-length', async () => {
  const dest = join(workDir, 'existing.jpg');
  const body = Buffer.from('image-bytes-here-larger-this-time-around-yes');
  // Seed the destination with the exact bytes.
  writeFileSync(dest, body);
  const fetchImpl = stubFetch({ body });
  const result = await downloadImage('https://x/img.jpg', dest, { fetchImpl });
  assert.equal(result.skipped, true);
  assert.equal(result.bytesWritten, 0);
  // File untouched — same content.
  assert.equal(readFileSync(dest).toString(), body.toString());
});

test('downloadImage re-downloads when existing file size differs from content-length', async () => {
  const dest = join(workDir, 'stale.jpg');
  writeFileSync(dest, 'old-stale-content');
  const body = Buffer.from('fresh-replacement-content-bigger-now');
  const fetchImpl = stubFetch({ body });
  const result = await downloadImage('https://x/img.jpg', dest, { fetchImpl });
  assert.equal(result.skipped, false);
  assert.equal(result.bytesWritten, body.length);
  assert.equal(readFileSync(dest).toString(), body.toString());
});

test('downloadImage creates intermediate directories', async () => {
  const dest = join(workDir, 'deep', 'nested', 'path', 'image.jpg');
  const body = Buffer.from('data');
  const fetchImpl = stubFetch({ body });
  await downloadImage('https://x/i.jpg', dest, { fetchImpl });
  assert.ok(existsSync(dest));
});

test('downloadImage throws on HTTP error status', async () => {
  const dest = join(workDir, 'fourohfour.jpg');
  const fetchImpl = stubFetch({ status: 404, statusText: 'Not Found' });
  await assert.rejects(
    downloadImage('https://x/missing.jpg', dest, { fetchImpl }),
    /HTTP 404/,
  );
  assert.equal(existsSync(dest), false, 'file should not exist after failed download');
});

test('downloadImage rejects on fetch network failure', async () => {
  const dest = join(workDir, 'network-fail.jpg');
  const fetchImpl = stubFetch({ failOnce: true });
  await assert.rejects(
    downloadImage('https://x/y.jpg', dest, { fetchImpl }),
    /simulated network error/,
  );
});

test('downloadArtwork: writes both poster.jpg and fanart.jpg when both URLs present', async () => {
  const showDir = join(workDir, 'show-both');
  const course = {
    posterUrl: 'https://cdn/poster.jpg',
    fanartUrl: 'https://cdn/fanart.jpg',
  };
  const fetchImpl = stubFetch({ body: Buffer.from('image-data') });
  const res = await downloadArtwork(course, showDir, { fetchImpl });
  assert.equal(res.poster.skipped, false);
  assert.equal(res.fanart.skipped, false);
  assert.ok(existsSync(join(showDir, 'poster.jpg')));
  assert.ok(existsSync(join(showDir, 'fanart.jpg')));
});

test('downloadArtwork: skips poster with reason="no-url" when posterUrl absent', async () => {
  const showDir = join(workDir, 'show-no-poster');
  const fetchImpl = stubFetch({ body: Buffer.from('x') });
  const res = await downloadArtwork({ fanartUrl: 'https://cdn/fanart.jpg' }, showDir, { fetchImpl });
  assert.deepEqual(res.poster, { skipped: true, reason: 'no-url' });
  assert.equal(res.fanart.skipped, false);
});

test('downloadArtwork: both skipped when neither URL is set', async () => {
  const showDir = join(workDir, 'show-no-art');
  const fetchImpl = stubFetch({ body: Buffer.from('x') });
  const res = await downloadArtwork({}, showDir, { fetchImpl });
  assert.equal(res.poster.skipped, true);
  assert.equal(res.fanart.skipped, true);
  assert.equal(existsSync(showDir), false, 'show dir should not be created when no artwork');
});

test('downloadArtwork: idempotent — re-running with same content does nothing', async () => {
  const showDir = join(workDir, 'show-idem');
  const course = { posterUrl: 'https://cdn/poster.jpg', fanartUrl: 'https://cdn/fanart.jpg' };
  const body = Buffer.from('static-image-bytes');
  const fetchImpl = stubFetch({ body });
  await downloadArtwork(course, showDir, { fetchImpl });
  const res2 = await downloadArtwork(course, showDir, { fetchImpl });
  assert.equal(res2.poster.skipped, true);
  assert.equal(res2.fanart.skipped, true);
});
