import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { formatCourseList } from '../lib/list.js';

const baseCourse = {
  slug: 'alice/course-a',
  title: 'Course A',
  instructor: 'Alice',
  courseUrl: 'https://bbcmaestro.com/courses/alice/course-a',
  categories: [
    {
      title: 'Intro',
      videos: [
        { index: 1, title: 'Lesson 1', lessonUrl: 'https://x/1', manifestUrl: 'https://cdn/1.m3u8', completed: true, downloadedAt: '2026-05-01T10:00:00Z', localPath: '/d/1.webm' },
        { index: 2, title: 'Lesson 2', lessonUrl: 'https://x/2', manifestUrl: 'https://cdn/2.m3u8', completed: false, downloadedAt: null, localPath: null },
      ],
    },
    {
      title: 'Advanced',
      videos: [
        { index: 3, title: 'Lesson 3', lessonUrl: 'https://x/3', manifestUrl: 'https://cdn/3.m3u8', completed: false, downloadedAt: null, localPath: null },
      ],
    },
  ],
};

test('formatCourseList: includes course title and instructor', () => {
  const output = formatCourseList([baseCourse]);
  assert.ok(output.includes('Course A'), 'should include course title');
  assert.ok(output.includes('Alice'), 'should include instructor name');
});

test('formatCourseList: shows correct total and completed video counts', () => {
  const output = formatCourseList([baseCourse]);
  assert.ok(output.includes('[1/3 downloaded]'), 'should show 1 of 3 downloaded');
});

test('formatCourseList: shows per-category completion breakdown', () => {
  const output = formatCourseList([baseCourse]);
  assert.ok(output.includes('Intro: 1/2 videos'), 'Intro should show 1/2');
  assert.ok(output.includes('Advanced: 0/1 videos'), 'Advanced should show 0/1');
});

test('formatCourseList: includes course slug', () => {
  const output = formatCourseList([baseCourse]);
  assert.ok(output.includes('alice/course-a'), 'should include slug');
});

test('formatCourseList: handles all-completed course', () => {
  const allDone = {
    ...baseCourse,
    categories: [
      {
        title: 'Intro',
        videos: [
          { index: 1, title: 'L1', lessonUrl: 'https://x/1', manifestUrl: 'https://cdn/1.m3u8', completed: true, downloadedAt: '2026-05-01T10:00:00Z', localPath: '/d/1.webm' },
        ],
      },
    ],
  };
  const output = formatCourseList([allDone]);
  assert.ok(output.includes('[1/1 downloaded]'), 'should show 1/1 downloaded');
});

test('formatCourseList: returns empty string for empty course list', () => {
  const output = formatCourseList([]);
  assert.equal(output, '');
});
