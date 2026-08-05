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

test('Studio provides browser speech controls without recording controls', async () => {
  const html = await source('index.html');
  for (const id of ['speech-text', 'speech-voice', 'speech-rate', 'speech-pitch', 'speech-volume', 'speech-play', 'speech-stop', 'speech-support']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /class="speech-panel"/);
  assert.match(html, /你好，很高兴见到你。今天想聊些什么？/);
  assert.doesNotMatch(html, /getUserMedia|MediaRecorder|麦克风|录音|声纹/i);
});

test('app supports routes, browser speech API, and renderer capabilities', async () => {
  const app = await source('src/app.js');
  for (const mode of ['studio', 'showcase', 'capture', 'compare']) {
    assert.match(app, new RegExp(`['\"]${mode}['\"]`));
  }
  assert.match(app, /BrowserSpeechEngine/);
  assert.match(app, /SpeechAvatarBridge/);
  assert.match(app, /getRendererCapabilities/);
  assert.match(app, /rendererKind:\s*['"]frame-blend['"]/);
  assert.match(app, /capabilities/);
  assert.match(app, /speech:/);
  assert.match(app, /speak\s*\(/);
  assert.match(app, /stopSpeaking\s*\(/);
  assert.match(app, /state\.time/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /new URL\(location\.href\)/);
  assert.doesNotMatch(app, /replaceState\([^\n]+location\.pathname/);
  assert.match(app, /timeline\.interact/);
  assert.match(app, /asset=background/);
  assert.match(app, /import\.meta\.url/);
  assert.match(app, /public\/frames\/formal-v1/);
  assert.doesNotMatch(app, /getUserMedia|MediaRecorder|audioinput|microphone|voiceprint/i);
});

test('showcase and capture hide all Studio speech controls', async () => {
  const css = await source('styles.css');
  assert.match(css, /mode-showcase[\s\S]*studio-panel[\s\S]*display:\s*none/);
  assert.match(css, /mode-capture[\s\S]*studio-panel[\s\S]*display:\s*none/);
  assert.match(css, /speech-panel/);
});

test('renderer factory isolates the default implementation', async () => {
  const factory = await source('src/renderer-factory.js');
  assert.match(factory, /frame-blend/);
  assert.match(factory, /new FrameBlendRenderer/);
  assert.match(factory, /unsupported avatar renderer/);
});
