import { fallbackMouthValue, mouthValueForBoundary } from './mouth-timeline.js';

export class SpeechAvatarBridge {
  #controller;
  #now;
  #boundaryTimeoutMs;
  #speaking = false;
  #startedAt = 0;
  #lastBoundaryAt = 0;
  #boundaryIndex = 0;
  #previous = null;

  constructor(controller, { now = () => performance.now(), boundaryTimeoutMs = 500 } = {}) {
    if (!controller || typeof controller.setState !== 'function') {
      throw new TypeError('SpeechAvatarBridge requires an AvatarController-like object');
    }
    this.#controller = controller;
    this.#now = now;
    this.#boundaryTimeoutMs = Math.max(0, Number(boundaryTimeoutMs) || 0);
  }

  handleStart() {
    if (!this.#speaking) {
      const diagnostics = this.#controller.diagnostics || {};
      this.#previous = {
        state: diagnostics.state || 'idle',
        expression: diagnostics.expression || 'neutral',
      };
    }
    this.#speaking = true;
    this.#startedAt = this.#now();
    this.#lastBoundaryAt = this.#startedAt;
    this.#boundaryIndex = 0;
    this.#controller.setState('talk');
    this.#controller.setExpression('soft-smile');
    this.#controller.setLipSync(0.2);
  }

  handleBoundary(event = {}) {
    if (!this.#speaking) return;
    const now = this.#now();
    this.#lastBoundaryAt = now;
    const value = mouthValueForBoundary(event, this.#boundaryIndex);
    this.#boundaryIndex += 1;
    this.#controller.setLipSync(value);
  }

  update() {
    if (!this.#speaking) return;
    const now = this.#now();
    if (now - this.#lastBoundaryAt >= this.#boundaryTimeoutMs) {
      this.#controller.setLipSync(fallbackMouthValue(now - this.#startedAt));
    }
  }

  #restore() {
    if (!this.#speaking) return;
    this.#speaking = false;
    this.#controller.setLipSync(0);
    this.#controller.setState(this.#previous?.state || 'idle');
    this.#controller.setExpression(this.#previous?.expression || 'neutral');
    this.#previous = null;
  }

  handleEnd() {
    this.#restore();
  }

  handleCancel() {
    this.#restore();
  }

  handleError() {
    this.#restore();
  }

  handleEvent(event = {}) {
    if (event.type === 'start') this.handleStart();
    else if (event.type === 'boundary') this.handleBoundary(event);
    else if (event.type === 'end') this.handleEnd();
    else if (event.type === 'cancel') this.handleCancel();
    else if (event.type === 'error') this.handleError();
  }

  get speaking() {
    return this.#speaking;
  }

  get diagnostics() {
    return {
      speaking: this.#speaking,
      startedAt: this.#startedAt,
      lastBoundaryAt: this.#lastBoundaryAt,
      boundaryIndex: this.#boundaryIndex,
      previous: this.#previous ? { ...this.#previous } : null,
    };
  }
}
