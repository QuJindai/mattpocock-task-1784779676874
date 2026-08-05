import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlinkSequence, buildTalkSequence, frameAtTime } from '../src/frame-sequence.js';

test('blink sequence is open-half-closed-half-open', () => {
  assert.deepEqual(buildBlinkSequence().map((item) => item.frame), [
    'idle-open', 'blink-half', 'blink-closed', 'blink-half', 'idle-open',
  ]);
});

test('talk sequence uses at least three mouth frames', () => {
  const frames = new Set(buildTalkSequence().map((item) => item.frame));
  assert.ok(frames.has('mouth-a'));
  assert.ok(frames.has('mouth-e'));
  assert.ok(frames.has('mouth-u'));
});

test('frameAtTime loops deterministically', () => {
  const sequence = [{ frame: 'a', durationMs: 100 }, { frame: 'b', durationMs: 200 }];
  assert.equal(frameAtTime(sequence, 50), 'a');
  assert.equal(frameAtTime(sequence, 150), 'b');
  assert.equal(frameAtTime(sequence, 350), 'a');
});
