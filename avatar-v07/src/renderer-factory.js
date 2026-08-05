import { FrameBlendRenderer } from './frame-blend-renderer.js';

export function createAvatarRenderer(kind, options) {
  if (kind === 'frame-blend') return new FrameBlendRenderer(options);
  throw new Error(`unsupported avatar renderer: ${kind}`);
}
