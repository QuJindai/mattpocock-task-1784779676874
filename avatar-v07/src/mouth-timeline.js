const FALLBACK_VALUES = Object.freeze([0.82, 0.5, 0.2]);
const PUNCTUATION = /[，。！？、；：,.!?;:\s]/u;
const OPEN_VOWELS = /[aeiouAEIOU啊阿呵哈哦喔噢额鹅诶欸嗯恩]/u;
const ORDINARY_VALUES = Object.freeze([0.32, 0.52, 0.24]);

export function fallbackMouthValue(elapsedMs) {
  const time = Math.max(0, Number(elapsedMs) || 0);
  const index = Math.floor((time % 540) / 180);
  return FALLBACK_VALUES[index];
}

export function mouthValueForBoundary(event = {}, index = 0) {
  const char = String(event.char || '');
  if (!char || PUNCTUATION.test(char)) return 0.05;
  if (OPEN_VOWELS.test(char)) return 0.88;
  return ORDINARY_VALUES[Math.abs(Number(index) || 0) % ORDINARY_VALUES.length];
}
