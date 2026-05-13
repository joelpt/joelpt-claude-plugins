import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIndex, indexErrors, IndexValidationError } from '../lib/schema.js';

function makeVideo(overrides = {}) {
  return {
    bbcMaestroIndex: 1,
    title: 'Test video',
    lessonUrl: 'https://www.bbcmaestro.com/courses/foo/bar/lessons/baz',
    manifestUrl: 'https://videos.cdn.bbcmaestro.com/abc/HLS/master.m3u8',
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
    courseUrl: 'https://www.bbcmaestro.com/courses/eric-vetro/singing',
    subscribed: true,
    contentType: 'music',
    categories: [
      { title: 'Lessons', videos: [makeVideo()] },
    ],
    ...overrides,
  };
}

function makeIndex(overrides = {}) {
  return {
    schemaVersion: 2,
    lastFetched: '2026-05-13T01:05:20.000Z',
    courses: [makeCourse()],
    ...overrides,
  };
}

test('validateIndex accepts a minimal valid v2 index', () => {
  assert.doesNotThrow(() => validateIndex(makeIndex()));
});

test('validateIndex accepts a fully-populated course with all optional fields', () => {
  const idx = makeIndex({
    courses: [makeCourse({
      category: 'Music',
      description: 'A vocal coaching course.',
      posterUrl: 'https://cdn.bbcmaestro.com/posters/eric.jpg',
      fanartUrl: 'https://cdn.bbcmaestro.com/fanart/eric.jpg',
      instructorHeadshotUrl: 'https://cdn.bbcmaestro.com/headshots/eric.jpg',
    })],
  });
  assert.doesNotThrow(() => validateIndex(idx));
});

test('validateIndex accepts subcategory recursion (no videos at parent)', () => {
  const idx = makeIndex({
    courses: [makeCourse({
      categories: [
        {
          title: 'Vocal Exercises',
          subcategories: [
            { title: 'Breathing Fundamentals', videos: [makeVideo({ bbcMaestroIndex: 2 })] },
            { title: 'Articulation', videos: [makeVideo({ bbcMaestroIndex: 3 })] },
          ],
        },
      ],
    })],
  });
  assert.doesNotThrow(() => validateIndex(idx));
});

test('validateIndex rejects missing schemaVersion', () => {
  const idx = makeIndex();
  delete idx.schemaVersion;
  assert.throws(() => validateIndex(idx), IndexValidationError);
});

test('validateIndex rejects schemaVersion !== 2', () => {
  assert.throws(() => validateIndex(makeIndex({ schemaVersion: 1 })), IndexValidationError);
});

test('validateIndex rejects missing lastFetched', () => {
  const idx = makeIndex();
  delete idx.lastFetched;
  assert.throws(() => validateIndex(idx), IndexValidationError);
});

test('validateIndex rejects malformed lastFetched', () => {
  assert.throws(() => validateIndex(makeIndex({ lastFetched: 'yesterday' })), IndexValidationError);
});

test('validateIndex rejects course missing subscribed', () => {
  const c = makeCourse();
  delete c.subscribed;
  assert.throws(() => validateIndex(makeIndex({ courses: [c] })), IndexValidationError);
});

test('validateIndex rejects course missing contentType', () => {
  const c = makeCourse();
  delete c.contentType;
  assert.throws(() => validateIndex(makeIndex({ courses: [c] })), IndexValidationError);
});

test('validateIndex rejects unknown contentType value', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ contentType: 'bogus' })],
  })), IndexValidationError);
});

test('validateIndex accepts all live contentType values', () => {
  for (const ct of ['default', 'speech', 'music', 'visual', 'lean']) {
    assert.doesNotThrow(() => validateIndex(makeIndex({
      courses: [makeCourse({ contentType: ct })],
    })), `contentType=${ct} should validate`);
  }
});

test('validateIndex rejects bad slug pattern', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ slug: 'NoSlash' })],
  })), IndexValidationError);
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ slug: 'too/many/slashes' })],
  })), IndexValidationError);
});

test('validateIndex rejects unknown property on course', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [{ ...makeCourse(), bogus: 'no' }],
  })), IndexValidationError);
});

test('validateIndex rejects video missing required field (completed)', () => {
  const v = makeVideo();
  delete v.completed;
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })), IndexValidationError);
});

test('validateIndex rejects video missing localPath (must be null or string)', () => {
  const v = makeVideo();
  delete v.localPath;
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })), IndexValidationError);
});

test('validateIndex accepts completed video with non-null localPath + downloadedAt', () => {
  const v = makeVideo({
    completed: true,
    downloadedAt: '2026-05-10T14:37:34.478Z',
    localPath: '/Users/x/xfer/maestro/courses/eric/lesson.webm',
    actualResolution: '1080p',
  });
  assert.doesNotThrow(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })));
});

test('validateIndex rejects completed=true with null localPath (invariant)', () => {
  const v = makeVideo({ completed: true, downloadedAt: '2026-05-10T14:37:34.478Z', localPath: null });
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })), IndexValidationError);
});

test('validateIndex rejects completed=true with null downloadedAt (invariant)', () => {
  const v = makeVideo({ completed: true, downloadedAt: null, localPath: '/some/path.webm' });
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })), IndexValidationError);
});

test('validateIndex accepts incomplete video with null localPath + downloadedAt', () => {
  // Pre-download state: completed:false, both null. Must pass.
  const v = makeVideo({ completed: false, downloadedAt: null, localPath: null });
  assert.doesNotThrow(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'C', videos: [v] }] })],
  })));
});

test('validateIndex rejects category with both videos and subcategories', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({
      categories: [{
        title: 'C',
        videos: [makeVideo()],
        subcategories: [{ title: 'Sub', videos: [makeVideo({ bbcMaestroIndex: 2 })] }],
      }],
    })],
  })), IndexValidationError);
});

test('validateIndex rejects category with neither videos nor subcategories', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({ categories: [{ title: 'Empty' }] })],
  })), IndexValidationError);
});

test('validateIndex rejects bbcMaestroIndex < 1', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({
      categories: [{ title: 'C', videos: [makeVideo({ bbcMaestroIndex: 0 })] }],
    })],
  })), IndexValidationError);
});

test('validateIndex rejects malformed manifestUrl', () => {
  assert.throws(() => validateIndex(makeIndex({
    courses: [makeCourse({
      categories: [{ title: 'C', videos: [makeVideo({ manifestUrl: 'not-a-url' })] }],
    })],
  })), IndexValidationError);
});

test('IndexValidationError exposes the raw ajv errors array', () => {
  try {
    validateIndex(makeIndex({ schemaVersion: 1 }));
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof IndexValidationError);
    assert.ok(Array.isArray(e.errors));
    assert.ok(e.errors.length > 0);
  }
});

test('indexErrors returns null for valid input and array for invalid', () => {
  assert.equal(indexErrors(makeIndex()), null);
  const errs = indexErrors(makeIndex({ schemaVersion: 1 }));
  assert.ok(Array.isArray(errs));
  assert.ok(errs.length > 0);
});

test('error messages include the failing instancePath', () => {
  try {
    validateIndex(makeIndex({
      courses: [makeCourse({ contentType: 'bogus' })],
    }));
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /contentType/i, 'error message should reference contentType field');
  }
});
