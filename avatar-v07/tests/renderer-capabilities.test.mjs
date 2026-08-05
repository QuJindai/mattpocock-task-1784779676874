import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_BLEND_CAPABILITIES, getRendererCapabilities } from '../src/renderer-capabilities.js';

test('frame blend renderer declares speech and lip sync capabilities', () => {
  assert.deepEqual(FRAME_BLEND_CAPABILITIES, {
    renderer: 'frame-blend',
    speech: true,
    lipSync: 'amplitude',
    expressions: true,
    lookTarget: true,
    capture: true,
  });
  assert.equal(getRendererCapabilities('frame-blend'), FRAME_BLEND_CAPABILITIES);
});

test('unknown renderers return a safe minimal capability set', () => {
  assert.deepEqual(getRendererCapabilities('unknown'), {
    renderer: 'unknown', speech: false, lipSync: 'none', expressions: false, lookTarget: false, capture: false,
  });
});
