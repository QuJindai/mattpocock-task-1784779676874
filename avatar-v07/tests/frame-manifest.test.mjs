import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '../public/frames/formal-v1/manifest.json');
const required = [
  'idle-open', 'blink-half', 'blink-closed', 'happy',
  'listen', 'mouth-a', 'mouth-e', 'mouth-u',
];

test('frame manifest contains distinct alpha-preserving semantic frames', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.characterId, 'formal-v1');
  assert.ok(manifest.width >= 512);
  assert.ok(manifest.height >= 512);
  assert.match(manifest.sourceSha256, /^[a-f0-9]{64}$/);
  for (const id of required) {
    const frame = manifest.frames[id];
    assert.ok(frame, `missing frame ${id}`);
    assert.equal(frame.width, manifest.width);
    assert.equal(frame.height, manifest.height);
    assert.equal(frame.hasAlpha, true);
    assert.match(frame.sha256, /^[a-f0-9]{64}$/);
    assert.ok(frame.bytes > 10_000);
  }
  assert.notEqual(manifest.frames['idle-open'].sha256, manifest.frames['blink-closed'].sha256);
  assert.notEqual(manifest.frames['idle-open'].sha256, manifest.frames['mouth-a'].sha256);
  assert.notEqual(manifest.frames['mouth-a'].sha256, manifest.frames['mouth-e'].sha256);
});
