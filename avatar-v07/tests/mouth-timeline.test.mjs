import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackMouthValue, mouthValueForBoundary } from '../src/mouth-timeline.js';

test('fallback mouth timeline repeats three distinct values every 540ms', () => {
  const values = [0, 180, 360, 540].map((time) => fallbackMouthValue(time));
  assert.deepEqual(values.slice(0, 3), [0.82, 0.5, 0.2]);
  assert.equal(values[3], values[0]);
});

test('boundary mapping differentiates punctuation vowels and ordinary characters', () => {
  const punctuation = mouthValueForBoundary({ char: '，', charIndex: 1 }, 0);
  const vowel = mouthValueForBoundary({ char: '啊', charIndex: 2 }, 1);
  const ordinary = mouthValueForBoundary({ char: '你', charIndex: 3 }, 2);
  assert.equal(punctuation, 0.05);
  assert.ok(vowel > ordinary);
  assert.ok(ordinary > 0.1);
});
