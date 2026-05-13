import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  sanitizeFilename,
  legacySanitizeFilename,
  legacySanitizeFilenamePreAmpStrip,
  pad2,
  showFolderName,
  episodeFileName,
  enumerateSeasons,
  deriveOutputPath,
  showDirPath,
  seasonDirPath,
  legacyDeriveOutputPath,
  legacyDeriveOutputPathCandidates,
} from '../lib/layout.js';

const ROOT = '/tmp/maestro-root';

function makeVideo(overrides = {}) {
  return {
    bbcMaestroIndex: 1,
    title: 'Origin Story',
    lessonUrl: 'https://example/lesson',
    manifestUrl: 'https://example/manifest.m3u8',
    completed: false,
    downloadedAt: null,
    localPath: null,
    ...overrides,
  };
}

function makeCourse(overrides = {}) {
  return {
    slug: 'eric-vetro/singing',
    title: 'Sing Like the Stars',
    instructor: 'Eric Vetro',
    courseUrl: 'https://example/course',
    subscribed: true,
    contentType: 'music',
    categories: [],
    ...overrides,
  };
}

// ── sanitization ──────────────────────────────────────────────────────────────

test('sanitizeFilename strips Windows/Mac-banned chars', () => {
  assert.equal(sanitizeFilename('foo:bar/baz?qux*quux|"corge"<>'), 'foobarbazquxquuxcorge');
});

test('sanitizeFilename collapses whitespace and trims', () => {
  assert.equal(sanitizeFilename('  hello   world  '), 'hello world');
});

test('sanitizeFilename strips trailing dots (Windows quirk)', () => {
  assert.equal(sanitizeFilename('config...'), 'config');
});

test('sanitizeFilename preserves accents via NFC normalization', () => {
  assert.equal(sanitizeFilename('Café Müller'), 'Café Müller');
});

test('sanitizeFilename preserves ampersand and apostrophe (no special-case)', () => {
  assert.equal(sanitizeFilename("Owen O'Kane & Friends"), "Owen O'Kane & Friends");
});

test('legacySanitizeFilename strips colons to dashes and removes ampersand', () => {
  assert.equal(legacySanitizeFilename('a:b'), 'a-b');
  // & is stripped; the resulting double-space gets collapsed by the \s+ step
  assert.equal(legacySanitizeFilename('Tea & Sympathy'), 'Tea Sympathy');
});

// ── pad2 ──────────────────────────────────────────────────────────────────────

test('pad2 zero-pads to 2 digits', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2(1), '01');
  assert.equal(pad2(10), '10');
  assert.equal(pad2(99), '99');
});

// ── showFolderName / episodeFileName ──────────────────────────────────────────

test('showFolderName uses <title> - <instructor>', () => {
  assert.equal(showFolderName(makeCourse()), 'Sing Like the Stars - Eric Vetro');
});

test('showFolderName sanitizes both parts', () => {
  const c = makeCourse({ title: 'X:Y', instructor: 'A|B' });
  assert.equal(showFolderName(c), 'XY - AB');
});

test('episodeFileName uses <show> - sNNeMM - <safeTitle>', () => {
  assert.equal(
    episodeFileName('Sing Like the Stars - Eric Vetro', 1, 1, 'Origin Story'),
    'Sing Like the Stars - Eric Vetro - s01e01 - Origin Story',
  );
});

// ── enumerateSeasons ──────────────────────────────────────────────────────────

test('enumerateSeasons: single-category course', () => {
  const c = makeCourse({
    categories: [{
      title: 'Lessons',
      videos: [makeVideo({ title: 'A' }), makeVideo({ title: 'B', bbcMaestroIndex: 2 })],
    }],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].seasonNumber, 1);
  assert.equal(seasons[0].title, 'Lessons');
  assert.equal(seasons[0].isSpecials, false);
  assert.equal(seasons[0].videos.length, 2);
  assert.equal(seasons[0].videos[0].episodeNumber, 1);
  assert.equal(seasons[0].videos[1].episodeNumber, 2);
});

test('enumerateSeasons: multi-category course, each leaf is a season', () => {
  const c = makeCourse({
    categories: [
      { title: 'Lessons', videos: [makeVideo({ title: 'A' })] },
      { title: 'Eric Vetro', videos: [makeVideo({ title: 'B' })] },
    ],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 2);
  assert.deepEqual(seasons.map(s => s.seasonNumber), [1, 2]);
  assert.deepEqual(seasons.map(s => s.title), ['Lessons', 'Eric Vetro']);
});

test('enumerateSeasons: subcategories produce seasons titled with parent →', () => {
  const c = makeCourse({
    categories: [
      { title: 'Lessons', videos: [makeVideo({ title: 'L1' })] },
      {
        title: 'Vocal Exercises',
        subcategories: [
          { title: 'Breathing Fundamentals', videos: [makeVideo({ title: 'V1' })] },
          { title: 'Articulation', videos: [makeVideo({ title: 'V2' })] },
        ],
      },
    ],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 3);
  assert.deepEqual(seasons.map(s => s.title), [
    'Lessons',
    'Vocal Exercises → Breathing Fundamentals',
    'Vocal Exercises → Articulation',
  ]);
  assert.deepEqual(seasons.map(s => s.seasonNumber), [1, 2, 3]);
});

test('enumerateSeasons: Specials category title (case-insensitive) yields season 0', () => {
  const c = makeCourse({
    categories: [
      { title: 'Consent', videos: [makeVideo({ title: 'I consent' })] },
      { title: 'Lessons', videos: [makeVideo({ title: 'Real lesson' })] },
    ],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].isSpecials, true);
  assert.equal(seasons[0].seasonNumber, 0);
  assert.equal(seasons[0].title, 'Specials');
  assert.equal(seasons[1].seasonNumber, 1);
  assert.equal(seasons[1].title, 'Lessons');
});

test('enumerateSeasons: video.extras=true inside a regular season moves to Specials', () => {
  const c = makeCourse({
    categories: [{
      title: 'Lessons',
      videos: [
        makeVideo({ title: 'Trailer', extras: true }),
        makeVideo({ title: 'Episode 1' }),
      ],
    }],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].isSpecials, true);
  assert.equal(seasons[0].videos[0].video.title, 'Trailer');
  assert.equal(seasons[1].title, 'Lessons');
  assert.equal(seasons[1].videos.length, 1);
});

test('enumerateSeasons: no Specials entry if no specials/extras videos exist', () => {
  const c = makeCourse({
    categories: [{ title: 'Lessons', videos: [makeVideo()] }],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].isSpecials, false);
});

test('enumerateSeasons: empty categories returns []', () => {
  const c = makeCourse({ categories: [] });
  assert.deepEqual(enumerateSeasons(c), []);
});

test('enumerateSeasons: Specials accumulates videos from a Specials leaf AND extras:true videos in regular leaves', () => {
  const c = makeCourse({
    categories: [
      { title: 'Intro', videos: [
        makeVideo({ title: 'I1' }),
        makeVideo({ title: 'I2' }),
        makeVideo({ title: 'I3' }),
      ] },
      { title: 'Lessons', videos: [
        makeVideo({ title: 'E1', extras: true }),
        makeVideo({ title: 'L1' }),
        makeVideo({ title: 'E2', extras: true }),
      ] },
    ],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].isSpecials, true);
  assert.equal(seasons[0].seasonNumber, 0);
  // 3 Intro videos (DFS pre-order, before Lessons) + 2 extras from Lessons = 5
  assert.equal(seasons[0].videos.length, 5);
  assert.deepEqual(seasons[0].videos.map(e => e.video.title), ['I1', 'I2', 'I3', 'E1', 'E2']);
  assert.deepEqual(seasons[0].videos.map(e => e.episodeNumber), [1, 2, 3, 4, 5]);
  // Regular season picks up only L1, numbered 01 (gap-free)
  assert.equal(seasons[1].seasonNumber, 1);
  assert.equal(seasons[1].title, 'Lessons');
  assert.equal(seasons[1].videos.length, 1);
  assert.equal(seasons[1].videos[0].video.title, 'L1');
});

test('enumerateSeasons: multiple consecutive Specials-titled leaves merge into one Specials season', () => {
  const c = makeCourse({
    categories: [
      { title: 'Consent', videos: [makeVideo({ title: 'C1' })] },
      { title: 'Intro', videos: [makeVideo({ title: 'I1' })] },
      { title: 'Lessons', videos: [makeVideo({ title: 'L1' })] },
    ],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].isSpecials, true);
  assert.deepEqual(seasons[0].videos.map(e => e.video.title), ['C1', 'I1']);
  assert.equal(seasons[1].seasonNumber, 1, 'regular season numbering starts at 1, no gap');
});

test('enumerateSeasons: category with BOTH subcategories AND videos takes subs branch (drops parent videos)', () => {
  // Schema forbids this combo; document the deterministic fallback in case
  // a future migration produces such a node by mistake.
  const c = makeCourse({
    categories: [{
      title: 'Mixed',
      videos: [makeVideo({ title: 'parent-vid' })],
      subcategories: [
        { title: 'Sub1', videos: [makeVideo({ title: 'sub-vid' })] },
      ],
    }],
  });
  const seasons = enumerateSeasons(c);
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].title, 'Mixed → Sub1');
  assert.deepEqual(seasons[0].videos.map(e => e.video.title), ['sub-vid']);
});

test('enumerateSeasons: ordering is deterministic (re-call yields identical result)', () => {
  const c = makeCourse({
    categories: [
      { title: 'A', videos: [makeVideo({ title: 'v1' })] },
      { title: 'B', subcategories: [
        { title: 'B1', videos: [makeVideo({ title: 'v2' })] },
        { title: 'B2', videos: [makeVideo({ title: 'v3' })] },
      ]},
      { title: 'C', videos: [makeVideo({ title: 'v4' })] },
    ],
  });
  const s1 = enumerateSeasons(c);
  const s2 = enumerateSeasons(c);
  assert.deepEqual(s1.map(s => s.title), s2.map(s => s.title));
  assert.deepEqual(s1.map(s => s.title), ['A', 'B → B1', 'B → B2', 'C']);
});

// ── deriveOutputPath ──────────────────────────────────────────────────────────

test('deriveOutputPath: regular season path', () => {
  const c = makeCourse();
  const season = { seasonNumber: 1, title: 'Lessons', rawTitle: 'Lessons', isSpecials: false, videos: [] };
  const ep = { episodeNumber: 3, video: makeVideo({ title: 'Origin Story' }) };
  assert.equal(
    deriveOutputPath(ROOT, c, season, ep, 'webm'),
    '/tmp/maestro-root/Sing Like the Stars - Eric Vetro/Season 01/Sing Like the Stars - Eric Vetro - s01e03 - Origin Story.webm',
  );
});

test('deriveOutputPath: Specials season folder is "Specials" not "Season 00"', () => {
  const c = makeCourse();
  const season = { seasonNumber: 0, title: 'Specials', rawTitle: 'Specials', isSpecials: true, videos: [] };
  const ep = { episodeNumber: 1, video: makeVideo({ title: 'Consent' }) };
  assert.equal(
    deriveOutputPath(ROOT, c, season, ep, 'webm'),
    '/tmp/maestro-root/Sing Like the Stars - Eric Vetro/Specials/Sing Like the Stars - Eric Vetro - s00e01 - Consent.webm',
  );
});

test('deriveOutputPath: ext switches the suffix', () => {
  const c = makeCourse();
  const season = { seasonNumber: 1, title: 'Lessons', rawTitle: 'Lessons', isSpecials: false, videos: [] };
  const ep = { episodeNumber: 1, video: makeVideo({ title: 'X' }) };
  assert.match(deriveOutputPath(ROOT, c, season, ep, 'nfo'), /\.nfo$/);
  assert.match(deriveOutputPath(ROOT, c, season, ep, 'jpg'), /\.jpg$/);
});

test('showDirPath returns <root>/<showFolder>', () => {
  assert.equal(showDirPath(ROOT, makeCourse()), '/tmp/maestro-root/Sing Like the Stars - Eric Vetro');
});

test('seasonDirPath: regular season returns "Season NN"', () => {
  const season = { seasonNumber: 2, isSpecials: false };
  assert.equal(seasonDirPath(ROOT, makeCourse(), season), '/tmp/maestro-root/Sing Like the Stars - Eric Vetro/Season 02');
});

test('seasonDirPath: specials returns "Specials"', () => {
  const season = { seasonNumber: 0, isSpecials: true };
  assert.equal(seasonDirPath(ROOT, makeCourse(), season), '/tmp/maestro-root/Sing Like the Stars - Eric Vetro/Specials');
});

// ── legacy path ───────────────────────────────────────────────────────────────

test('legacyDeriveOutputPath: matches the existing on-disk shape', () => {
  // From actual ~/xfer/maestro layout: "<root>/courses/<slug>/videos/<cat>/<idx>-<title>.webm"
  assert.equal(
    legacyDeriveOutputPath('/x', 'eric-vetro/singing', 'Eric Vetro', 10, 'Articulation and diction'),
    '/x/courses/eric-vetro/singing/videos/Eric Vetro/10-Articulation and diction.webm',
  );
});

test('legacyDeriveOutputPath: applies legacy sanitization (colons → dashes, strip &)', () => {
  assert.equal(
    legacyDeriveOutputPath('/x', 'a/b', 'Tea & Cake: Recipes', 1, 'Chocolate: Death by'),
    '/x/courses/a/b/videos/Tea Cake- Recipes/1-Chocolate- Death by.webm',
  );
});

test('legacySanitizeFilenamePreAmpStrip preserves & (pre-fix rule)', () => {
  // Pre-fix rule didn't strip & — files downloaded before the &-strip commit
  // have & in their names.
  assert.equal(legacySanitizeFilenamePreAmpStrip('Tea & Cake'), 'Tea & Cake');
});

test('legacyDeriveOutputPathCandidates returns single path when title has no &', () => {
  const candidates = legacyDeriveOutputPathCandidates('/x', 'a/b', 'Cat', 1, 'Title');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], '/x/courses/a/b/videos/Cat/1-Title.webm');
});

test('legacyDeriveOutputPathCandidates returns two paths when title contains &', () => {
  const candidates = legacyDeriveOutputPathCandidates('/x', 'a/b', 'Cat', 1, 'Tea & Cake');
  assert.equal(candidates.length, 2);
  // First: current rule (strips &)
  assert.equal(candidates[0], '/x/courses/a/b/videos/Cat/1-Tea Cake.webm');
  // Second: pre-fix rule (preserves &)
  assert.equal(candidates[1], '/x/courses/a/b/videos/Cat/1-Tea & Cake.webm');
});

// Golden test: legacy path candidates must collectively match the recorded
// localPath for every completed video. Only runs when explicitly opted in
// via MAESTRO_GOLDEN_PATH_CHECK=1 so CI/clones without local data still pass.
test('legacyDeriveOutputPathCandidates: golden — at least one candidate matches recorded localPath for every completed video', { skip: !process.env.MAESTRO_GOLDEN_PATH_CHECK }, () => {
  const root = process.env.MAESTRO_ROOT?.trim() ?? join(homedir(), 'xfer', 'maestro');
  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) {
    assert.fail(`index.json not found at ${indexPath}`);
  }
  const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
  let checked = 0;
  let mismatches = [];
  for (const course of idx.courses ?? []) {
    for (const cat of course.categories ?? []) {
      for (const v of cat.videos ?? []) {
        if (!v.completed || !v.localPath) continue;
        const candidates = legacyDeriveOutputPathCandidates(root, course.slug, cat.title, v.index ?? v.bbcMaestroIndex, v.title);
        if (!candidates.includes(v.localPath)) {
          mismatches.push({ slug: course.slug, cat: cat.title, title: v.title, expected: v.localPath, got: candidates });
        }
        checked++;
      }
    }
  }
  assert.ok(checked >= 100, `expected to check at least 100 completed videos, got ${checked}`);
  assert.equal(mismatches.length, 0,
    `${mismatches.length} mismatch(es) out of ${checked}; sample: ${JSON.stringify(mismatches.slice(0, 3), null, 2)}`);
});
