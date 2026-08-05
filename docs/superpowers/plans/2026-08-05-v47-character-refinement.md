# V4.7 Character Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select and deploy a V4.7 Avatar A material-and-integration refinement that improves face depth, brown hair, cream cardigan, character separation, and background depth without changing the V4.6 model, actions, or framing.

**Architecture:** Reconstruct the immutable V4.6 HTML from `payloads/v46`, generate three deterministic HTML candidates, run them under the same local HTTP server and Chrome environment, compare screenshots and metrics, then package the selected candidate as an immutable Production payload.

**Tech Stack:** GitHub Actions, Node.js 22, Playwright, Chromium, Three.js 0.180, `@pixiv/three-vrm` 3.5.3, Python 3, PNGJS.

## Global Constraints

- Default model remains `AvatarSample_A.vrm`.
- Do not modify action pose constants or framing calculations.
- Do not weaken existing 30-second loading, natural-wave, close-up, night-atmosphere, or page-error gates.
- Production changes require both automated pass and manual screenshot review.
- V4.6 immutable payload remains the rollback source.

---

### Task 1: Candidate page generator

**Files:**
- Create: `v47-build-candidates.py`
- Test: `v47-build-candidates.test.py`

**Interfaces:**
- Consumes: `payloads/v46/payload-1.txt` through `payload-5.txt`.
- Produces: `v47-site/a.html`, `v47-site/b.html`, `v47-site/c.html`, each with a distinct `buildId` and `window.__v47Report`.

- [ ] Write a failing test that reconstructs V4.6, invokes the generator, and asserts candidate build IDs, unchanged pose/framing source hashes, and candidate-specific refinement markers.
- [ ] Run `python v47-build-candidates.test.py` and confirm failure before implementation.
- [ ] Implement immutable payload reconstruction, MToon candidate patches, browser-side texture recoloring for B/C, and depth/contact CSS for C.
- [ ] Run `python v47-build-candidates.test.py` and confirm PASS.
- [ ] Commit generator and test.

### Task 2: Visual bake-off runner

**Files:**
- Create: `v47-visual-bakeoff.mjs`
- Create: `.github/workflows/v47-visual-bakeoff.yml`

**Interfaces:**
- Consumes: generated candidate pages from Task 1.
- Produces: `v47-visual-bakeoff/{a,b,c}-{idle,closeup}.png`, `metrics.json`, `browser.log`.

- [ ] Write the runner to load each candidate with `mode=capture`, wait for `角色已就绪` within 30 seconds, and record page/request failures.
- [ ] Capture idle and close-up screenshots at 1600×900.
- [ ] Measure face luminance contrast, hair brown/purple ratios, cardigan cream/pink ratios, background edge energy, and character pixel bounds.
- [ ] Fail when any candidate violates existing functional gates; preserve all evidence with `if: always()`.
- [ ] Run the workflow and download the artifact.
- [ ] Commit runner and workflow.

### Task 3: Candidate selection and selected-page regression

**Files:**
- Create: `v47-selected-smoke.mjs`
- Create: `.github/workflows/v47-selected-preview.yml`

**Interfaces:**
- Consumes: selected candidate identifier from visual review.
- Produces: selected idle, wave, and close-up screenshots plus material and geometry metrics.

- [ ] Record the selected candidate in the workflow environment.
- [ ] Assert the selected build ID, Avatar A URL, MToon properties, texture-refinement markers, and integration markers.
- [ ] Re-run idle, natural wave, and close-up gates without changed thresholds.
- [ ] Upload screenshots, results, source HTML, and server log.
- [ ] Commit selected Preview workflow.

### Task 4: Immutable V4.7 Production payload

**Files:**
- Create: `payloads/v47/payload-1.txt` through `payload-N.txt`
- Create: `payloads/v47/metadata.json`
- Create: `v47-production-acceptance.mjs`
- Create: `.github/workflows/v47-production-acceptance.yml`

**Interfaces:**
- Consumes: selected and approved candidate HTML.
- Produces: immutable payload metadata and Production evidence artifact.

- [ ] Compress and base64-encode selected HTML, split it into bounded text blocks, and record total length and SHA-256.
- [ ] Verify block reassembly reproduces the exact selected HTML hash.
- [ ] Deploy a small Vercel loader that fetches a fixed commit, verifies length/SHA/build ID, and then executes the page.
- [ ] Run Production acceptance against `https://vrm-showcase-lab.vercel.app`.
- [ ] Verify 30-second readiness, material report, night atmosphere, natural wave, close-up magnification, scene differences, and zero fatal errors.
- [ ] Download and manually review the Production artifact.
- [ ] Commit payload metadata and acceptance workflow.
