import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { isRateLimitError } from '../lib/download.js';

test('isRateLimitError: returns true for HTTP 429 in stderr', () => {
  assert.equal(isRateLimitError('Server returned 429'), true);
});

test('isRateLimitError: returns true for HTTP 503 in stderr', () => {
  assert.equal(isRateLimitError('server returned 503'), true);
});

test('isRateLimitError: returns true for "too many requests" phrase', () => {
  assert.equal(isRateLimitError('HTTP error: too many requests'), true);
});

test('isRateLimitError: returns false for ordinary ffmpeg error', () => {
  assert.equal(isRateLimitError('No such file or directory'), false);
});

test('isRateLimitError: returns false for codec error', () => {
  assert.equal(isRateLimitError('Unknown encoder libsvtav1'), false);
});

test('isRateLimitError: returns false for empty string', () => {
  assert.equal(isRateLimitError(''), false);
});

test('isRateLimitError: returns false for 404 not found', () => {
  assert.equal(isRateLimitError('server returned 404'), false);
});

test('isRateLimitError: returns false for 500 internal server error', () => {
  assert.equal(isRateLimitError('server returned 500'), false);
});
