# Avatar Showcase v0.8 Browser TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-native text-to-speech and renderer-neutral mouth animation to Avatar Showcase without cloud TTS, microphone access, recording, or voiceprint collection.

**Architecture:** `BrowserSpeechEngine` wraps `speechSynthesis` behind an injected adapter. `SpeechAvatarBridge` converts speech lifecycle and boundary events into semantic avatar state and lip-sync values through `AvatarController`. Studio owns controls only; Showcase exposes a public speech API without controls.

**Tech Stack:** Native ES modules, Web Speech API, PixiJS 8, Node.js 22 built-in test runner, Playwright, GitHub Actions, Vercel.

## Global Constraints

- Use only browser `speechSynthesis` and `SpeechSynthesisUtterance`.
- Do not request microphone permission.
- Do not record, upload, store, clone, or identify voices.
- Do not introduce cloud TTS, API keys, paid services, or new Supabase endpoints.
- Keep `AvatarRenderer`, `FrameBlendRenderer`, scene layers, routes, and deterministic Capture compatible with v0.7.
- Work only on branch `avatar-showcase-v0.8` until all gates pass.
- Do not modify the legacy `vrm-showcase-lab` project.
- Keep v0.7 Production active until v0.8 Production acceptance passes.

---

### Task 1: Speech Options and Voice Selection

**Files:**
- Create: `avatar-v07/src/speech-types.js`
- Create: `avatar-v07/src/voice-selection.js`
- Test: `avatar-v07/tests/voice-selection.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_SPEECH_OPTIONS`, `normalizeSpeechOptions(input)`, `voiceId(voice)`, `describeVoice(voice)`, `selectVoice(voices, requestedId, language)`.
- Consumes: none.

- [ ] **Step 1: Write the failing tests**

Tests must verify rate clamps to `0.6–1.6`, pitch to `0.7–1.4`, volume to `0–1`, empty text rejection, and selection priority: explicit ID → local `zh-CN` → any Chinese → default → first.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test avatar-v07/tests/voice-selection.test.mjs`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement the option and voice helpers**

`voiceId()` must return `voice.voiceURI` when present, otherwise `${voice.name}|${voice.lang}`. `describeVoice()` must return only serializable metadata.

- [ ] **Step 4: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add avatar-v07/src/speech-types.js avatar-v07/src/voice-selection.js avatar-v07/tests/voice-selection.test.mjs
git commit -m "feat: add browser speech option helpers"
```

### Task 2: BrowserSpeechEngine

**Files:**
- Create: `avatar-v07/src/browser-speech-engine.js`
- Test: `avatar-v07/tests/browser-speech-engine.test.mjs`

**Interfaces:**
- Produces: `BrowserSpeechEngine` with `supported`, `speaking`, `voices`, `refreshVoices()`, `speak(text, options)`, `stop()`, `destroy()`, and `diagnostics`.
- Consumes: Task 1 helpers.

- [ ] **Step 1: Write a fake speech adapter**

The fake must expose `speechSynthesis`, `Utterance`, `getVoices`, `speak`, `cancel`, `addEventListener`, and manual utterance event dispatch.

- [ ] **Step 2: Write failing lifecycle tests**

Verify unsupported detection, voice refresh, utterance option application, new-speech cancellation, `start/boundary/end/error`, explicit stop returning `{status:'cancelled'}`, and destroy cleanup.

- [ ] **Step 3: Run tests and verify red**

Run: `node --test avatar-v07/tests/browser-speech-engine.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement the engine**

The engine must never access microphone APIs. Every `speak()` call must settle exactly once. `error` rejects with a descriptive `SpeechSynthesisError`; user `stop()` resolves the active call as cancelled.

- [ ] **Step 5: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/src/browser-speech-engine.js avatar-v07/tests/browser-speech-engine.test.mjs
git commit -m "feat: add browser speech engine"
```

### Task 3: Renderer-Neutral SpeechAvatarBridge

**Files:**
- Create: `avatar-v07/src/speech-avatar-bridge.js`
- Create: `avatar-v07/src/mouth-timeline.js`
- Test: `avatar-v07/tests/speech-avatar-bridge.test.mjs`
- Test: `avatar-v07/tests/mouth-timeline.test.mjs`

**Interfaces:**
- Produces: `SpeechAvatarBridge`, `mouthValueForBoundary(event, index)`, `fallbackMouthValue(elapsedMs)`.
- Consumes: `AvatarController`, `BrowserSpeechEngine` events.

- [ ] **Step 1: Write failing deterministic mouth tests**

Require a repeating three-level mouth sequence over 540ms and boundary mapping that changes values for punctuation, vowels, and ordinary characters.

- [ ] **Step 2: Write failing bridge tests**

A fake controller must prove: speech start saves prior state and switches to talk; boundary events change lip sync; a 500ms boundary gap triggers fallback motion; end/error/cancel set lip sync to zero and restore prior state/expression.

- [ ] **Step 3: Run tests and verify red**

Run: `node --test avatar-v07/tests/mouth-timeline.test.mjs avatar-v07/tests/speech-avatar-bridge.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement the minimal bridge**

The bridge must not import PixiJS or frame names. It communicates only through `setState`, `setExpression`, and `setLipSync`.

- [ ] **Step 5: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/src/speech-avatar-bridge.js avatar-v07/src/mouth-timeline.js avatar-v07/tests
git commit -m "feat: bridge browser speech to avatar semantics"
```

### Task 4: URL State and Renderer Capabilities

**Files:**
- Modify: `avatar-v07/src/url-state.js`
- Create: `avatar-v07/src/renderer-capabilities.js`
- Modify: `avatar-v07/tests/url-state.test.mjs`
- Create: `avatar-v07/tests/renderer-capabilities.test.mjs`

**Interfaces:**
- Produces: URL fields `voice`, `rate`, `pitch`, `volume`; `FRAME_BLEND_CAPABILITIES` and `getRendererCapabilities(kind)`.
- Consumes: existing URL state and renderer kind.

- [ ] **Step 1: Write failing URL and capabilities tests**

Verify refresh restoration, clamping, empty voice omission, no text-in-URL, and capabilities `{speech:true, lipSync:'amplitude', expressions:true, lookTarget:true, capture:true}`.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test avatar-v07/tests/url-state.test.mjs avatar-v07/tests/renderer-capabilities.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement URL fields and capabilities**

Existing v0.7 URL fields must round-trip unchanged.

- [ ] **Step 4: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add avatar-v07/src/url-state.js avatar-v07/src/renderer-capabilities.js avatar-v07/tests
git commit -m "feat: add speech URL state and renderer capabilities"
```

### Task 5: Studio Speech Controls and Public API

**Files:**
- Modify: `avatar-v07/index.html`
- Modify: `avatar-v07/styles.css`
- Modify: `avatar-v07/src/app.js`
- Modify: `avatar-v07/tests/app-contract.test.mjs`

**Interfaces:**
- Produces: Studio controls and `window.__avatarLab.speech`, `speak`, `stopSpeaking`.
- Consumes: Tasks 1–4.

- [ ] **Step 1: Write failing app contract tests**

Require textarea, voice select, rate/pitch/volume controls, speak/stop buttons, no microphone-related strings, public speech API, renderer capabilities, and no speech panel in Showcase/Capture.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test avatar-v07/tests/app-contract.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement Studio controls**

Default text: `你好，很高兴见到你。今天想聊些什么？`. Voice options populate from the engine. Controls write URL settings except text.

- [ ] **Step 4: Implement public speech API**

`window.__avatarLab.speak(text, options)` delegates to the bridge, while `stopSpeaking()` cancels. `beforeunload` and `pagehide` must stop speech.

- [ ] **Step 5: Run all unit and contract tests**

Run: `node --test avatar-v07/tests/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/index.html avatar-v07/styles.css avatar-v07/src/app.js avatar-v07/tests/app-contract.test.mjs
git commit -m "feat: add browser TTS studio controls"
```

### Task 6: Browser Speech Acceptance Harness

**Files:**
- Create: `avatar-v07/scripts/speech-acceptance.mjs`
- Create: `.github/workflows/avatar-v08-isolated-acceptance.yml`

**Interfaces:**
- Produces: `speech-results.json`, browser log, screenshots, simulated speech event trace.
- Consumes: complete v0.8 app.

- [ ] **Step 1: Implement an init-script speech mock**

The Playwright init script must install fake `speechSynthesis` and `SpeechSynthesisUtterance` before app code runs, expose two Chinese voices, emit start, boundary, and end events, and support cancellation.

- [ ] **Step 2: Add fail-closed checks**

Verify Studio controls, voice selection, URL restore, talk transition, at least three positive lip values, end restoration, stop cancellation, unsupported-mode degradation, no microphone permission request, and hidden speech panel in Showcase.

- [ ] **Step 3: Preserve v0.7 regression gates**

Run the existing `cloud-acceptance.mjs` after speech acceptance.

- [ ] **Step 4: Upload evidence on success and failure**

Artifact must contain results, logs, Studio screenshot, talking screenshot, stopped screenshot, and existing v0.7 screenshots.

- [ ] **Step 5: Commit**

```bash
git add avatar-v07/scripts/speech-acceptance.mjs .github/workflows/avatar-v08-isolated-acceptance.yml
git commit -m "test: add browser speech cloud acceptance"
```

### Task 7: Vercel Preview and Production Promotion

**Files:**
- Create: `.github/workflows/avatar-v08-production-acceptance.yml`
- Create: `docs/avatar-showcase-v08-release.md`

**Interfaces:**
- Produces: verified Production and rollback record.
- Consumes: all prior tasks.

- [ ] **Step 1: Lock an immutable commit**

Use the branch commit SHA in every Vercel route entry and acceptance expectation.

- [ ] **Step 2: Deploy Preview without changing Production**

If Vercel Preview authentication blocks automation, use the isolated GitHub Runner as the pre-production gate, as in v0.7.

- [ ] **Step 3: Promote identical files to Production**

Keep explicit static entries for `/studio`, `/showcase`, `/capture`, and `/compare`.

- [ ] **Step 4: Run public-domain speech acceptance**

Use the browser speech mock for deterministic API verification and separately confirm the real browser API is present when supported. Do not claim audible output from a headless runner.

- [ ] **Step 5: Run v0.7 Production regression**

Existing route, blink, mouth, autoplay, URL, background, and deterministic Capture gates must pass.

- [ ] **Step 6: Write release record and open PR**

Include deployment ID, immutable commit, workflow run IDs, screenshot hashes, limitations, rollback ID, and explicit statement that no microphone/recording/voiceprint functionality exists.
