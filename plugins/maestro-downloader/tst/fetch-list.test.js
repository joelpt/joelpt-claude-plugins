/**
 * Phase 1.5 scraper rewrite — fixture-driven golden tests.
 *
 * Background: see poc/04-phase-1.5-scraper-audit.md.
 * The post-fixture finding is that BBC Maestro course pages do NOT expose any
 * category structure for downloadable lessons. The "always emit a single
 * 'Lessons' category" fix is correct for every course in the catalogue.
 *
 * Each test feeds a captured fixture into parseCoursePageHtml() and asserts
 * the parsed shape matches what we know from the live page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoursePageHtml } from '../lib/fetch-list.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(slug) {
  const path = join(FIXTURES, slug.replace('/', '_') + '.post-render.html');
  return readFileSync(path, 'utf8');
}

function courseUrl(slug) {
  return `https://www.bbcmaestro.com/courses/${slug}`;
}

// Each entry: { slug, expectedLessonCount, expectedTitle }.
// Lesson counts come from the live `~/xfer/maestro/index.json` plus a manual
// count of unique `/lessons/<slug>` hrefs inside each captured fixture.
const TARGETS = [
  { slug: 'eric-vetro/singing', expectedLessonCount: 31, expectedTitle: 'Sing Like the Stars' },
  { slug: 'agatha-christie/writing', expectedLessonCount: 12, expectedTitle: 'Writing' },
  { slug: 'owen-o-kane/a-life-less-anxious', expectedLessonCount: 22, expectedTitle: 'A Life Less Anxious' },
  { slug: 'mark-ronson/music-production', expectedLessonCount: 18, expectedTitle: 'Music Production' },
  { slug: 'oliver-burkeman/time-management', expectedLessonCount: 22, expectedTitle: 'Time Management' },
];

for (const t of TARGETS) {
  test(`parseCoursePageHtml: ${t.slug} — flat single-category lessons`, () => {
    const html = loadFixture(t.slug);
    const result = parseCoursePageHtml(html, courseUrl(t.slug));

    assert.equal(result.slug, t.slug, 'slug should round-trip from courseUrl');
    assert.match(result.title, /\S/, 'title should be non-empty');
    assert.equal(result.categories.length, 1, 'every BBC Maestro course renders one flat lessons playlist');
    assert.equal(result.categories[0].title, 'Lessons');

    const links = result.categories[0].lessonLinks;
    assert.equal(links.length, t.expectedLessonCount, `expected ${t.expectedLessonCount} unique lessons`);

    for (const l of links) {
      assert.match(l.href, new RegExp(`^https?://[^/]+/courses/${t.slug}/lessons/`),
        `lesson href must be a this-course lesson, got: ${l.href}`);
      assert.match(l.text, /\S/, 'lesson text should be non-empty');
    }

    const hrefSet = new Set(links.map(l => l.href));
    assert.equal(hrefSet.size, links.length, 'lessons must be deduplicated by href');
  });
}

test('parseCoursePageHtml: returned shape matches scrapeCoursePage contract', () => {
  const html = loadFixture('agatha-christie/writing');
  const result = parseCoursePageHtml(html, courseUrl('agatha-christie/writing'));
  assert.deepEqual(Object.keys(result).sort(),
    ['categories', 'courseUrl', 'instructor', 'slug', 'title'],
    'must return exactly the five fields the downstream pipeline reads');
  assert.match(result.instructor, /\S/, 'instructor should be derived');
});

test('parseCoursePageHtml: instructor derived from slug — capitalized words', () => {
  const html = loadFixture('eric-vetro/singing');
  const result = parseCoursePageHtml(html, courseUrl('eric-vetro/singing'));
  assert.equal(result.instructor, 'Eric Vetro');
});
