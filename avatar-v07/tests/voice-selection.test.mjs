import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPEECH_OPTIONS,
  normalizeSpeechOptions,
} from '../src/speech-types.js';
import {
  describeVoice,
  selectVoice,
  voiceId,
} from '../src/voice-selection.js';

const voices = [
  { name: 'English Default', lang: 'en-US', voiceURI: 'en-default', default: true, localService: true },
  { name: 'Mandarin Remote', lang: 'zh-TW', voiceURI: 'zh-remote', default: false, localService: false },
  { name: 'Chinese Local', lang: 'zh-CN', voiceURI: 'zh-local', default: false, localService: true },
];

test('normalizes and clamps browser speech options', () => {
  assert.deepEqual(normalizeSpeechOptions({
    text: '  你好  ', rate: 9, pitch: 0.1, volume: -1, lang: '', voice: ' zh-local ',
  }), {
    ...DEFAULT_SPEECH_OPTIONS,
    text: '你好',
    rate: 1.6,
    pitch: 0.7,
    volume: 0,
    voice: 'zh-local',
  });
});

test('rejects empty text', () => {
  assert.throws(() => normalizeSpeechOptions({ text: '   ' }), /text/i);
});

test('uses stable voice identifiers and serializable descriptions', () => {
  assert.equal(voiceId(voices[2]), 'zh-local');
  assert.equal(voiceId({ name: 'Fallback', lang: 'zh-CN' }), 'Fallback|zh-CN');
  assert.deepEqual(describeVoice(voices[2]), {
    id: 'zh-local', name: 'Chinese Local', lang: 'zh-CN', localService: true, default: false,
  });
});

test('voice selection follows explicit-local-chinese-default-first priority', () => {
  assert.equal(selectVoice(voices, 'zh-remote', 'zh-CN')?.voiceURI, 'zh-remote');
  assert.equal(selectVoice(voices, '', 'zh-CN')?.voiceURI, 'zh-local');
  assert.equal(selectVoice(voices.slice(0, 2), '', 'zh-CN')?.voiceURI, 'zh-remote');
  assert.equal(selectVoice([voices[0]], '', 'zh-CN')?.voiceURI, 'en-default');
  assert.equal(selectVoice([{ name: 'Only', lang: 'fr-FR' }], '', 'zh-CN')?.name, 'Only');
});
