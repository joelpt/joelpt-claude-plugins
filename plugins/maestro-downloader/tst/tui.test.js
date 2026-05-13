import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, buildRows } from '../lib/tui/main.js';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'maestro-tui-'));
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function makeIndex(courses = []) {
  return {
    schemaVersion: 2,
    lastFetched: '2026-05-13T00:00:00.000Z',
    courses: courses.map((c) => ({
      slug: c.slug,
      title: c.title,
      instructor: c.instructor,
      courseUrl: `https://x/${c.slug}`,
      subscribed: c.subscribed ?? false,
      contentType: c.contentType ?? 'default',
      categories: [{
        title: 'Lessons',
        videos: (c.videos ?? []).map((v, i) => ({
          bbcMaestroIndex: i + 1,
          title: v.title ?? `V${i + 1}`,
          lessonUrl: `https://x/${c.slug}/${i + 1}`,
          manifestUrl: `https://x/${c.slug}/${i + 1}.m3u8`,
          completed: v.completed ?? false,
          downloadedAt: v.completed ? '2026-05-10T00:00:00.000Z' : null,
          localPath: v.completed ? `/x/${c.slug}/${i + 1}.webm` : null,
        })),
      }],
    })),
  };
}

function writeIndex(courses) {
  const path = join(root, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(makeIndex(courses)));
  return path;
}

/** Yield once so React's useEffect callbacks (which install useInput
 *  handlers and fs.watch) have a chance to run before we touch stdin. */
async function tick() { await new Promise(r => setImmediate(r)); }

const ESC = '';
const DOWN = `${ESC}[B`;

// ── pure buildRows ────────────────────────────────────────────────────────────

test('buildRows: flattens index courses into row data with subscribed + progress', () => {
  const idx = makeIndex([
    {
      slug: 'a/b', title: 'Show A', instructor: 'Alice', subscribed: true, contentType: 'music',
      videos: [{ completed: true }, { completed: false }],
    },
  ]);
  const rows = buildRows(idx);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    slug: 'a/b',
    subscribed: true,
    title: 'Show A',
    instructor: 'Alice',
    contentType: 'music',
    total: 2,
    done: 1,
  });
});

test('buildRows: handles courses without contentType (defaults to "default")', () => {
  const idx = { courses: [{ slug: 'a/b', title: 'X', instructor: 'Y', categories: [] }] };
  const rows = buildRows(idx);
  assert.equal(rows[0].contentType, 'default');
});

// ── Ink rendering smoke tests ────────────────────────────────────────────────

test('App: renders course list with correct columns', async () => {
  const path = writeIndex([
    { slug: 'eric/singing', title: 'Sing Like the Stars', instructor: 'Eric Vetro', subscribed: true, contentType: 'music', videos: [{ completed: true }, { completed: true }] },
    { slug: 'owen/anxious', title: 'A Life Less Anxious', instructor: 'Owen', videos: [{ completed: false }] },
  ]);
  const { lastFrame, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {} }));
  try {
    await tick();
    const frame = lastFrame();
    assert.match(frame, /Maestro Library/);
    assert.match(frame, /Sing Like the Stars/);
    assert.match(frame, /A Life Less Anxious/);
    assert.match(frame, /Eric Vetro/);
    assert.match(frame, /2\/2/);
    assert.match(frame, /0\/1/);
  } finally { unmount(); }
});

test('App: shows empty state when no courses', async () => {
  const path = writeIndex([]);
  const { lastFrame, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {} }));
  try {
    await tick();
    assert.match(lastFrame(), /No courses yet/);
  } finally { unmount(); }
});

test('App: Space toggles subscribed on highlighted course and persists to index.json', async () => {
  const path = writeIndex([
    { slug: 'a/b', title: 'X', instructor: 'I', subscribed: false, videos: [] },
  ]);
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {} }));
  try {
    await tick();
    stdin.write(' ');
    await tick();
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.courses[0].subscribed, true);
  } finally { unmount(); }
});

test('App: t cycles contentType on highlighted course', async () => {
  const path = writeIndex([
    { slug: 'a/b', title: 'X', instructor: 'I', contentType: 'default', videos: [] },
  ]);
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {} }));
  try {
    await tick();
    stdin.write('t');
    await tick();
    let persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.courses[0].contentType, 'speech');
    stdin.write('t');
    await tick();
    persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.courses[0].contentType, 'music');
  } finally { unmount(); }
});

test('App: down-arrow moves selection then Space toggles second course (not first)', async () => {
  const path = writeIndex([
    { slug: 'a/b', title: 'First', instructor: 'I', subscribed: false, videos: [] },
    { slug: 'c/d', title: 'Second', instructor: 'I', subscribed: false, videos: [] },
  ]);
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {} }));
  try {
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(' ');
    await tick();
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.courses[0].subscribed, false, 'first untouched');
    assert.equal(persisted.courses[1].subscribed, true, 'second toggled');
  } finally { unmount(); }
});

test('App: r triggers a subprocess (rescan) — captured via spawnImpl stub', async () => {
  const path = writeIndex([{ slug: 'a/b', title: 'X', instructor: 'I', videos: [] }]);
  let capturedCmd = null;
  let capturedArgs = null;
  const stubSpawn = (cmd, args) => {
    capturedCmd = cmd;
    capturedArgs = args;
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, kill: () => {} };
  };
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {}, spawnImpl: stubSpawn }));
  try {
    await tick();
    stdin.write('r');
    await tick();
    assert.equal(capturedCmd, process.execPath);
    assert.ok(capturedArgs.some((a) => /fetch-list\.js$/.test(a)), `expected fetch-list.js in spawn args, got ${JSON.stringify(capturedArgs)}`);
  } finally { unmount(); }
});

test('App: d triggers a subprocess (download queue)', async () => {
  const path = writeIndex([{ slug: 'a/b', title: 'X', instructor: 'I', videos: [] }]);
  let capturedArgs = null;
  const stubSpawn = (cmd, args) => {
    capturedArgs = args;
    return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, kill: () => {} };
  };
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {}, spawnImpl: stubSpawn }));
  try {
    await tick();
    stdin.write('d');
    await tick();
    assert.ok(capturedArgs.some((a) => /queue\.js$/.test(a)), `expected queue.js in spawn args, got ${JSON.stringify(capturedArgs)}`);
  } finally { unmount(); }
});

test('App: Esc sends SIGTERM to running subprocess', async () => {
  const path = writeIndex([{ slug: 'a/b', title: 'X', instructor: 'I', videos: [] }]);
  let killSignal = null;
  let onCloseCb = null;
  const stubSpawn = () => ({
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (ev, cb) => { if (ev === 'close') onCloseCb = cb; },
    kill: (sig) => { killSignal = sig; if (onCloseCb) onCloseCb(143); },
  });
  const { stdin, unmount } = render(React.createElement(App, { root, indexPath: path, exitImpl: () => {}, spawnImpl: stubSpawn }));
  try {
    await tick();
    stdin.write('r');
    await tick();
    stdin.write(ESC);
    await tick();
    assert.equal(killSignal, 'SIGTERM');
  } finally { unmount(); }
});

// Note: the App also installs fs.watch on indexPath with a 200ms debounce to
// pick up external writes (subprocess updates from queue.js / migrate.js). I
// tried unit-testing this with ink-testing-library + writeFileSync, but the
// React + ink-testing-library + fs.watch interaction is flaky (FSEvents
// coalescing on macOS, render-loop timing). The behavior is exercised in
// production via real subprocess writes. The unit test would only test the
// test infrastructure.
