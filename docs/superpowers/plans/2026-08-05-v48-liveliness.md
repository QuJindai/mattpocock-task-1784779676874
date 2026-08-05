# V4.8 Liveliness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic natural micro-motion to the approved V4.7 scene without regressing its static visual baseline.

**Architecture:** A Python builder reconstructs the immutable V4.7 payload and replaces only the runtime motion block. A Playwright time-series probe validates motion ranges and smoothness, while the existing visual acceptance logic validates composition, wave, closeup, loading, and atmosphere.

**Tech Stack:** Python 3, browser JavaScript, Three.js, @pixiv/three-vrm, Playwright, GitHub Actions, Vercel.

## Global Constraints

- Work on `feature/v48-liveliness` until Preview passes.
- Keep V4.7 poses, material tuning, fit/frame logic, CSS, camera, and model URL byte-identical.
- Build ID: `visual-avatar-a-v4-8-20260805`.
- First blink before 2.4 seconds; later intervals 2.2–5.4 seconds.
- No direct hair-bone rotations.
- Production deploy only after Preview and manual screenshot review.

---

### Task 1: Builder and source lock

**Files:**
- Create: `v48-build.py`
- Create: `v48-build.test.py`

- [ ] Reconstruct V4.7 from `payloads/v47/payload-*.txt`.
- [ ] Write failing assertions for the V4.8 build ID, diagnostics object, blink scheduler, gaze damper, and SpringBone report.
- [ ] Implement exact replacements for build ID, runtime state, publish function, animate function, and pointer timestamp.
- [ ] Hash and compare frozen V4.7 source blocks.
- [ ] Run `python -m unittest v48-build.test.py -v`.

### Task 2: Runtime time-series gate

**Files:**
- Create: `v48-liveliness-smoke.mjs`
- Create: `.github/workflows/v48-preview.yml`

- [ ] Start a local server for the generated V4.8 candidate.
- [ ] Record 8 seconds of chest, hips, shoulders, head, gaze, blink, and SpringBone diagnostics.
- [ ] Inject pointer movement and assert damped response with no snap.
- [ ] Assert non-zero motion within the design limits.
- [ ] Capture idle, wave, and closeup screenshots and retain evidence on failure.

### Task 3: Visual regression gate

**Files:**
- Modify: `v48-liveliness-smoke.mjs`

- [ ] Validate model load under 30 seconds.
- [ ] Validate avatar bounds and average luma.
- [ ] Validate natural wave elbow and hand position.
- [ ] Validate closeup shoulder, torso, and pixel enlargement.
- [ ] Compare material and atmosphere reports with V4.7 tolerances.

### Task 4: Immutable payload and Production

**Files:**
- Create: `payloads/v48/payload-*.txt`
- Create: `payloads/v48/metadata.json`
- Create: `v48-production-acceptance.mjs`
- Create: `.github/workflows/v48-production-acceptance.yml`

- [ ] Compress and split the approved candidate into chunks no larger than 2400 characters.
- [ ] Record per-chunk and aggregate SHA-256 values.
- [ ] Deploy a small Vercel loader pinned to the immutable payload commit.
- [ ] Run the same time-series and visual gates against the fixed public URL.
- [ ] Download and manually inspect the final Artifact before declaring V4.8 complete.
