import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAvatarRenderer } from '../src/avatar-renderer.js';
import { normalizeRendererState } from '../src/avatar-types.js';

const methods = [
  'mount', 'loadCharacter', 'setState', 'setExpression', 'setLipSync',
  'setLookTarget', 'update', 'capture', 'resize', 'destroy',
];

test('rejects a renderer missing contract methods', () => {
  assert.throws(() => assertAvatarRenderer({ mount() {} }), /loadCharacter/);
});

test('accepts a complete renderer', () => {
  const renderer = Object.fromEntries(methods.map((name) => [name, () => {}]));
  assert.equal(assertAvatarRenderer(renderer), renderer);
});

test('normalizes unknown semantic values', () => {
  assert.deepEqual(normalizeRendererState({ state: 'bad', expression: 'bad' }), {
    state: 'idle', expression: 'neutral',
  });
});
