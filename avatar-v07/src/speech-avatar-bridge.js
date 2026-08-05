import { fallbackMouthValue, mouthValueForBoundary } from './mouth-timeline.js';

export class SpeechAvatarBridge {
  #controller;
  #now;
  #boundaryTimeoutMs;
  #cueHoldMs;
  #speaking = false;
  #startedAt = 0;
  #lastBoundaryAt = 0;
  #boundaryIndex = 0;
  #previous = null;
  #cueQueue = [];
  #activeCueUntil = 0;
  #activeCueValue = 0;
  #appliedCueCount = 0;

  constructor(controller, {
    now = () => performance.now(),
    boundaryTimeoutMs = 500,
    cueHoldMs = 260,
  } = {}) {
    if (!controller || typeof controller.setState !== 'function') {
      throw new TypeError('SpeechAvatarBridge requires an AvatarController-like object');
    }
    this.#controller = controller;
    this.#now = now;
    this.#boundaryTimeoutMs = Math.max(0, Number(boundaryTimeoutMs) || 0);
    this.#cueHoldMs = Math.max(80, Number(cueHoldMs) || 260);
  }

  #applyCue(value, now) {
    this.#activeCueValue = value;
    this.#activeCueUntil = now + this.#cueHoldMs;
    this.#appliedCueCount += 1;
    this.#controller.setLipSync(value);
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
    this.#cueQueue = [];
    this.#activeCueUntil = this.#startedAt;
    this.#activeCueValue = 0.2;
    this.#appliedCueCount = 0;
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
    if (this.#cueQueue.length === 0 && now >= this.#activeCueUntil) {
      this.#applyCue(value, now);
    } else {
      this.#cueQueue.push(value);
    }
  }

  update() {
    if (!this.#speaking) return;
    const now = this.#now();
    if (this.#cueQueue.length > 0 && now >= this.#activeCueUntil) {
      this.#applyCue(this.#cueQueue.shift(), now);
      return;
    }
    if (this.#cueQueue.length === 0 && now >= this.#activeCueUntil && now - this.#lastBoundaryAt >= this.#boundaryTimeoutMs) {
      const value = fallbackMouthValue(now - this.#startedAt);
      this.#activeCueValue = value;
      this.#controller.setLipSync(value);
    }
  }

  #restore() {
    if (!this.#speaking) return;
    this.#speaking = false;
    this.#cueQueue = [];
    this.#activeCueUntil = 0;
    this.#activeCueValue = 0;
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
      queuedCues: this.#cueQueue.length,
      activeCueValue: this.#activeCueValue,
      activeCueUntil: this.#activeCueUntil,
      appliedCueCount: this.#appliedCueCount,
      cueHoldMs: this.#cueHoldMs,
      previous: this.#previous ? { ...this.#previous } : null,
    };
  }
}
