export function buildBlinkSequence() {
  return [
    { frame: 'idle-open', durationMs: 40 },
    { frame: 'blink-half', durationMs: 55 },
    { frame: 'blink-closed', durationMs: 70 },
    { frame: 'blink-half', durationMs: 55 },
    { frame: 'idle-open', durationMs: 80 },
  ];
}

export function buildTalkSequence() {
  return [
    { frame: 'mouth-a', durationMs: 95 },
    { frame: 'mouth-e', durationMs: 85 },
    { frame: 'mouth-u', durationMs: 90 },
    { frame: 'idle-open', durationMs: 55 },
    { frame: 'mouth-e', durationMs: 70 },
  ];
}

export function sequenceDuration(sequence) {
  return sequence.reduce((total, item) => total + Math.max(0, item.durationMs || 0), 0);
}

export function frameAtTime(sequence, timeMs) {
  if (!Array.isArray(sequence) || sequence.length === 0) return null;
  const duration = sequenceDuration(sequence);
  if (duration <= 0) return sequence[0].frame;
  let cursor = ((timeMs % duration) + duration) % duration;
  for (const item of sequence) {
    cursor -= Math.max(0, item.durationMs || 0);
    if (cursor < 0) return item.frame;
  }
  return sequence.at(-1).frame;
}
