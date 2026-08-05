export function splitFrameDelta(rawDeltaMs, { timelineCapMs = 1000, rendererCapMs = 50 } = {}) {
  const raw = Number.isFinite(rawDeltaMs) ? Math.max(0, rawDeltaMs) : 0;
  return {
    timelineDeltaMs: Math.min(raw, Math.max(0, timelineCapMs)),
    rendererDeltaMs: Math.min(raw, Math.max(0, rendererCapMs)),
  };
}
