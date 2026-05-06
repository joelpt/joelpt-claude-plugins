import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { isRateLimitError, isNetworkError } from '../lib/download.js';

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

// ── isNetworkError ───────────────────────────────────────────────────────────

test('isNetworkError: returns true for Operation timed out', () => {
  assert.equal(isNetworkError('Operation timed out'), true);
});

test('isNetworkError: returns true for Connection timed out', () => {
  assert.equal(isNetworkError('Connection timed out'), true);
});

test('isNetworkError: returns true for Connection reset by peer', () => {
  assert.equal(isNetworkError('Connection reset by peer'), true);
});

test('isNetworkError: returns true for Connection refused', () => {
  assert.equal(isNetworkError('Connection refused'), true);
});

test('isNetworkError: returns true for Broken pipe', () => {
  assert.equal(isNetworkError('Broken pipe'), true);
});

test('isNetworkError: returns false for 404 not found', () => {
  assert.equal(isNetworkError('server returned 404'), false);
});

test('isNetworkError: returns false for codec error', () => {
  assert.equal(isNetworkError('Unknown encoder libsvtav1'), false);
});

test('isNetworkError: returns false for empty string', () => {
  assert.equal(isNetworkError(''), false);
});
