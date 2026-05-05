import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { get as httpGet } from 'node:http';

import { createApp } from '../lib/serve.js';

function request(url) {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] ?? '', body }));
    }).on('error', reject);
  });
}

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const { port } = server.address();
      try {
        resolve(await fn(port));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('GET / returns ui/index.html content', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'maestro-serve-'));
  const tmpUiDir = mkdtempSync(join(tmpdir(), 'maestro-ui-'));
  writeFileSync(join(tmpUiDir, 'index.html'), '<html><body>TEST_SENTINEL</body></html>');

  const app = createApp(tmpRoot, tmpUiDir);

  await withServer(app, async (port) => {
    const { status, body } = await request(`http://localhost:${port}/`);
    assert.equal(status, 200);
    assert.ok(body.includes('TEST_SENTINEL'), 'should return content from ui/index.html');
  });
});

test('GET /*.webm returns Content-Type: video/webm', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'maestro-serve-'));
  const coursesDir = join(tmpRoot, 'courses', 'test-slug', 'videos', 'Intro');
  mkdirSync(coursesDir, { recursive: true });
  writeFileSync(join(coursesDir, '1-lesson.webm'), Buffer.alloc(10));

  const app = createApp(tmpRoot, tmpRoot);

  await withServer(app, async (port) => {
    const { status, contentType } = await request(
      `http://localhost:${port}/courses/test-slug/videos/Intro/1-lesson.webm`,
    );
    assert.equal(status, 200);
    assert.ok(contentType.includes('video/webm'), `expected video/webm, got ${contentType}`);
  });
});

test('GET /index.json returns application/json', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'maestro-serve-'));
  writeFileSync(join(tmpRoot, 'index.json'), JSON.stringify({ lastFetched: null, courses: [] }));

  const app = createApp(tmpRoot, tmpRoot);

  await withServer(app, async (port) => {
    const { status, contentType } = await request(`http://localhost:${port}/index.json`);
    assert.equal(status, 200);
    assert.ok(contentType.includes('application/json'), `expected application/json, got ${contentType}`);
  });
});

test('GET /nonexistent returns 404', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'maestro-serve-'));
  const tmpUiDir = mkdtempSync(join(tmpdir(), 'maestro-ui-'));
  writeFileSync(join(tmpUiDir, 'index.html'), '<html><body>UI</body></html>');

  const app = createApp(tmpRoot, tmpUiDir);

  await withServer(app, async (port) => {
    const { status } = await request(`http://localhost:${port}/does-not-exist.html`);
    assert.equal(status, 404);
  });
});
