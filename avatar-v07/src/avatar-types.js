export const AVATAR_STATES = Object.freeze(['idle', 'listen', 'think', 'talk', 'happy']);
export const EXPRESSION_STATES = Object.freeze(['neutral', 'soft-smile', 'happy', 'focused']);

export function normalizeRendererState(input = {}) {
  const state = AVATAR_STATES.includes(input.state) ? input.state : 'idle';
  const expression = EXPRESSION_STATES.includes(input.expression) ? input.expression : 'neutral';
  return { state, expression };
}
