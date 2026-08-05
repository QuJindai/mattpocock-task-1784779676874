export const DEFAULT_SPEECH_OPTIONS = Object.freeze({
  text: '',
  lang: 'zh-CN',
  voice: '',
  rate: 1,
  pitch: 1,
  volume: 1,
});

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeSpeechOptions(input = {}) {
  const text = String(input.text ?? '').trim();
  if (!text) throw new TypeError('Speech text is required');
  return {
    text,
    lang: String(input.lang ?? '').trim() || DEFAULT_SPEECH_OPTIONS.lang,
    voice: String(input.voice ?? '').trim(),
    rate: clampNumber(input.rate, DEFAULT_SPEECH_OPTIONS.rate, 0.6, 1.6),
    pitch: clampNumber(input.pitch, DEFAULT_SPEECH_OPTIONS.pitch, 0.7, 1.4),
    volume: clampNumber(input.volume, DEFAULT_SPEECH_OPTIONS.volume, 0, 1),
  };
}
