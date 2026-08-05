import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicClock } from '../src/deterministic-clock.js';

test('advances only when tick is called', () => {
  const clock = new DeterministicClock(1000);
  assert.equal(clock.now(), 1000);
  clock.tick(250);
  assert.equal(clock.now(), 1250);
});

test('can pause and reset deterministically', () => {
  const clock = new DeterministicClock(500);
  clock.pause();
  clock.tick(200);
  assert.equal(clock.now(), 500);
  clock.resume();
  clock.tick(100);
  assert.equal(clock.now(), 600);
  clock.reset(42);
  assert.equal(clock.now(), 42);
});
