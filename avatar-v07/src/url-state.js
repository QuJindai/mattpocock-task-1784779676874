import { normalizeRendererState } from './avatar-types.js';

export const DEFAULT_URL_STATE = Object.freeze({
  renderer: 'frame-blend',
  character: 'formal-v1',
  state: 'idle',
  expression: 'neutral',
  autoplay: true,
  scale: 1.02,
  x: -40,
  y: 18,
  warmth: 0.18,
  blur: 1.2,
  parallax: 10,
  exposure: 1,
  time: null,
});

const LIMITS = Object.freeze({
  scale: [0.7, 1.5],
  x: [-320, 320],
  y: [-160, 180],
  warmth: [-0.2, 0.4],
  blur: [0, 12],
  parallax: [0, 28],
  exposure: [0.5, 1.5],
  time: [0, 86_400_000],
});

function clampNumber(value, fallback, [min, max]) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function parseUrlState(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const semantic = normalizeRendererState({
    state: params.get('state') || DEFAULT_URL_STATE.state,
    expression: params.get('expression') || DEFAULT_URL_STATE.expression,
  });
  const renderer = params.get('renderer') === 'frame-blend'
    ? 'frame-blend'
    : DEFAULT_URL_STATE.renderer;
  const character = params.get('character') === 'formal-v1'
    ? 'formal-v1'
    : DEFAULT_URL_STATE.character;
  const timeRaw = params.get('time');
  return {
    renderer,
    character,
    state: semantic.state,
    expression: semantic.expression,
    autoplay: params.get('autoplay') === null
      ? DEFAULT_URL_STATE.autoplay
      : params.get('autoplay') !== '0',
    scale: clampNumber(params.get('scale'), DEFAULT_URL_STATE.scale, LIMITS.scale),
    x: clampNumber(params.get('x'), DEFAULT_URL_STATE.x, LIMITS.x),
    y: clampNumber(params.get('y'), DEFAULT_URL_STATE.y, LIMITS.y),
    warmth: clampNumber(params.get('warmth'), DEFAULT_URL_STATE.warmth, LIMITS.warmth),
    blur: clampNumber(params.get('blur'), DEFAULT_URL_STATE.blur, LIMITS.blur),
    parallax: clampNumber(params.get('parallax'), DEFAULT_URL_STATE.parallax, LIMITS.parallax),
    exposure: clampNumber(params.get('exposure'), DEFAULT_URL_STATE.exposure, LIMITS.exposure),
    time: timeRaw === null ? null : clampNumber(timeRaw, 0, LIMITS.time),
  };
}

export function serializeUrlState(state) {
  const params = new URLSearchParams();
  const normalized = { ...DEFAULT_URL_STATE, ...state };
  params.set('renderer', normalized.renderer);
  params.set('character', normalized.character);
  params.set('state', normalized.state);
  params.set('expression', normalized.expression);
  params.set('autoplay', normalized.autoplay ? '1' : '0');
  for (const key of ['scale', 'x', 'y', 'warmth', 'blur', 'parallax', 'exposure']) {
    params.set(key, String(normalized[key]));
  }
  if (normalized.time !== null && normalized.time !== undefined) {
    params.set('time', String(normalized.time));
  }
  return params.toString();
}
