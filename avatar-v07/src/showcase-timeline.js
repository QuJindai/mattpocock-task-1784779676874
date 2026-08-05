const DEFAULT_PHASES = Object.freeze([
  { state: 'idle', expression: 'neutral', durationMs: 8_000 },
  { state: 'happy', expression: 'happy', durationMs: 4_000 },
  { state: 'listen', expression: 'focused', durationMs: 5_000 },
  { state: 'talk', expression: 'soft-smile', durationMs: 6_000 },
]);

export class ShowcaseTimeline {
  #controller;
  #phases;
  #phaseIndex = 0;
  #phaseElapsedMs = 0;
  #pauseRemainingMs = 0;
  #autoplay;
  #failed = false;

  constructor(controller, { autoplay = true, phases = DEFAULT_PHASES } = {}) {
    if (!controller || typeof controller.setState !== 'function') {
      throw new TypeError('ShowcaseTimeline requires an AvatarController-like object');
    }
    this.#controller = controller;
    this.#phases = phases.map((phase) => ({ ...phase }));
    this.#autoplay = Boolean(autoplay);
    this.#applyPhase();
  }

  #applyPhase() {
    const phase = this.#phases[this.#phaseIndex];
    try {
      this.#controller.setState(phase.state);
      this.#controller.setExpression(phase.expression);
      if (phase.state !== 'talk') this.#controller.setLipSync(0);
    } catch {
      this.#failed = true;
      this.#autoplay = false;
      this.#phaseIndex = 0;
      this.#phaseElapsedMs = 0;
      this.#pauseRemainingMs = 0;
      try {
        this.#controller.setState('idle');
        this.#controller.setExpression('neutral');
        this.#controller.setLipSync(0);
      } catch {
        // Renderer failure is already reflected by diagnostics.
      }
    }
  }

  #updateTalkLipSync() {
    const phase = this.#phases[this.#phaseIndex];
    if (phase.state !== 'talk') return;
    const t = this.#phaseElapsedMs / 1000;
    const primary = 0.5 + 0.5 * Math.sin(t * Math.PI * 4.6);
    const secondary = 0.5 + 0.5 * Math.sin(t * Math.PI * 7.1 + 0.9);
    this.#controller.setLipSync(Math.min(1, primary * 0.68 + secondary * 0.32));
  }

  tick(deltaMs) {
    let remaining = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
    if (this.#pauseRemainingMs > 0) {
      const consumed = Math.min(this.#pauseRemainingMs, remaining);
      this.#pauseRemainingMs -= consumed;
      remaining -= consumed;
      if (remaining <= 0) return;
    }
    if (!this.#autoplay || this.#failed) return;
    this.#phaseElapsedMs += remaining;
    let guard = 0;
    while (guard < this.#phases.length && this.#phaseElapsedMs >= this.#phases[this.#phaseIndex].durationMs) {
      this.#phaseElapsedMs -= this.#phases[this.#phaseIndex].durationMs;
      this.#phaseIndex = (this.#phaseIndex + 1) % this.#phases.length;
      this.#applyPhase();
      if (!this.#autoplay) return;
      guard += 1;
    }
    this.#updateTalkLipSync();
  }

  interact() {
    this.#pauseRemainingMs = 5_000;
  }

  setAutoplay(value) {
    this.#autoplay = Boolean(value) && !this.#failed;
    if (!this.#autoplay) this.#controller.setLipSync(0);
  }

  setPhase(state) {
    const index = this.#phases.findIndex((phase) => phase.state === state);
    if (index < 0) return false;
    this.#phaseIndex = index;
    this.#phaseElapsedMs = 0;
    this.#applyPhase();
    return true;
  }

  get diagnostics() {
    return {
      autoplay: this.#autoplay,
      failed: this.#failed,
      phase: this.#phases[this.#phaseIndex].state,
      phaseIndex: this.#phaseIndex,
      phaseElapsedMs: this.#phaseElapsedMs,
      pauseRemainingMs: this.#pauseRemainingMs,
    };
  }
}
