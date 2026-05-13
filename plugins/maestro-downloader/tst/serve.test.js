import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { get as httpGet } from 'node:http';

import { createApp, toRelativeUrl, rewriteCatalogueForUrls } from '../lib/serve.js';

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

// ── URL rewriting ─────────────────────────────────────────────────────────────

test('toRelativeUrl: strips root prefix and URL-encodes path segments', () => {
  assert.equal(
    toRelativeUrl('/Users/x/xfer/maestro/Course - Inst/Season 01/E1.webm', '/Users/x/xfer/maestro'),
    '/Course%20-%20Inst/Season%2001/E1.webm',
  );
});

test('toRelativeUrl: handles root path with trailing slash', () => {
  assert.equal(
    toRelativeUrl('/Users/x/xfer/maestro/foo.webm', '/Users/x/xfer/maestro/'),
    '/foo.webm',
  );
});

test('toRelativeUrl: returns input unchanged when path is not under root', () => {
  assert.equal(
    toRelativeUrl('/some/other/path.webm', '/Users/x/xfer/maestro'),
    '/some/other/path.webm',
  );
});

test('toRelativeUrl: returns input unchanged for null/empty', () => {
  assert.equal(toRelativeUrl(null, '/root'), null);
  assert.equal(toRelativeUrl('', '/root'), '');
});

test('rewriteCatalogueForUrls: rewrites localPath in flat v1 categories', () => {
  const root = '/Users/x/xfer/maestro';
  const data = {
    courses: [{
      slug: 'a/b',
      categories: [{
        title: 'Lessons',
        videos: [
          { title: 'V1', localPath: `${root}/courses/a/b/videos/Lessons/1-V1.webm` },
          { title: 'V2', localPath: null },
        ],
      }],
    }],
  };
  rewriteCatalogueForUrls(data, root);
  assert.equal(data.courses[0].categories[0].videos[0].localPath, '/courses/a/b/videos/Lessons/1-V1.webm');
  assert.equal(data.courses[0].categories[0].videos[1].localPath, null);
});

test('rewriteCatalogueForUrls: recurses into v2 subcategories', () => {
  const root = '/Users/x/xfer/maestro';
  const data = {
    courses: [{
      slug: 'a/b',
      categories: [{
        title: 'Top',
        subcategories: [{
          title: 'Leaf',
          videos: [{ title: 'V', localPath: `${root}/Show - Inst/Season 02/file.webm` }],
        }],
      }],
    }],
  };
  rewriteCatalogueForUrls(data, root);
  assert.equal(
    data.courses[0].categories[0].subcategories[0].videos[0].localPath,
    '/Show%20-%20Inst/Season%2002/file.webm',
  );
});

test('GET /index.json: localPath fields are rewritten to URL-relative paths', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'maestro-serve-rewrite-'));
  const absVideoPath = join(tmpRoot, 'Show - Inst', 'Season 01', 'Show - Inst - s01e01 - V.webm');
  writeFileSync(join(tmpRoot, 'index.json'), JSON.stringify({
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: [{
      slug: 'a/b', title: 'Show', instructor: 'Inst', courseUrl: 'https://x',
      subscribed: false, contentType: 'default',
      categories: [{ title: 'Lessons', videos: [{
        bbcMaestroIndex: 1, title: 'V',
        lessonUrl: 'https://x/v', manifestUrl: 'https://x/m.m3u8',
        completed: true, downloadedAt: '2026-05-10T00:00:00.000Z',
        localPath: absVideoPath,
      }] }],
    }],
  }));

  const app = createApp(tmpRoot, tmpRoot);
  await withServer(app, async (port) => {
    const { status, body } = await request(`http://localhost:${port}/index.json`);
    assert.equal(status, 200);
    const data = JSON.parse(body);
    const lp = data.courses[0].categories[0].videos[0].localPath;
    // Should be a relative URL, NOT the absolute filesystem path.
    assert.ok(!lp.startsWith(tmpRoot), `localPath should not contain absolute root, got: ${lp}`);
    assert.match(lp, /^\/Show%20-%20Inst\/Season%2001\//);
  });
});
