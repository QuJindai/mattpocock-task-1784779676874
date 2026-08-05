import test from 'node:test';
import assert from 'node:assert/strict';
import { ShowcaseTimeline } from '../src/showcase-timeline.js';

function fakeController({ throwOn } = {}) {
  const states = [];
  const lipValues = [];
  return {
    states,
    lipValues,
    setState(value) {
      if (value === throwOn) throw new Error('renderer failed');
      states.push(value);
    },
    setExpression() {},
    setLipSync(value) { lipValues.push(value); },
  };
}

test('autoplay covers idle happy listen and talk within 30 seconds', () => {
  const controller = fakeController();
  const timeline = new ShowcaseTimeline(controller, { autoplay: true });
  for (let elapsed = 0; elapsed < 30_000; elapsed += 250) timeline.tick(250);
  const states = new Set(controller.states);
  assert.deepEqual([...states].sort(), ['happy', 'idle', 'listen', 'talk'].sort());
  assert.ok(controller.lipValues.some((value) => value > 0.5));
});

test('interaction pauses the phase clock for exactly five seconds', () => {
  const controller = fakeController();
  const timeline = new ShowcaseTimeline(controller, { autoplay: true });
  timeline.tick(1000);
  const before = timeline.diagnostics.phaseElapsedMs;
  timeline.interact();
  timeline.tick(4999);
  assert.equal(timeline.diagnostics.phaseElapsedMs, before);
  assert.equal(timeline.diagnostics.pauseRemainingMs, 1);
  timeline.tick(1);
  assert.equal(timeline.diagnostics.phaseElapsedMs, before);
  timeline.tick(1);
  assert.equal(timeline.diagnostics.phaseElapsedMs, before + 1);
});

test('timeline falls back to idle and disables autoplay on controller failure', () => {
  const controller = fakeController({ throwOn: 'happy' });
  const timeline = new ShowcaseTimeline(controller, { autoplay: true });
  timeline.tick(8001);
  assert.equal(timeline.diagnostics.autoplay, false);
  assert.equal(timeline.diagnostics.phase, 'idle');
});
