import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function source(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('HTML provides one avatar surface and layered scene', async () => {
  const html = await source('index.html');
  assert.equal((html.match(/class="avatar-surface"/g) || []).length, 1);
  assert.match(html, /scene-background/);
  assert.match(html, /foreground-occlusion/);
  assert.match(html, /foreground-bokeh/);
  assert.match(html, /studio-panel/);
  assert.match(html, /type="importmap"/);
});

test('app supports studio showcase capture and compare routes', async () => {
  const app = await source('src/app.js');
  for (const mode of ['studio', 'showcase', 'capture', 'compare']) {
    assert.match(app, new RegExp(`['\"]${mode}['\"]`));
  }
  assert.match(app, /rendererKind:\s*['"]frame-blend['"]/);
  assert.match(app, /state\.time/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /timeline\.interact/);
  assert.match(app, /asset=background/);
});

test('showcase and capture hide studio controls through mode classes', async () => {
  const css = await source('styles.css');
  assert.match(css, /mode-showcase[\s\S]*studio-panel[\s\S]*display:\s*none/);
  assert.match(css, /mode-capture[\s\S]*studio-panel[\s\S]*display:\s*none/);
});

test('renderer factory isolates the default implementation', async () => {
  const factory = await source('src/renderer-factory.js');
  assert.match(factory, /frame-blend/);
  assert.match(factory, /new FrameBlendRenderer/);
  assert.match(factory, /unsupported avatar renderer/);
});
