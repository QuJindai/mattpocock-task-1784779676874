# Avatar Showcase v0.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a public v0.7 showcase that keeps pre-generated frame blending as the default renderer while introducing a renderer-neutral contract for future Live2D/3D implementations.

**Architecture:** A renderer-agnostic controller emits semantic state, expression, lip-sync, look-target, and timing commands through `AvatarRenderer`. `FrameBlendRenderer` implements the contract with PixiJS, a baked transparent frame manifest, deterministic timelines, and layered scene composition. Studio, Showcase, Capture, URL persistence, and acceptance tests depend only on the contract and shared state.

**Tech Stack:** Native ES modules, PixiJS 8, Node.js 22 built-in test runner, Sharp for frame baking, Playwright, GitHub Actions, Vercel, Supabase Edge Function.

## Global Constraints

- Do not modify the legacy `vrm-showcase-lab` code, deployment, domain, or behavior.
- Keep `FrameBlendRenderer` as the v0.7 default implementation.
- Do not introduce Live2D/3D as a runtime dependency in v0.7.
- Work only on branch `avatar-showcase-v0.7` until Preview acceptance passes.
- Preserve `/studio`, `/compare`, `/capture`, screenshot artifacts, browser logs, and fail-closed acceptance.
- Add `/showcase` as a full-screen no-control-panel route.
- Restore all supported URL parameters after refresh.
- GPU runtime remains a frame-baking dependency, not a playback dependency.
- Production deployment occurs only after Preview E2E passes.

---

### Task 1: Renderer Contract and Shared Types

**Files:**
- Create: `avatar-v07/src/avatar-renderer.js`
- Create: `avatar-v07/src/avatar-types.js`
- Test: `avatar-v07/tests/avatar-renderer.test.mjs`

**Interfaces:**
- Produces: `assertAvatarRenderer(renderer)`, `AVATAR_STATES`, `EXPRESSION_STATES`, `normalizeRendererState(input)`.
- Consumes: none.

- [ ] **Step 1: Write the failing contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAvatarRenderer } from '../src/avatar-renderer.js';

const methods = [
  'mount', 'loadCharacter', 'setState', 'setExpression', 'setLipSync',
  'setLookTarget', 'update', 'capture', 'resize', 'destroy',
];

test('rejects a renderer missing contract methods', () => {
  assert.throws(() => assertAvatarRenderer({ mount() {} }), /loadCharacter/);
});

test('accepts a complete renderer', () => {
  const renderer = Object.fromEntries(methods.map((name) => [name, () => {}]));
  assert.equal(assertAvatarRenderer(renderer), renderer);
});
```

- [ ] **Step 2: Run the test and verify red**

Run: `node --test avatar-v07/tests/avatar-renderer.test.mjs`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the contract and normalized semantic types**

`assertAvatarRenderer` must enumerate the exact methods above and throw a descriptive `TypeError` for the first missing method. `normalizeRendererState` must coerce unknown states to `idle` and unknown expressions to `neutral`.

- [ ] **Step 4: Run the test and verify green**

Run: `node --test avatar-v07/tests/avatar-renderer.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add avatar-v07/src/avatar-renderer.js avatar-v07/src/avatar-types.js avatar-v07/tests/avatar-renderer.test.mjs
git commit -m "feat: define avatar renderer contract"
```

### Task 2: URL State and Deterministic Clock

**Files:**
- Create: `avatar-v07/src/url-state.js`
- Create: `avatar-v07/src/deterministic-clock.js`
- Test: `avatar-v07/tests/url-state.test.mjs`
- Test: `avatar-v07/tests/deterministic-clock.test.mjs`

**Interfaces:**
- Produces: `parseUrlState(search)`, `serializeUrlState(state)`, `DeterministicClock`.
- Consumes: `normalizeRendererState` from Task 1.

- [ ] **Step 1: Write failing URL tests**

```js
test('restores supported values and clamps numbers', () => {
  const state = parseUrlState('?state=talk&expression=happy&autoplay=0&scale=9&x=-2');
  assert.deepEqual(state, {
    renderer: 'frame-blend', character: 'formal-v1', state: 'talk',
    expression: 'happy', autoplay: false, scale: 1.5, x: -1,
    y: 0, warmth: 0.72, blur: 4, parallax: 0.08, exposure: 1,
  });
});
```

- [ ] **Step 2: Write failing deterministic clock tests**

```js
test('advances only when tick is called', () => {
  const clock = new DeterministicClock(1000);
  assert.equal(clock.now(), 1000);
  clock.tick(250);
  assert.equal(clock.now(), 1250);
});
```

- [ ] **Step 3: Run both tests and verify red**

Run: `node --test avatar-v07/tests/url-state.test.mjs avatar-v07/tests/deterministic-clock.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement parsers, clamping, serialization, and deterministic timing**

The serializer must omit defaults only when omission does not alter refresh restoration. `capture` mode must be able to set a fixed clock time from `time=<milliseconds>`.

- [ ] **Step 5: Run tests and verify green**

Run: `node --test avatar-v07/tests/url-state.test.mjs avatar-v07/tests/deterministic-clock.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/src/url-state.js avatar-v07/src/deterministic-clock.js avatar-v07/tests
git commit -m "feat: add deterministic URL state"
```

### Task 3: Bake Transparent Semantic Frames

**Files:**
- Create: `avatar-v07/scripts/bake-frames.mjs`
- Create: `avatar-v07/scripts/verify-frames.mjs`
- Create: `avatar-v07/frame-presets.json`
- Create: `.github/workflows/avatar-v07-bake.yml`
- Generated: `avatar-v07/public/frames/formal-v1/*.webp`
- Generated: `avatar-v07/public/frames/formal-v1/manifest.json`
- Test: `avatar-v07/tests/frame-manifest.test.mjs`

**Interfaces:**
- Produces: manifest schema `{version, characterId, width, height, frames, sourceSha256}`.
- Consumes: `avatar-motion-runtime` asset and expression endpoints.

- [ ] **Step 1: Write a failing manifest contract test**

The test must require all eight frame IDs, matching dimensions, `hasAlpha=true`, non-empty SHA-256 values, and distinct hashes for `idle-open`, `blink-closed`, and `mouth-a`.

- [ ] **Step 2: Run the test and verify red**

Run: `node --test avatar-v07/tests/frame-manifest.test.mjs`
Expected: FAIL because the manifest is absent.

- [ ] **Step 3: Implement the frame baker**

The baker must:

1. GET `?asset=character` with Origin `https://avatar-showcase-lab.vercel.app`.
2. POST each expression preset to the runtime.
3. Use Sharp to resize generated RGB to source dimensions.
4. Extract the source alpha channel and attach it to each generated frame.
5. Write lossless WebP or quality 92 WebP with alpha.
6. Record SHA-256 and pixel-difference metrics.
7. Hard-fail if a required semantic frame is identical to its comparison frame.

- [ ] **Step 4: Add fail-closed workflow**

The workflow runs only on branch `avatar-showcase-v0.7`, installs Sharp, bakes frames, verifies the manifest, commits generated assets with `[skip ci]`, and uploads the bake report even on failure.

- [ ] **Step 5: Run the cloud bake and inspect images**

Expected: eight transparent frames, all 1344×1728, with visible blink/mouth/expression differences.

- [ ] **Step 6: Run manifest tests and verify green**

Run: `node --test avatar-v07/tests/frame-manifest.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add avatar-v07/scripts avatar-v07/frame-presets.json avatar-v07/public/frames avatar-v07/tests/frame-manifest.test.mjs .github/workflows/avatar-v07-bake.yml
git commit -m "feat: bake semantic avatar frames"
```

### Task 4: FrameBlendRenderer

**Files:**
- Create: `avatar-v07/src/frame-blend-renderer.js`
- Create: `avatar-v07/src/frame-sequence.js`
- Test: `avatar-v07/tests/frame-sequence.test.mjs`
- Test: `avatar-v07/tests/frame-blend-renderer.test.mjs`

**Interfaces:**
- Produces: `FrameBlendRenderer`, `buildBlinkSequence()`, `buildTalkSequence(lipValue)`.
- Consumes: Tasks 1–3.

- [ ] **Step 1: Write failing sequence tests**

```js
test('blink sequence is open-half-closed-half-open', () => {
  assert.deepEqual(buildBlinkSequence().map((x) => x.frame), [
    'idle-open', 'blink-half', 'blink-closed', 'blink-half', 'idle-open',
  ]);
});
```

The talk test must prove at least three mouth frames are used over a full cycle.

- [ ] **Step 2: Write a renderer lifecycle test with a fake Pixi adapter**

The test must verify `mount → loadCharacter → setState → update → capture → destroy` without referencing browser globals directly.

- [ ] **Step 3: Run tests and verify red**

Run: `node --test avatar-v07/tests/frame-sequence.test.mjs avatar-v07/tests/frame-blend-renderer.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement renderer with an injected graphics adapter**

Use two character layers for cross-fade, one shadow layer, and one transform container. `update(deltaMs)` must apply breathing, shoulder rotation, look target, current semantic frame, and transition opacity. Renderer code must not read URL parameters or DOM controls.

- [ ] **Step 5: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/src/frame-blend-renderer.js avatar-v07/src/frame-sequence.js avatar-v07/tests
git commit -m "feat: implement frame blend avatar renderer"
```

### Task 5: Renderer-Agnostic Controller and Showcase Timeline

**Files:**
- Create: `avatar-v07/src/avatar-controller.js`
- Create: `avatar-v07/src/showcase-timeline.js`
- Test: `avatar-v07/tests/avatar-controller.test.mjs`
- Test: `avatar-v07/tests/showcase-timeline.test.mjs`

**Interfaces:**
- Produces: `AvatarController`, `ShowcaseTimeline`.
- Consumes: Tasks 1, 2, and 4.

- [ ] **Step 1: Write failing state forwarding tests**

A fake renderer must receive semantic calls without access to Pixi objects. Verify autoplay sequence covers `idle`, `happy`, `listen`, and `talk` within 30 seconds.

- [ ] **Step 2: Write pause-on-interaction tests**

The timeline must pause for exactly 5000ms after interaction and resume from the current phase.

- [ ] **Step 3: Run tests and verify red**

Run: `node --test avatar-v07/tests/avatar-controller.test.mjs avatar-v07/tests/showcase-timeline.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement minimal controller and timeline**

The controller owns semantic state only. The timeline owns phase durations, blink scheduling, and talk lip values. Exceptions must return the renderer to `idle` and disable autoplay.

- [ ] **Step 5: Run tests and verify green**

Run: same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add avatar-v07/src/avatar-controller.js avatar-v07/src/showcase-timeline.js avatar-v07/tests
git commit -m "feat: add renderer neutral avatar controller"
```

### Task 6: Static App, Routes, and Layered Scene

**Files:**
- Create: `avatar-v07/index.html`
- Create: `avatar-v07/styles.css`
- Create: `avatar-v07/src/app.js`
- Create: `avatar-v07/src/pixi-adapter.js`
- Create: `avatar-v07/vercel.json`
- Test: `avatar-v07/tests/app-contract.test.mjs`

**Interfaces:**
- Produces: `/studio`, `/showcase`, `/capture`, `/compare` behavior from a single static app.
- Consumes: Tasks 1–5.

- [ ] **Step 1: Write failing HTML and route contract tests**

The tests must require:

- one `canvas.stage`;
- a Studio panel only on `/studio`;
- no `.studio-panel` on `/showcase` and `/capture`;
- foreground occlusion and bokeh layers;
- `window.__avatarLab.rendererKind === 'frame-blend'`;
- deterministic `time` support in Capture.

- [ ] **Step 2: Run contract tests and verify red**

Run: `node --test avatar-v07/tests/app-contract.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement the app**

`app.js` must parse URL state, instantiate the renderer through a factory, mount scene layers, load the manifest, start the appropriate route behavior, and expose test-safe diagnostics at `window.__avatarLab` without exposing internal Pixi objects.

- [ ] **Step 4: Run all unit and contract tests**

Run: `node --test avatar-v07/tests/*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add avatar-v07/index.html avatar-v07/styles.css avatar-v07/src avatar-v07/vercel.json avatar-v07/tests
git commit -m "feat: add v0.7 showcase application"
```

### Task 7: Cloud Acceptance and Preview Deployment

**Files:**
- Create: `avatar-v07/scripts/cloud-acceptance.mjs`
- Create: `.github/workflows/avatar-v07-acceptance.yml`
- Modify: `avatar-v07/vercel.json`

**Interfaces:**
- Produces: screenshots, `results.json`, `browser.log`, frame diagnostic JSON.
- Consumes: all prior tasks.

- [ ] **Step 1: Write fail-closed Playwright acceptance**

It must capture:

- `01-showcase-idle.png`
- `02-showcase-happy.png`
- `03-showcase-listen.png`
- `04-showcase-talk.png`
- `05-capture-fixed-time.png`
- `06-studio.png`

Hard failures include missing route, missing frames, identical semantic screenshots, no blink/talk transitions, URL restore mismatch, page errors, fatal resource failures, or visible Studio panel in Showcase.

- [ ] **Step 2: Deploy a separate Vercel Preview from `avatar-showcase-v0.7`**

Do not alter Production aliases.

- [ ] **Step 3: Run Preview E2E and inspect Artifact images**

Expected: all six screenshots valid, no fatal errors, automatic cycle observed, deterministic capture hash stable across two runs.

- [ ] **Step 4: Commit acceptance workflow**

```bash
git add avatar-v07/scripts/cloud-acceptance.mjs .github/workflows/avatar-v07-acceptance.yml avatar-v07/vercel.json
git commit -m "test: add v0.7 cloud acceptance"
```

### Task 8: Production Promotion and Regression Gate

**Files:**
- Modify: `.github/workflows/avatar-v07-acceptance.yml`
- Create: `docs/avatar-showcase-v07-release.md`

**Interfaces:**
- Produces: verified Production deployment and rollback record.
- Consumes: Task 7 Preview evidence.

- [ ] **Step 1: Compare Preview against current v0.6.2 baseline**

Record canvas hashes and visible differences. Confirm the old `vrm-showcase-lab` project has no deployment or commit changes.

- [ ] **Step 2: Promote identical files to `avatar-showcase-lab` Production**

Do not rebuild from a different source tree.

- [ ] **Step 3: Run Production E2E**

Expected: same hard gates as Preview and public fixed URL HTTP 200.

- [ ] **Step 4: Write release record**

Include deployment ID, workflow run ID, frame manifest SHA, screenshot hashes, runtime security status, known visual limitations, and rollback deployment ID.

- [ ] **Step 5: Commit and open PR**

```bash
git add .github/workflows/avatar-v07-acceptance.yml docs/avatar-showcase-v07-release.md
git commit -m "release: verify avatar showcase v0.7"
git push origin avatar-showcase-v0.7
```

Open a PR from `avatar-showcase-v0.7` to `avatar-showcase-lab`; do not merge until Production evidence is attached.
