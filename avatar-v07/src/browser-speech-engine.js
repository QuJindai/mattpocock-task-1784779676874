import { normalizeSpeechOptions } from './speech-types.js';
import { describeVoice, selectVoice } from './voice-selection.js';

export class SpeechSynthesisError extends Error {
  constructor(code = 'unknown') {
    super(`Speech synthesis failed: ${code}`);
    this.name = 'SpeechSynthesisError';
    this.code = code;
  }
}

function defaultAdapter() {
  return {
    speechSynthesis: globalThis.speechSynthesis || null,
    Utterance: globalThis.SpeechSynthesisUtterance || null,
  };
}

export class BrowserSpeechEngine {
  #adapter;
  #synthesis;
  #Utterance;
  #rawVoices = [];
  #listeners = new Set();
  #active = null;
  #destroyed = false;
  #voicesChangedHandler;
  #lastEvent = null;

  constructor(adapter = defaultAdapter()) {
    this.#adapter = adapter || {};
    this.#synthesis = this.#adapter.speechSynthesis || null;
    this.#Utterance = this.#adapter.Utterance || null;
    this.#voicesChangedHandler = () => {
      this.refreshVoices();
      this.#emit({ type: 'voiceschanged', voices: this.voices });
    };
    if (this.supported) {
      this.refreshVoices();
      this.#synthesis.addEventListener?.('voiceschanged', this.#voicesChangedHandler);
    }
  }

  get supported() {
    return Boolean(this.#synthesis && typeof this.#Utterance === 'function');
  }

  get speaking() {
    return Boolean(this.#active);
  }

  get voices() {
    return this.#rawVoices.map(describeVoice);
  }

  refreshVoices() {
    if (!this.supported || this.#destroyed) {
      this.#rawVoices = [];
      return [];
    }
    const voices = this.#synthesis.getVoices?.();
    this.#rawVoices = Array.isArray(voices) ? [...voices] : [];
    return this.voices;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Speech listener must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    this.#lastEvent = event;
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
  }

  #settle(active, kind, value) {
    if (!active || active.settled) return;
    active.settled = true;
    active.utterance.onstart = null;
    active.utterance.onboundary = null;
    active.utterance.onend = null;
    active.utterance.onerror = null;
    if (this.#active === active) this.#active = null;
    if (kind === 'resolve') active.resolve(value);
    else active.reject(value);
  }

  speak(text, options = {}) {
    if (this.#destroyed) return Promise.reject(new Error('BrowserSpeechEngine has been destroyed'));
    if (!this.supported) return Promise.reject(new Error('Browser speech synthesis is not supported'));

    let normalized;
    try {
      normalized = normalizeSpeechOptions({ ...options, text });
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.#active) this.stop();
    this.refreshVoices();

    const utterance = new this.#Utterance(normalized.text);
    utterance.lang = normalized.lang;
    utterance.rate = normalized.rate;
    utterance.pitch = normalized.pitch;
    utterance.volume = normalized.volume;
    utterance.voice = selectVoice(this.#rawVoices, normalized.voice, normalized.lang);

    const promise = new Promise((resolve, reject) => {
      const active = {
        utterance,
        options: normalized,
        resolve,
        reject,
        settled: false,
      };
      this.#active = active;
      utterance.onstart = (event = {}) => {
        if (this.#active !== active || active.settled) return;
        this.#emit({ type: 'start', text: normalized.text, options: normalized, event });
      };
      utterance.onboundary = (event = {}) => {
        if (this.#active !== active || active.settled) return;
        const charIndex = Number.isFinite(event.charIndex) ? event.charIndex : 0;
        this.#emit({
          type: 'boundary',
          text: normalized.text,
          char: normalized.text[charIndex] || '',
          charIndex,
          name: event.name || '',
          elapsedTime: Number(event.elapsedTime) || 0,
          event,
        });
      };
      utterance.onend = (event = {}) => {
        if (this.#active !== active || active.settled) return;
        this.#emit({ type: 'end', text: normalized.text, options: normalized, event });
        this.#settle(active, 'resolve', { status: 'completed' });
      };
      utterance.onerror = (event = {}) => {
        if (this.#active !== active || active.settled) return;
        const error = new SpeechSynthesisError(event.error || 'unknown');
        this.#emit({ type: 'error', text: normalized.text, options: normalized, error, event });
        this.#settle(active, 'reject', error);
      };
      try {
        this.#synthesis.speak(utterance);
      } catch (error) {
        this.#emit({ type: 'error', text: normalized.text, options: normalized, error });
        this.#settle(active, 'reject', error);
      }
    });

    return promise;
  }

  stop() {
    const active = this.#active;
    if (!active) return false;
    try {
      this.#synthesis.cancel();
    } finally {
      this.#emit({ type: 'cancel', text: active.options.text, options: active.options });
      this.#settle(active, 'resolve', { status: 'cancelled' });
    }
    return true;
  }

  destroy() {
    if (this.#destroyed) return;
    this.stop();
    this.#synthesis?.removeEventListener?.('voiceschanged', this.#voicesChangedHandler);
    this.#listeners.clear();
    this.#destroyed = true;
    this.#rawVoices = [];
  }

  get diagnostics() {
    return {
      supported: this.supported,
      speaking: this.speaking,
      destroyed: this.#destroyed,
      voices: this.voices,
      activeText: this.#active?.options.text || '',
      lastEventType: this.#lastEvent?.type || null,
    };
  }
}
