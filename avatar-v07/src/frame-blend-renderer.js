import { normalizeRendererState } from './avatar-types.js';
import { buildBlinkSequence, buildTalkSequence, frameAtTime, sequenceDuration } from './frame-sequence.js';

const STATE_FRAME = Object.freeze({
  idle: 'idle-open',
  listen: 'listen',
  think: 'listen',
  happy: 'happy',
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function isRapidFrame(frameId) {
  return frameId?.startsWith('mouth-') || frameId?.startsWith('blink-');
}

export class FrameBlendRenderer {
  #adapter;
  #view = null;
  #frames = {};
  #state = 'idle';
  #expression = 'neutral';
  #lipSync = 0;
  #lookTarget = { x: 0, y: 0 };
  #elapsedMs = 0;
  #currentFrame = null;
  #targetFrame = null;
  #activeLayer = 0;
  #transitionElapsed = 0;
  #transitionMs;
  #activeTransitionMs = 0;
  #blinkSequence = buildBlinkSequence();
  #blinkDuration = sequenceDuration(this.#blinkSequence);
  #talkSequence = buildTalkSequence();

  constructor({ adapter, transitionMs = 140 } = {}) {
    if (!adapter || typeof adapter.mount !== 'function') {
      throw new TypeError('FrameBlendRenderer requires an adapter with mount(surface)');
    }
    this.#adapter = adapter;
    this.#transitionMs = Math.max(0, transitionMs);
    this.#activeTransitionMs = this.#transitionMs;
  }

  async mount(surface) {
    if (this.#view) this.destroy();
    this.#view = await this.#adapter.mount(surface);
  }

  async loadCharacter(asset) {
    if (!this.#view) throw new Error('renderer must be mounted before loading a character');
    if (!asset || asset.id !== 'formal-v1' || !asset.frames?.['idle-open']) {
      throw new Error('invalid frame-blend character asset');
    }
    this.#frames = { ...asset.frames };
    await this.#view.preload(this.#frames);
    this.#activeLayer = 0;
    this.#currentFrame = 'idle-open';
    this.#targetFrame = 'idle-open';
    this.#activeTransitionMs = this.#transitionMs;
    this.#view.setFrame(0, this.#frames['idle-open']);
    this.#view.setFrame(1, this.#frames['idle-open']);
    this.#view.setOpacity(0, 1);
    this.#view.setOpacity(1, 0);
  }

  setState(state) {
    this.#state = normalizeRendererState({ state, expression: this.#expression }).state;
  }

  setExpression(expression) {
    this.#expression = normalizeRendererState({ state: this.#state, expression }).expression;
  }

  setLipSync(value) {
    this.#lipSync = clamp(Number(value), 0, 1);
  }

  setLookTarget(target = {}) {
    this.#lookTarget = {
      x: clamp(Number(target.x), -1, 1),
      y: clamp(Number(target.y), -1, 1),
    };
  }

  #frameForCurrentState() {
    if (this.#state === 'talk') {
      if (this.#lipSync >= 0.67) return 'mouth-a';
      if (this.#lipSync >= 0.34) return 'mouth-e';
      if (this.#lipSync >= 0.05) return 'mouth-u';
      return frameAtTime(this.#talkSequence, this.#elapsedMs);
    }
    if (this.#expression === 'happy' || this.#state === 'happy') return 'happy';
    if (this.#state === 'listen' || this.#state === 'think') return 'listen';
    const blinkPeriod = 4_400;
    const blinkStart = 3_900;
    const phase = this.#elapsedMs % blinkPeriod;
    if (phase >= blinkStart && phase < blinkStart + this.#blinkDuration) {
      return frameAtTime(this.#blinkSequence, phase - blinkStart);
    }
    return STATE_FRAME[this.#state] || 'idle-open';
  }

  #transitionDurationFor(frameId) {
    if (this.#transitionMs === 0) return 0;
    return isRapidFrame(frameId) ? Math.min(this.#transitionMs, 48) : this.#transitionMs;
  }

  #startTransition(frameId) {
    if (!this.#frames[frameId]) frameId = 'idle-open';
    if (frameId === this.#targetFrame) return;
    this.#targetFrame = frameId;
    this.#transitionElapsed = 0;
    this.#activeTransitionMs = this.#transitionDurationFor(frameId);
    const inactiveLayer = 1 - this.#activeLayer;
    this.#view.setFrame(inactiveLayer, this.#frames[frameId]);
    this.#view.setOpacity(inactiveLayer, 0);
  }

  #advanceTransition(deltaMs) {
    if (!this.#targetFrame || this.#targetFrame === this.#currentFrame) return;
    if (this.#activeTransitionMs === 0) {
      const inactiveLayer = 1 - this.#activeLayer;
      this.#view.setOpacity(this.#activeLayer, 0);
      this.#view.setOpacity(inactiveLayer, 1);
      this.#activeLayer = inactiveLayer;
      this.#currentFrame = this.#targetFrame;
      return;
    }
    this.#transitionElapsed += deltaMs;
    const progress = clamp(this.#transitionElapsed / this.#activeTransitionMs, 0, 1);
    const inactiveLayer = 1 - this.#activeLayer;
    this.#view.setOpacity(this.#activeLayer, 1 - progress);
    this.#view.setOpacity(inactiveLayer, progress);
    if (progress >= 1) {
      this.#activeLayer = inactiveLayer;
      this.#currentFrame = this.#targetFrame;
    }
  }

  update(deltaMs) {
    if (!this.#view || !this.#frames['idle-open']) return;
    const delta = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
    this.#elapsedMs += delta;
    this.#startTransition(this.#frameForCurrentState());
    this.#advanceTransition(delta);
    const seconds = this.#elapsedMs / 1000;
    const breath = Math.sin(seconds * Math.PI * 0.72) * 0.008;
    const sway = Math.sin(seconds * Math.PI * 0.34) * 0.007;
    const shoulder = Math.sin(seconds * Math.PI * 0.56 + 0.7) * 0.004;
    this.#view.setTransform({
      scaleX: 1 + breath * 0.35,
      scaleY: 1 + breath,
      rotation: sway + shoulder,
      offsetX: this.#lookTarget.x * 5,
      offsetY: this.#lookTarget.y * 3 - Math.abs(breath) * 2,
      frame: this.#currentFrame,
      state: this.#state,
    });
  }

  async capture() {
    if (!this.#view) throw new Error('renderer is not mounted');
    return this.#view.capture();
  }

  resize(width, height, dpr = 1) {
    if (this.#view) this.#view.resize(width, height, dpr);
  }

  destroy() {
    if (this.#view) this.#view.destroy();
    this.#view = null;
    this.#frames = {};
    this.#currentFrame = null;
    this.#targetFrame = null;
    this.#activeTransitionMs = this.#transitionMs;
  }

  get diagnostics() {
    return {
      rendererKind: 'frame-blend',
      state: this.#state,
      expression: this.#expression,
      currentFrame: this.#currentFrame,
      targetFrame: this.#targetFrame,
      activeTransitionMs: this.#activeTransitionMs,
      elapsedMs: this.#elapsedMs,
    };
  }
}
