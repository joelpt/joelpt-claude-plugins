#!/usr/bin/env node
/**
 * Maestro TUI — single home-screen Ink app for managing the v2 library.
 *
 * Scope-trimmed per the v2 plan: subprocess-only (no in-process downloads),
 * single home screen, four features only:
 *   - List courses with subscription + content-type + progress columns
 *   - Toggle subscribed on highlighted course (Space)
 *   - Cycle content type on highlighted course (t → speech → music → visual → lean → default → ...)
 *   - Trigger rescan (r → spawns `node lib/fetch-list.js`)
 *   - Trigger download for all subscribed pending (d → spawns `node lib/queue.js`)
 *   - Esc to cancel the running subprocess, q to quit
 *
 * State of truth on disk is `<root>/index.json`. The TUI mutates in memory,
 * then writes via `atomicWriteJson` (schema-validated when schemaVersion: 2).
 * A debounced `fs.watch` on index.json reloads the in-memory state if a
 * subprocess writes to it externally.
 */
import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson, loadIndex } from '../index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');
const CONTENT_TYPE_CYCLE = ['default', 'speech', 'music', 'visual', 'lean'];

/** Walk a category tree yielding every video — both v1 and v2 shapes. */
function* walkVideos(categories) {
  if (!Array.isArray(categories)) return;
  for (const cat of categories) {
    if (Array.isArray(cat.videos)) for (const v of cat.videos) yield v;
    if (Array.isArray(cat.subcategories)) yield* walkVideos(cat.subcategories);
  }
}

function courseSummary(course) {
  const videos = [...walkVideos(course.categories)];
  return {
    total: videos.length,
    done: videos.filter(v => v.completed).length,
  };
}

function cycleContentType(current) {
  const idx = CONTENT_TYPE_CYCLE.indexOf(current ?? 'default');
  return CONTENT_TYPE_CYCLE[(idx + 1) % CONTENT_TYPE_CYCLE.length];
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

/** Pure render-data builder — extracted so tests can verify column formatting. */
export function buildRows(index) {
  return (index.courses ?? []).map((c) => {
    const { total, done } = courseSummary(c);
    return {
      slug: c.slug,
      subscribed: !!c.subscribed,
      title: c.title ?? '',
      instructor: c.instructor ?? '',
      contentType: c.contentType ?? 'default',
      total,
      done,
    };
  });
}

const HEADER_COLS = {
  check: 3,
  title: 36,
  instructor: 22,
  type: 9,
  progress: 9,
};

function HeaderRow() {
  return React.createElement(
    Box,
    { borderStyle: 'single', borderTop: false, borderLeft: false, borderRight: false, paddingX: 1 },
    React.createElement(Text, { bold: true }, pad('☑', HEADER_COLS.check)),
    React.createElement(Text, { bold: true }, pad('Title', HEADER_COLS.title)),
    React.createElement(Text, { bold: true }, pad('Instructor', HEADER_COLS.instructor)),
    React.createElement(Text, { bold: true }, pad('Type', HEADER_COLS.type)),
    React.createElement(Text, { bold: true }, pad('Progress', HEADER_COLS.progress)),
  );
}

function Row({ row, selected }) {
  const check = row.subscribed ? '☑' : '☐';
  const color = selected ? 'cyan' : undefined;
  return React.createElement(
    Box,
    { paddingX: 1 },
    React.createElement(Text, { color, inverse: selected }, pad(check, HEADER_COLS.check)),
    React.createElement(Text, { color, inverse: selected }, pad(row.title, HEADER_COLS.title)),
    React.createElement(Text, { color, inverse: selected }, pad(row.instructor, HEADER_COLS.instructor)),
    React.createElement(Text, { color, inverse: selected }, pad(row.contentType, HEADER_COLS.type)),
    React.createElement(Text, { color, inverse: selected }, pad(`${row.done}/${row.total}`, HEADER_COLS.progress)),
  );
}

function HelpFooter({ runningKind }) {
  const lines = [
    '↑↓ navigate · Space subscribe · t cycle type · r rescan · d download · Esc cancel · q quit',
  ];
  if (runningKind) lines.push(`Running: ${runningKind} (Esc to cancel)`);
  return React.createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'single', borderBottom: false, borderLeft: false, borderRight: false, paddingX: 1 },
    ...lines.map((l, i) => React.createElement(Text, { key: i, dimColor: true }, l)),
  );
}

function LogPanel({ lines }) {
  if (lines.length === 0) return null;
  return React.createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1, marginTop: 1, height: 12 },
    React.createElement(Text, { bold: true, dimColor: true }, 'Subprocess log (tail)'),
    ...lines.slice(-10).map((l, i) => React.createElement(Text, { key: i, wrap: 'truncate-end' }, l)),
  );
}

/** Main app component. Pure-ish: takes `root` and `indexPath` as props for
 *  testability. The CLI entry point wires those from env.
 */
export function App({ root, indexPath, spawnImpl = spawn, exitImpl = process.exit }) {
  const { exit } = useApp();
  const [index, setIndex] = React.useState(() => {
    try { return loadIndex(indexPath); } catch { return { lastFetched: null, courses: [] }; }
  });
  const [selected, setSelected] = React.useState(0);
  const [logLines, setLogLines] = React.useState([]);
  const [running, setRunning] = React.useState(null);   // { kind, child }
  const lastWriteAt = React.useRef(0);

  // Re-load the index when something external (subprocess) writes to it.
  // Debounce so a flurry of writes (recordCompletion writes after each video)
  // doesn't thrash.
  React.useEffect(() => {
    if (!existsSync(indexPath)) return undefined;
    let timer = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          // Skip if this write was ours (within 100ms of an in-process write).
          if (Date.now() - lastWriteAt.current < 100) return;
          setIndex(loadIndex(indexPath));
        } catch {
          // ignore transient parse errors during partial writes
        }
      }, 200);
    };
    const watcher = watch(indexPath, handler);
    return () => { watcher.close(); if (timer) clearTimeout(timer); };
  }, [indexPath]);

  const rows = React.useMemo(() => buildRows(index), [index]);

  // Bound `selected` to the valid range whenever rows change.
  React.useEffect(() => {
    if (rows.length === 0) setSelected(0);
    else if (selected >= rows.length) setSelected(rows.length - 1);
  }, [rows.length, selected]);

  function mutateCourse(slug, mutator) {
    const next = structuredClone(index);
    const c = (next.courses ?? []).find((x) => x.slug === slug);
    if (!c) return;
    mutator(c);
    try {
      lastWriteAt.current = Date.now();
      atomicWriteJson(indexPath, next);
      setIndex(next);
    } catch (e) {
      setLogLines((l) => [...l, `✗ write failed: ${e.message}`]);
    }
  }

  function startSubprocess(kind, cmd, args) {
    if (running) return;
    setLogLines((l) => [...l, `▶ Starting ${kind}: ${cmd} ${args.join(' ')}`]);
    const child = spawnImpl(cmd, args, { cwd: dirname(dirname(fileURLToPath(import.meta.url))), env: process.env });
    setRunning({ kind, child });
    const onLine = (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        setLogLines((l) => [...l.slice(-49), line]);
      }
    };
    child.stdout?.on?.('data', onLine);
    child.stderr?.on?.('data', onLine);
    child.on('close', (code) => {
      setLogLines((l) => [...l.slice(-49), `✓ ${kind} exited with code ${code}`]);
      setRunning(null);
    });
  }

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSelected((s) => Math.min(rows.length - 1, s + 1));
    else if (input === ' ') {
      const row = rows[selected];
      if (row) mutateCourse(row.slug, (c) => { c.subscribed = !c.subscribed; });
    }
    else if (input === 't') {
      const row = rows[selected];
      if (row) mutateCourse(row.slug, (c) => { c.contentType = cycleContentType(c.contentType); });
    }
    else if (input === 'r') {
      startSubprocess('rescan', process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'fetch-list.js')]);
    }
    else if (input === 'd') {
      startSubprocess('download', process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'queue.js')]);
    }
    else if (key.escape) {
      if (running?.child) {
        running.child.kill('SIGTERM');
        setLogLines((l) => [...l, '⏹ Sent SIGTERM to subprocess']);
      }
    }
    else if (input === 'q') {
      if (running?.child) running.child.kill('SIGTERM');
      exit();
      if (exitImpl) exitImpl(0);
    }
  });

  const fetchedStr = index.lastFetched
    ? new Date(index.lastFetched).toLocaleString()
    : 'never';

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(
      Box,
      { borderStyle: 'single', borderColor: 'cyan', paddingX: 1 },
      React.createElement(Text, { bold: true }, 'Maestro Library  '),
      React.createElement(Text, { dimColor: true }, `· ${rows.length} courses · catalogue fetched: ${fetchedStr}`),
    ),
    React.createElement(HeaderRow),
    rows.length === 0
      ? React.createElement(Box, { paddingX: 1 }, React.createElement(Text, null, 'No courses yet. Press r to rescan.'))
      : rows.map((row, i) => React.createElement(Row, { key: row.slug, row, selected: i === selected })),
    React.createElement(LogPanel, { lines: logLines }),
    React.createElement(HelpFooter, { runningKind: running?.kind }),
  );
}

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) {
    console.error('MAESTRO_ROOT not set. Run /setup first.');
    process.exit(1);
  }
  const indexPath = join(root, 'index.json');
  render(React.createElement(App, { root, indexPath }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
