import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTvShowNfo, renderSeasonNfo, renderEpisodeNfo } from '../lib/nfo.js';

function makeVideo(o = {}) {
  return {
    bbcMaestroIndex: 1,
    title: 'Origin Story',
    lessonUrl: 'https://example/lesson',
    manifestUrl: 'https://example/manifest.m3u8',
    completed: true,
    downloadedAt: '2026-05-10T14:37:34.478Z',
    localPath: '/x/y.webm',
    ...o,
  };
}

function makeCourse(o = {}) {
  return {
    slug: 'eric-vetro/singing',
    title: 'Sing Like the Stars',
    instructor: 'Eric Vetro',
    courseUrl: 'https://example/course',
    subscribed: true,
    contentType: 'music',
    categories: [],
    ...o,
  };
}

function makeSeason(o = {}) {
  return { seasonNumber: 1, title: 'Lessons', rawTitle: 'Lessons', isSpecials: false, videos: [], ...o };
}

// ── tvshow.nfo ────────────────────────────────────────────────────────────────

test('renderTvShowNfo: well-formed XML with required Plex tags', () => {
  const xml = renderTvShowNfo(makeCourse(), [makeSeason()]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<tvshow>/);
  assert.match(xml, /<title>Sing Like the Stars<\/title>/);
  assert.match(xml, /<studio>BBC Maestro<\/studio>/);
  assert.match(xml, /<\/tvshow>/);
});

test('renderTvShowNfo: emits one <namedseason> per season with correct number+title', () => {
  const seasons = [
    { seasonNumber: 1, title: 'Lessons', rawTitle: 'Lessons', isSpecials: false, videos: [] },
    { seasonNumber: 2, title: 'Vocal Exercises → Breathing Fundamentals', rawTitle: 'Breathing Fundamentals', isSpecials: false, videos: [] },
  ];
  const xml = renderTvShowNfo(makeCourse(), seasons);
  assert.match(xml, /<namedseason number="1">Lessons<\/namedseason>/);
  assert.match(xml, /<namedseason number="2">Vocal Exercises → Breathing Fundamentals<\/namedseason>/);
});

test('renderTvShowNfo: emits stable course uniqueid as default', () => {
  const xml = renderTvShowNfo(makeCourse(), []);
  assert.match(xml, /<uniqueid type="bbcmaestro" default="true">eric-vetro\/singing<\/uniqueid>/);
});

test('renderTvShowNfo: emits actor with role, name, and headshot thumb when present', () => {
  const xml = renderTvShowNfo(makeCourse({ instructorHeadshotUrl: 'https://cdn/eric.jpg' }), []);
  assert.match(xml, /<actor>[\s\S]*<name>Eric Vetro<\/name>[\s\S]*<role>Instructor<\/role>[\s\S]*<thumb>https:\/\/cdn\/eric.jpg<\/thumb>[\s\S]*<\/actor>/);
});

test('renderTvShowNfo: emits <plot> when description is present, omits when absent', () => {
  const without = renderTvShowNfo(makeCourse(), []);
  assert.doesNotMatch(without, /<plot>/);
  const withDesc = renderTvShowNfo(makeCourse({ description: 'Vocal coaching course.' }), []);
  assert.match(withDesc, /<plot>Vocal coaching course.<\/plot>/);
});

test('renderTvShowNfo: maps course.category to a single <genre>', () => {
  const xml = renderTvShowNfo(makeCourse({ category: 'Music' }), []);
  assert.match(xml, /<genre>Music<\/genre>/);
});

test('renderTvShowNfo: escapes special chars in titles and descriptions', () => {
  const xml = renderTvShowNfo(makeCourse({
    title: 'Cooking & Eating <on a budget>',
    description: 'A & B "C" \'D\' <E>',
  }), []);
  assert.match(xml, /Cooking &amp; Eating &lt;on a budget&gt;/);
  assert.match(xml, /A &amp; B "C" 'D' &lt;E&gt;/);
});

// ── season.nfo ────────────────────────────────────────────────────────────────

test('renderSeasonNfo: emits <title> only, NEVER <seasonnumber>', () => {
  // Jellyfin issue #11656/#11709: <seasonnumber> in season.nfo causes rescan
  // to overwrite the season title back to "Season N". Critical regression guard.
  const xml = renderSeasonNfo(makeSeason());
  assert.match(xml, /<season>[\s\S]*<title>Lessons<\/title>[\s\S]*<\/season>/);
  assert.doesNotMatch(xml, /<seasonnumber>/, 'season.nfo must NOT emit <seasonnumber>');
});

test('renderSeasonNfo: emits <plot> when provided', () => {
  const xml = renderSeasonNfo({ ...makeSeason(), plot: 'Introductory vocal lessons.' });
  assert.match(xml, /<plot>Introductory vocal lessons.<\/plot>/);
});

test('renderSeasonNfo: escapes special chars in title', () => {
  const xml = renderSeasonNfo({ ...makeSeason(), title: 'Vocal Exercises → Power & Range' });
  assert.match(xml, /<title>Vocal Exercises → Power &amp; Range<\/title>/);
});

// ── episode.nfo ───────────────────────────────────────────────────────────────

test('renderEpisodeNfo: well-formed XML with required tags', () => {
  const xml = renderEpisodeNfo(makeCourse(), makeSeason(), { episodeNumber: 1, video: makeVideo() });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<episodedetails>/);
  assert.match(xml, /<title>Origin Story<\/title>/);
  assert.match(xml, /<season>1<\/season>/);
  assert.match(xml, /<episode>1<\/episode>/);
  assert.match(xml, /<studio>BBC Maestro<\/studio>/);
});

test('renderEpisodeNfo: emits stable uniqueid <slug>/sNNeMM (no default attribute)', () => {
  const xml = renderEpisodeNfo(makeCourse(), makeSeason({ seasonNumber: 2 }), {
    episodeNumber: 7, video: makeVideo({ title: 'X' }),
  });
  // Without `default="true"` (only tvshow.nfo's uniqueid is default).
  assert.match(xml, /<uniqueid type="bbcmaestro">eric-vetro\/singing\/s02e07<\/uniqueid>/);
});

test('renderEpisodeNfo: handles Specials season (s00)', () => {
  const xml = renderEpisodeNfo(makeCourse(), { seasonNumber: 0, title: 'Specials', isSpecials: true }, {
    episodeNumber: 3, video: makeVideo({ title: 'Trailer' }),
  });
  assert.match(xml, /<season>0<\/season>/);
  assert.match(xml, /<episode>3<\/episode>/);
  assert.match(xml, /eric-vetro\/singing\/s00e03/);
});

test('renderEpisodeNfo: emits <aired> from downloadedAt when valid date', () => {
  const xml = renderEpisodeNfo(makeCourse(), makeSeason(), { episodeNumber: 1, video: makeVideo({ downloadedAt: '2026-05-10T14:37:34.478Z' }) });
  assert.match(xml, /<aired>2026-05-10<\/aired>/);
});

test('renderEpisodeNfo: omits <aired> when downloadedAt is null', () => {
  const xml = renderEpisodeNfo(makeCourse(), makeSeason(), { episodeNumber: 1, video: makeVideo({ downloadedAt: null }) });
  assert.doesNotMatch(xml, /<aired>/);
});

test('renderEpisodeNfo: escapes special chars in title and description', () => {
  const xml = renderEpisodeNfo(makeCourse(), makeSeason(), {
    episodeNumber: 1,
    video: makeVideo({ title: 'A & B <special>', description: 'Plot with " quotes & ampersand' }),
  });
  assert.match(xml, /A &amp; B &lt;special&gt;/);
  assert.match(xml, /Plot with " quotes &amp; ampersand/);
});

test('renderEpisodeNfo: same season/episode produces identical uniqueid (stability check)', () => {
  const c = makeCourse();
  const s = makeSeason({ seasonNumber: 3 });
  const e = { episodeNumber: 5, video: makeVideo({ title: 'Diff title' }) };
  const xml1 = renderEpisodeNfo(c, s, e);
  const xml2 = renderEpisodeNfo(c, s, { ...e, video: makeVideo({ title: 'Different title text' }) });
  const uid1 = xml1.match(/<uniqueid[^>]*>([^<]+)<\/uniqueid>/)[1];
  const uid2 = xml2.match(/<uniqueid[^>]*>([^<]+)<\/uniqueid>/)[1];
  assert.equal(uid1, uid2, 'uniqueid must be stable across title changes for same slug+season+episode');
  assert.equal(uid1, 'eric-vetro/singing/s03e05');
});
