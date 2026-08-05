export class DeterministicClock {
  #time;
  #paused = false;

  constructor(initialTime = 0) {
    this.#time = Number.isFinite(initialTime) ? initialTime : 0;
  }

  now() {
    return this.#time;
  }

  tick(deltaMs) {
    if (!this.#paused) {
      const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
      this.#time += delta;
    }
    return this.#time;
  }

  pause() {
    this.#paused = true;
  }

  resume() {
    this.#paused = false;
  }

  reset(time = 0) {
    this.#time = Number.isFinite(time) ? time : 0;
  }

  get paused() {
    return this.#paused;
  }
}
