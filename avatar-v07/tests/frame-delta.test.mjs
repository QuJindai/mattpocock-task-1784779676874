import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFrameDelta } from '../src/frame-delta.js';

test('keeps timeline time while limiting visual interpolation', () => {
  assert.deepEqual(splitFrameDelta(240), {
    timelineDeltaMs: 240,
    rendererDeltaMs: 50,
  });
});

test('caps pathological stalls without slowing ordinary low frame rates', () => {
  assert.deepEqual(splitFrameDelta(1500), {
    timelineDeltaMs: 1000,
    rendererDeltaMs: 50,
  });
  assert.deepEqual(splitFrameDelta(-10), {
    timelineDeltaMs: 0,
    rendererDeltaMs: 0,
  });
});
