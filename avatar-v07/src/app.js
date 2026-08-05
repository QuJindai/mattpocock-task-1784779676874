import { AvatarController } from './avatar-controller.js';
import { DeterministicClock } from './deterministic-clock.js';
import { splitFrameDelta } from './frame-delta.js';
import { createPixiAdapter } from './pixi-adapter.js';
import { createAvatarRenderer } from './renderer-factory.js';
import { ShowcaseTimeline } from './showcase-timeline.js';
import { parseUrlState, serializeUrlState } from './url-state.js';

const ROUTES = new Set(['studio', 'showcase', 'capture', 'compare']);
const RUNTIME_URL = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const APP_BASE_URL = new URL('../', import.meta.url);
const FRAME_BASE_URL = new URL('public/frames/formal-v1/', APP_BASE_URL);
const routeToken = location.pathname.split('/').filter(Boolean)[0] || 'showcase';
const mode = ROUTES.has(routeToken) ? routeToken : 'showcase';
const query = new URLSearchParams(location.search);
const state = parseUrlState(location.search);
if (mode === 'studio' && !query.has('autoplay')) state.autoplay = false;
if (mode === 'capture') state.autoplay = false;

document.body.classList.add(`mode-${mode}`);
document.querySelector('#route-label').textContent = `${mode.toUpperCase()} · FRAME BLEND · v0.7`;

const appRoot = document.querySelector('#app');
const avatarSurface = document.querySelector('.avatar-surface');
const sceneBackground = document.querySelector('.scene-background');
const statusEl = document.querySelector('#showcase-status');
const autoplayEl = document.querySelector('#autoplay');

function setStatus(text, level = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.level = level;
}

function syncQuery() {
  const nextUrl = new URL(location.href);
  nextUrl.search = serializeUrlState(state);
  history.replaceState(null, '', nextUrl);
}

function applyPresentation() {
  appRoot.style.setProperty('--avatar-scale', String(state.scale));
  appRoot.style.setProperty('--avatar-x', `${state.x}px`);
  appRoot.style.setProperty('--avatar-y', `${state.y}px`);
  appRoot.style.setProperty('--warmth', String(state.warmth));
  appRoot.style.setProperty('--bg-blur', `${state.blur}px`);
  appRoot.style.setProperty('--exposure', String(state.exposure));
}

function setBackgroundParallax(normalizedX = 0, normalizedY = 0) {
  const amount = state.parallax;
  appRoot.style.setProperty('--bg-x', `${normalizedX * amount}px`);
  appRoot.style.setProperty('--bg-y', `${normalizedY * amount * 0.55}px`);
}

function frameAssetFromManifest(manifest) {
  const frames = {};
  for (const [id, entry] of Object.entries(manifest.frames || {})) {
    frames[id] = new URL(entry.file.replace(/^\.\//, ''), FRAME_BASE_URL).href;
  }
  return { id: manifest.characterId, frames };
}

function fallbackCharacter() {
  const url = new URL('idle-open.webp', FRAME_BASE_URL).href;
  return {
    id: 'formal-v1',
    frames: Object.fromEntries([
      'idle-open', 'blink-half', 'blink-closed', 'happy',
      'listen', 'mouth-a', 'mouth-e', 'mouth-u',
    ].map((id) => [id, url])),
  };
}

async function loadBackgroundAsset() {
  try {
    const response = await fetch(`${RUNTIME_URL}?asset=background`, { cache: 'force-cache' });
    const body = await response.json();
    if (!response.ok || body.ok !== true || !body.imageBase64 || !body.mimeType?.startsWith('image/')) {
      throw new Error(body.error || `background ${response.status}`);
    }
    const url = `data:${body.mimeType};base64,${body.imageBase64}`;
    sceneBackground.style.backgroundImage = `url(${JSON.stringify(url)})`;
    return { degraded: false, bytes: body.bytes || 0, mimeType: body.mimeType };
  } catch (error) {
    console.error(error);
    sceneBackground.style.backgroundImage = 'radial-gradient(circle at 65% 35%, #594331, #111621 45%, #090b10 78%)';
    return { degraded: true, error: error.message || String(error) };
  }
}

async function loadCharacterAsset() {
  try {
    const response = await fetch(new URL('manifest.json', FRAME_BASE_URL), { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    const manifest = await response.json();
    const required = [
      'idle-open', 'blink-half', 'blink-closed', 'happy',
      'listen', 'mouth-a', 'mouth-e', 'mouth-u',
    ];
    if (manifest.characterId !== 'formal-v1' || required.some((id) => !manifest.frames?.[id])) {
      throw new Error('manifest is incomplete');
    }
    return { asset: frameAssetFromManifest(manifest), manifest, degraded: false };
  } catch (error) {
    console.error(error);
    return {
      asset: fallbackCharacter(),
      manifest: { characterId: 'formal-v1', frames: {}, error: error.message || String(error) },
      degraded: true,
    };
  }
}

const adapter = createPixiAdapter();
const renderer = createAvatarRenderer(state.renderer, { adapter });
const controller = new AvatarController(renderer);
await controller.mount(avatarSurface);
const [loaded, background] = await Promise.all([loadCharacterAsset(), loadBackgroundAsset()]);
await controller.loadCharacter(loaded.asset);
controller.setState(state.state);
controller.setExpression(state.expression);

const timeline = new ShowcaseTimeline(controller, {
  autoplay: mode === 'showcase' ? state.autoplay : false,
});
timeline.setPhase(state.state);
if (mode !== 'showcase') timeline.setAutoplay(false);

applyPresentation();
if (autoplayEl) autoplayEl.checked = state.autoplay;
const degraded = loaded.degraded || background.degraded;
setStatus(degraded ? '资源降级：部分正式资产不可用' : '关键帧与正式场景已就绪', degraded ? 'warning' : 'ready');

function resizeRenderer() {
  const rect = avatarSurface.getBoundingClientRect();
  controller.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), devicePixelRatio || 1);
}
resizeRenderer();
addEventListener('resize', resizeRenderer, { passive: true });

function updateActiveButtons() {
  document.querySelectorAll('[data-state]').forEach((button) => {
    button.classList.toggle('on', button.dataset.state === state.state);
  });
  document.querySelectorAll('[data-expression]').forEach((button) => {
    button.classList.toggle('on', button.dataset.expression === state.expression);
  });
}

function bindStudioControls() {
  if (mode !== 'studio') return;
  document.querySelectorAll('[data-state]').forEach((button) => {
    button.addEventListener('click', () => {
      state.state = button.dataset.state;
      controller.setState(state.state);
      timeline.setPhase(state.state);
      updateActiveButtons();
      syncQuery();
    });
  });
  document.querySelectorAll('[data-expression]').forEach((button) => {
    button.addEventListener('click', () => {
      state.expression = button.dataset.expression;
      controller.setExpression(state.expression);
      updateActiveButtons();
      syncQuery();
    });
  });
  autoplayEl.addEventListener('change', () => {
    state.autoplay = autoplayEl.checked;
    timeline.setAutoplay(state.autoplay);
    syncQuery();
  });
  for (const id of ['scale', 'x', 'y', 'warmth', 'blur', 'parallax', 'exposure']) {
    const input = document.querySelector(`#${id}`);
    const output = document.querySelector(`#out-${id}`);
    input.value = state[id];
    output.value = state[id];
    input.addEventListener('input', () => {
      state[id] = Number(input.value);
      output.value = input.value;
      applyPresentation();
      syncQuery();
    });
  }
  updateActiveButtons();
}
bindStudioControls();

let lastPointerEvent = 0;
addEventListener('pointermove', (event) => {
  const now = performance.now();
  if (now - lastPointerEvent < 30) return;
  lastPointerEvent = now;
  const nx = event.clientX / innerWidth * 2 - 1;
  const ny = event.clientY / innerHeight * 2 - 1;
  controller.setLookTarget({ x: nx, y: ny });
  setBackgroundParallax(-nx, -ny);
  timeline.interact();
}, { passive: true });
addEventListener('pointerdown', () => timeline.interact(), { passive: true });

const clock = new DeterministicClock(0);
let lastFrameTime = performance.now();
let lastPhase = timeline.diagnostics.phase;

function updateRouteStateFromTimeline() {
  const diagnostics = timeline.diagnostics;
  if (diagnostics.phase === lastPhase) return;
  lastPhase = diagnostics.phase;
  state.state = diagnostics.phase;
  state.expression = diagnostics.phase === 'happy'
    ? 'happy'
    : diagnostics.phase === 'listen'
      ? 'focused'
      : diagnostics.phase === 'talk'
        ? 'soft-smile'
        : 'neutral';
  updateActiveButtons();
  if (mode === 'showcase') syncQuery();
}

function renderStep(timelineDeltaMs, rendererDeltaMs = timelineDeltaMs) {
  clock.tick(timelineDeltaMs);
  timeline.tick(timelineDeltaMs);
  controller.update(rendererDeltaMs);
  updateRouteStateFromTimeline();
}

function animationLoop(now) {
  const rawDeltaMs = Math.max(0, now - lastFrameTime);
  lastFrameTime = now;
  const { timelineDeltaMs, rendererDeltaMs } = splitFrameDelta(rawDeltaMs);
  renderStep(timelineDeltaMs, rendererDeltaMs);
  window.__avatarLab.ready = true;
  requestAnimationFrame(animationLoop);
}

window.__avatarLab = {
  rendererKind: 'frame-blend',
  mode,
  state,
  manifest: loaded.manifest,
  degraded,
  background,
  assetBase: APP_BASE_URL.href,
  frameBase: FRAME_BASE_URL.href,
  ready: false,
  get diagnostics() {
    return {
      controller: controller.diagnostics,
      timeline: timeline.diagnostics,
      clockMs: clock.now(),
      background: sceneBackground.style.backgroundImage || 'css-static',
    };
  },
  setState(nextState) {
    state.state = nextState;
    controller.setState(nextState);
    timeline.setPhase(nextState);
    syncQuery();
  },
  setExpression(nextExpression) {
    state.expression = nextExpression;
    controller.setExpression(nextExpression);
    syncQuery();
  },
  setLipSync(value) {
    controller.setLipSync(value);
  },
  pauseAutoplay() {
    timeline.setAutoplay(false);
    state.autoplay = false;
    syncQuery();
  },
  resumeAutoplay() {
    timeline.setAutoplay(true);
    state.autoplay = true;
    syncQuery();
  },
  capture: () => controller.capture(),
};

if (mode === 'capture') {
  const fixedTime = state.time ?? 0;
  timeline.setPhase(state.state);
  timeline.setAutoplay(false);
  renderStep(fixedTime, fixedTime);
  window.__avatarLab.ready = true;
  document.documentElement.dataset.captureReady = 'true';
} else {
  requestAnimationFrame(animationLoop);
}
