import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createLogger } from '../lib/logger.js';

function mockStream() {
  const chunks = [];
  return {
    write: (chunk) => chunks.push(chunk),
    output: () => chunks.join(''),
  };
}

test('info: writes message to stdout with newline', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ out, err });
  log.info('hello world');
  assert.equal(out.output(), 'hello world\n');
  assert.equal(err.output(), '');
});

test('info: does not touch stderr', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ out, err });
  log.info('message');
  assert.equal(err.output(), '');
});

test('warn: writes to stderr with Warning: prefix and newline', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ out, err });
  log.warn('something went wrong');
  assert.equal(err.output(), 'Warning: something went wrong\n');
  assert.equal(out.output(), '');
});

test('error: writes to stderr with Error: prefix and newline', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ out, err });
  log.error('fatal failure');
  assert.equal(err.output(), 'Error: fatal failure\n');
  assert.equal(out.output(), '');
});

test('debug: suppressed when debugEnabled is false (default)', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ out, err });
  log.debug('should not appear');
  assert.equal(err.output(), '');
  assert.equal(out.output(), '');
});

test('debug: emits to stderr with [debug] prefix when debugEnabled is true', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ debugEnabled: true, out, err });
  log.debug('detailed trace');
  assert.equal(err.output(), '[debug] detailed trace\n');
  assert.equal(out.output(), '');
});

test('debug: suppressed when debugEnabled is explicitly false', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ debugEnabled: false, out, err });
  log.debug('hidden');
  assert.equal(err.output(), '');
});

test('multiple calls accumulate output in order', () => {
  const out = mockStream();
  const err = mockStream();
  const log = createLogger({ debugEnabled: true, out, err });
  log.info('step 1');
  log.warn('step 2');
  log.error('step 3');
  log.debug('step 4');
  assert.equal(out.output(), 'step 1\n');
  assert.equal(err.output(), 'Warning: step 2\nError: step 3\n[debug] step 4\n');
});
