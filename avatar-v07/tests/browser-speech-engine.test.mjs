import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeechEngine } from '../src/browser-speech-engine.js';

function createFakeAdapter({ supported = true } = {}) {
  const listeners = new Map();
  const utterances = [];
  const synthesis = supported ? {
    speaking: false,
    pending: false,
    cancelled: 0,
    voices: [
      { name: 'Chinese Local', lang: 'zh-CN', voiceURI: 'zh-local', localService: true, default: true },
      { name: 'English', lang: 'en-US', voiceURI: 'en', localService: true, default: false },
    ],
    getVoices() { return this.voices; },
    speak(utterance) { this.speaking = true; utterances.push(utterance); },
    cancel() { this.cancelled += 1; this.speaking = false; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  } : null;

  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.voice = null;
      this.onstart = null;
      this.onboundary = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  return {
    speechSynthesis: synthesis,
    Utterance: supported ? FakeUtterance : null,
    utterances,
    emitVoicesChanged() { listeners.get('voiceschanged')?.(); },
    dispatch(index, type, payload = {}) {
      const utterance = utterances[index];
      utterance?.[`on${type}`]?.({ type, ...payload });
    },
  };
}

test('reports unsupported environments without throwing during construction', () => {
  const engine = new BrowserSpeechEngine(createFakeAdapter({ supported: false }));
  assert.equal(engine.supported, false);
  assert.deepEqual(engine.voices, []);
  assert.rejects(() => engine.speak('你好'), /not supported/i);
});

test('enumerates voices and applies normalized utterance settings', async () => {
  const adapter = createFakeAdapter();
  const engine = new BrowserSpeechEngine(adapter);
  assert.equal(engine.voices.length, 2);
  const promise = engine.speak('你好', { voice: 'zh-local', rate: 1.2, pitch: 1.1, volume: 0.8 });
  assert.equal(adapter.utterances.length, 1);
  const utterance = adapter.utterances[0];
  assert.equal(utterance.text, '你好');
  assert.equal(utterance.voice.voiceURI, 'zh-local');
  assert.equal(utterance.rate, 1.2);
  assert.equal(utterance.pitch, 1.1);
  assert.equal(utterance.volume, 0.8);
  adapter.dispatch(0, 'start');
  adapter.dispatch(0, 'boundary', { charIndex: 1, name: 'word' });
  adapter.dispatch(0, 'end');
  assert.deepEqual(await promise, { status: 'completed' });
  assert.equal(engine.speaking, false);
});

test('starting new speech cancels and resolves the previous request', async () => {
  const adapter = createFakeAdapter();
  const engine = new BrowserSpeechEngine(adapter);
  const first = engine.speak('第一段');
  const second = engine.speak('第二段');
  assert.equal(adapter.speechSynthesis.cancelled, 1);
  assert.deepEqual(await first, { status: 'cancelled' });
  adapter.dispatch(1, 'end');
  assert.deepEqual(await second, { status: 'completed' });
});

test('stop cancels active speech and settles it exactly once', async () => {
  const adapter = createFakeAdapter();
  const engine = new BrowserSpeechEngine(adapter);
  const result = engine.speak('停止测试');
  engine.stop();
  engine.stop();
  assert.deepEqual(await result, { status: 'cancelled' });
  assert.equal(adapter.speechSynthesis.cancelled, 1);
});

test('speech errors reject with a descriptive error', async () => {
  const adapter = createFakeAdapter();
  const engine = new BrowserSpeechEngine(adapter);
  const result = engine.speak('错误测试');
  adapter.dispatch(0, 'error', { error: 'voice-unavailable' });
  await assert.rejects(result, /voice-unavailable/);
  assert.equal(engine.speaking, false);
});

test('destroy removes listeners and cancels active speech', async () => {
  const adapter = createFakeAdapter();
  const engine = new BrowserSpeechEngine(adapter);
  const result = engine.speak('销毁测试');
  engine.destroy();
  assert.deepEqual(await result, { status: 'cancelled' });
  assert.equal(engine.diagnostics.destroyed, true);
});
