import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { formatCourseList } from '../lib/list.js';

const makeVideo = (completed = false) => ({
  index: 1, title: 'L', lessonUrl: 'https://x/1', manifestUrl: 'https://cdn/1.m3u8',
  completed, downloadedAt: completed ? '2026-05-01T10:00:00Z' : null, localPath: completed ? '/d/1.webm' : null,
});

const courseA = {
  slug: 'alice/course-a',
  title: 'Course A',
  instructor: 'Alice',
  category: 'Writing',
  contentType: 'default',
  courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
  categories: [
    { title: 'Intro', videos: [makeVideo(true), makeVideo(false)] },
    { title: 'Advanced', videos: [makeVideo(false)] },
  ],
};

const courseB = {
  slug: 'bob/course-b',
  title: 'Course B',
  instructor: 'Bob',
  category: 'Cooking',
  contentType: 'visual',
  courseUrl: 'https://bbcmaestro.com/courses/bob/course-b',
  categories: [{ title: 'Only', videos: [makeVideo(true)] }],
};

const courseC = {
  slug: 'carol/course-c',
  title: 'Course C',
  instructor: 'Carol',
  category: 'Cooking',
  contentType: 'lean',
  courseUrl: 'https://bbcmaestro.com/courses/carol/course-c',
  categories: [{ title: 'Only', videos: [makeVideo(false)] }],
};

test('formatCourseList: renders table header with expected columns', () => {
  const output = formatCourseList([courseA]);
  assert.ok(output.includes('Category'), 'header: Category');
  assert.ok(output.includes('Title'), 'header: Title');
  assert.ok(output.includes('Author'), 'header: Author');
  assert.ok(output.includes('Type'), 'header: Type');
  assert.ok(output.includes('Lessons'), 'header: Lessons');
  assert.ok(output.includes('Done'), 'header: Done');
});

test('formatCourseList: row contains category, title, instructor, contentType, lesson count', () => {
  const output = formatCourseList([courseA]);
  assert.ok(output.includes('Writing'), 'should include category');
  assert.ok(output.includes('Course A'), 'should include title');
  assert.ok(output.includes('Alice'), 'should include instructor');
  assert.ok(output.includes('default'), 'should include contentType');
  assert.ok(output.includes('3'), 'should include total lesson count');
});

test('formatCourseList: shows No when not all videos completed', () => {
  const output = formatCourseList([courseA]);
  assert.ok(output.includes('No'), 'should show No for partial download');
});

test('formatCourseList: shows Yes when all videos completed', () => {
  const output = formatCourseList([courseB]);
  assert.ok(output.includes('Yes'), 'should show Yes for fully downloaded course');
});

test('formatCourseList: sorted by category then title within category', () => {
  const output = formatCourseList([courseA, courseB, courseC]);
  const cookingIdx = output.indexOf('Cooking');
  const writingIdx = output.indexOf('Writing');
  assert.ok(cookingIdx < writingIdx, 'Cooking should appear before Writing');
  const bIdx = output.indexOf('Course B');
  const cIdx = output.indexOf('Course C');
  assert.ok(bIdx < cIdx, 'Course B should appear before Course C within Cooking');
});

test('formatCourseList: returns empty string for empty course list', () => {
  const output = formatCourseList([]);
  assert.equal(output, '');
});

test('formatCourseList: does not include slug or bracket download counts', () => {
  const output = formatCourseList([courseA]);
  assert.ok(!output.includes('alice/course-a'), 'should not include slug');
  assert.ok(!output.includes('['), 'should not include old bracket format');
});
