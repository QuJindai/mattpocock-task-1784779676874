import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechAvatarBridge } from '../src/speech-avatar-bridge.js';

function fakeController() {
  const calls = [];
  let state = 'listen';
  let expression = 'focused';
  let lipSync = 0;
  return {
    calls,
    setState(value) { state = value; calls.push(['state', value]); },
    setExpression(value) { expression = value; calls.push(['expression', value]); },
    setLipSync(value) { lipSync = value; calls.push(['lip', value]); },
    get diagnostics() { return { state, expression, lipSync }; },
  };
}

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    advance: (ms) => { time += ms; },
  };
}

test('speech start enters talk and end restores previous state', () => {
  const controller = fakeController();
  const clock = fakeClock();
  const bridge = new SpeechAvatarBridge(controller, { now: clock.now });
  bridge.handleStart();
  assert.equal(controller.diagnostics.state, 'talk');
  assert.equal(controller.diagnostics.expression, 'soft-smile');
  bridge.handleBoundary({ char: '啊', charIndex: 0 });
  assert.ok(controller.diagnostics.lipSync > 0.5);
  bridge.handleEnd();
  assert.deepEqual(controller.diagnostics, { state: 'listen', expression: 'focused', lipSync: 0 });
});

test('rapid boundary cues are queued and shown in order', () => {
  const controller = fakeController();
  const clock = fakeClock();
  const bridge = new SpeechAvatarBridge(controller, { now: clock.now, cueHoldMs: 260 });
  bridge.handleStart();

  clock.advance(120);
  bridge.handleBoundary({ char: '啊', charIndex: 0 });
  assert.equal(controller.diagnostics.lipSync, 0.88);

  clock.advance(80);
  bridge.handleBoundary({ char: '你', charIndex: 1 });
  clock.advance(80);
  bridge.handleBoundary({ char: '好', charIndex: 2 });
  assert.equal(bridge.diagnostics.queuedCues, 2);

  clock.advance(100);
  bridge.update();
  assert.equal(controller.diagnostics.lipSync, 0.52);
  clock.advance(260);
  bridge.update();
  assert.equal(controller.diagnostics.lipSync, 0.24);
  assert.equal(bridge.diagnostics.queuedCues, 0);
});

test('fallback mouth animation activates after a boundary gap', () => {
  const controller = fakeController();
  const clock = fakeClock();
  const bridge = new SpeechAvatarBridge(controller, { now: clock.now, boundaryTimeoutMs: 500 });
  bridge.handleStart();
  bridge.handleBoundary({ char: '你', charIndex: 0 });
  clock.advance(499);
  bridge.update();
  const before = controller.diagnostics.lipSync;
  clock.advance(2);
  bridge.update();
  assert.notEqual(controller.diagnostics.lipSync, before);
});

test('cancel and error both reset mouth, cue queue, and state', () => {
  for (const method of ['handleCancel', 'handleError']) {
    const controller = fakeController();
    const clock = fakeClock();
    const bridge = new SpeechAvatarBridge(controller, { now: clock.now });
    bridge.handleStart();
    bridge.handleBoundary({ char: '啊', charIndex: 0 });
    bridge.handleBoundary({ char: '你', charIndex: 1 });
    bridge[method]();
    assert.deepEqual(controller.diagnostics, { state: 'listen', expression: 'focused', lipSync: 0 });
    assert.equal(bridge.diagnostics.queuedCues, 0);
  }
});

test('bridge ignores updates while not speaking', () => {
  const controller = fakeController();
  const bridge = new SpeechAvatarBridge(controller, { now: () => 1000 });
  bridge.update();
  assert.equal(controller.calls.length, 0);
});
