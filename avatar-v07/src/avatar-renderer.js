export const AVATAR_RENDERER_METHODS = Object.freeze([
  'mount',
  'loadCharacter',
  'setState',
  'setExpression',
  'setLipSync',
  'setLookTarget',
  'update',
  'capture',
  'resize',
  'destroy',
]);

export function assertAvatarRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object') {
    throw new TypeError('AvatarRenderer must be an object');
  }
  for (const method of AVATAR_RENDERER_METHODS) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`AvatarRenderer is missing method: ${method}`);
    }
  }
  return renderer;
}
