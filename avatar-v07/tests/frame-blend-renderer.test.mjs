import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBlendRenderer } from '../src/frame-blend-renderer.js';
import { assertAvatarRenderer } from '../src/avatar-renderer.js';

function createFakeAdapter() {
  const events = [];
  const view = {
    async preload(frames) { events.push(['preload', Object.keys(frames)]); },
    setFrame(layer, frame) { events.push(['setFrame', layer, frame]); },
    setOpacity(layer, value) { events.push(['setOpacity', layer, value]); },
    setTransform(value) { events.push(['setTransform', value]); },
    async capture() { events.push(['capture']); return new Blob(['image'], { type: 'image/png' }); },
    resize(width, height, dpr) { events.push(['resize', width, height, dpr]); },
    destroy() { events.push(['destroy']); },
  };
  return {
    events,
    async mount(surface) { events.push(['mount', surface]); return view; },
  };
}

const character = {
  id: 'formal-v1',
  frames: Object.fromEntries([
    'idle-open', 'blink-half', 'blink-closed', 'happy',
    'listen', 'mouth-a', 'mouth-e', 'mouth-u',
  ].map((id) => [id, `/frames/${id}.webp`])),
};

test('implements the renderer contract and lifecycle', async () => {
  const adapter = createFakeAdapter();
  const renderer = assertAvatarRenderer(new FrameBlendRenderer({ adapter }));
  await renderer.mount({ nodeName: 'SURFACE' });
  await renderer.loadCharacter(character);
  renderer.setState('happy');
  renderer.setExpression('happy');
  renderer.setLipSync(0.8);
  renderer.setLookTarget({ x: 0.2, y: -0.1 });
  renderer.update(200);
  renderer.resize(1600, 900, 2);
  const blob = await renderer.capture();
  renderer.destroy();
  assert.equal(blob.type, 'image/png');
  assert.ok(adapter.events.some((event) => event[0] === 'setFrame' && event[2] === '/frames/happy.webp'));
  assert.ok(adapter.events.some((event) => event[0] === 'setTransform'));
  assert.equal(adapter.events.at(-1)[0], 'destroy');
});

test('talk state selects mouth frames from lip sync', async () => {
  const adapter = createFakeAdapter();
  const renderer = new FrameBlendRenderer({ adapter, transitionMs: 0 });
  await renderer.mount({});
  await renderer.loadCharacter(character);
  renderer.setState('talk');
  renderer.setLipSync(0.9);
  renderer.update(16);
  assert.ok(adapter.events.some((event) => event[0] === 'setFrame' && /mouth-a/.test(event[2])));
});

test('default renderer completes all rapid talk-frame transitions', async () => {
  const adapter = createFakeAdapter();
  const renderer = new FrameBlendRenderer({ adapter });
  await renderer.mount({});
  await renderer.loadCharacter(character);
  renderer.setState('listen');
  renderer.update(200);
  renderer.setState('talk');
  const completed = new Set();
  for (let index = 0; index < 24; index += 1) {
    renderer.update(70);
    completed.add(renderer.diagnostics.currentFrame);
  }
  assert.ok(completed.has('mouth-a'), `missing mouth-a: ${[...completed].join(',')}`);
  assert.ok(completed.has('mouth-e'), `missing mouth-e: ${[...completed].join(',')}`);
  assert.ok(completed.has('mouth-u'), `missing mouth-u: ${[...completed].join(',')}`);
});
