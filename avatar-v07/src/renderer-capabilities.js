export const FRAME_BLEND_CAPABILITIES = Object.freeze({
  renderer: 'frame-blend',
  speech: true,
  lipSync: 'amplitude',
  expressions: true,
  lookTarget: true,
  capture: true,
});

export function getRendererCapabilities(kind) {
  if (kind === 'frame-blend') return FRAME_BLEND_CAPABILITIES;
  return {
    renderer: String(kind || 'unknown'),
    speech: false,
    lipSync: 'none',
    expressions: false,
    lookTarget: false,
    capture: false,
  };
}
