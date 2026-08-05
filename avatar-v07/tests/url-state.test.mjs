import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_URL_STATE, parseUrlState, serializeUrlState } from '../src/url-state.js';

test('restores supported values and clamps numbers', () => {
  const state = parseUrlState('?state=talk&expression=happy&autoplay=0&scale=9&x=-2000');
  assert.deepEqual(state, {
    renderer: 'frame-blend',
    character: 'formal-v1',
    state: 'talk',
    expression: 'happy',
    autoplay: false,
    scale: 1.5,
    x: -320,
    y: 18,
    warmth: 0.18,
    blur: 1.2,
    parallax: 10,
    exposure: 1,
    time: null,
  });
});

test('ignores unknown values and round-trips defaults', () => {
  const parsed = parseUrlState('?renderer=unknown&state=bad&expression=bad&extra=nope');
  assert.deepEqual(parsed, DEFAULT_URL_STATE);
  assert.deepEqual(parseUrlState(`?${serializeUrlState(parsed)}`), DEFAULT_URL_STATE);
});

test('restores fixed capture time', () => {
  assert.equal(parseUrlState('?time=1250').time, 1250);
  assert.equal(parseUrlState('?time=-5').time, 0);
});
