import { assertAvatarRenderer } from './avatar-renderer.js';
import { normalizeRendererState } from './avatar-types.js';

export class AvatarController {
  #renderer;
  #state = 'idle';
  #expression = 'neutral';
  #lipSync = 0;
  #lookTarget = { x: 0, y: 0 };

  constructor(renderer) {
    this.#renderer = assertAvatarRenderer(renderer);
  }

  async mount(surface) {
    await this.#renderer.mount(surface);
  }

  async loadCharacter(asset) {
    await this.#renderer.loadCharacter(asset);
    this.#renderer.setState(this.#state);
    this.#renderer.setExpression(this.#expression);
    this.#renderer.setLipSync(this.#lipSync);
    this.#renderer.setLookTarget(this.#lookTarget);
  }

  setState(state) {
    this.#state = normalizeRendererState({ state, expression: this.#expression }).state;
    this.#renderer.setState(this.#state);
  }

  setExpression(expression) {
    this.#expression = normalizeRendererState({ state: this.#state, expression }).expression;
    this.#renderer.setExpression(this.#expression);
  }

  setLipSync(value) {
    this.#lipSync = Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
    this.#renderer.setLipSync(this.#lipSync);
  }

  setLookTarget(target = {}) {
    this.#lookTarget = {
      x: Math.min(1, Math.max(-1, Number(target.x) || 0)),
      y: Math.min(1, Math.max(-1, Number(target.y) || 0)),
    };
    this.#renderer.setLookTarget(this.#lookTarget);
  }

  update(deltaMs) {
    this.#renderer.update(deltaMs);
  }

  capture() {
    return this.#renderer.capture();
  }

  resize(width, height, dpr = 1) {
    this.#renderer.resize(width, height, dpr);
  }

  destroy() {
    this.#renderer.destroy();
  }

  get renderer() {
    return this.#renderer;
  }

  get diagnostics() {
    return {
      state: this.#state,
      expression: this.#expression,
      lipSync: this.#lipSync,
      lookTarget: { ...this.#lookTarget },
      renderer: this.#renderer.diagnostics || null,
    };
  }
}
