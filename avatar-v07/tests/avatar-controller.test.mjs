import test from 'node:test';
import assert from 'node:assert/strict';
import { AvatarController } from '../src/avatar-controller.js';

function fakeRenderer() {
  const calls = [];
  return {
    calls,
    async mount(value) { calls.push(['mount', value]); },
    async loadCharacter(value) { calls.push(['loadCharacter', value]); },
    setState(value) { calls.push(['setState', value]); },
    setExpression(value) { calls.push(['setExpression', value]); },
    setLipSync(value) { calls.push(['setLipSync', value]); },
    setLookTarget(value) { calls.push(['setLookTarget', value]); },
    update(value) { calls.push(['update', value]); },
    async capture() { calls.push(['capture']); return new Blob(['ok']); },
    resize(...value) { calls.push(['resize', ...value]); },
    destroy() { calls.push(['destroy']); },
  };
}

test('forwards semantic commands through the renderer contract', async () => {
  const renderer = fakeRenderer();
  const controller = new AvatarController(renderer);
  await controller.mount({ id: 'surface' });
  await controller.loadCharacter({ id: 'formal-v1' });
  controller.setState('listen');
  controller.setExpression('focused');
  controller.setLipSync(0.5);
  controller.setLookTarget({ x: 0.2, y: 0.1 });
  controller.update(16);
  controller.resize(1600, 900, 2);
  await controller.capture();
  controller.destroy();
  assert.ok(renderer.calls.some((call) => call[0] === 'setState' && call[1] === 'listen'));
  assert.ok(renderer.calls.some((call) => call[0] === 'setExpression' && call[1] === 'focused'));
  assert.equal(renderer.calls.at(-1)[0], 'destroy');
});

test('normalizes invalid semantic values before forwarding', () => {
  const renderer = fakeRenderer();
  const controller = new AvatarController(renderer);
  controller.setState('invalid');
  controller.setExpression('invalid');
  assert.ok(renderer.calls.some((call) => call[0] === 'setState' && call[1] === 'idle'));
  assert.ok(renderer.calls.some((call) => call[0] === 'setExpression' && call[1] === 'neutral'));
});
