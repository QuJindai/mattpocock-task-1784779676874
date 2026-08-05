# V4.8 Liveliness Design

## Goal

Increase perceived life and natural motion without changing the approved V4.7 avatar, materials, room, camera, framing, action poses, or visual composition.

## Approved scope

- Replace the fixed 5.2-second blink with deterministic irregular intervals and an occasional double blink.
- Replace single-frequency breathing with a low-amplitude dual-harmonic cycle.
- Add asymmetric shoulder and neck micro-motion below visible gesture scale.
- Add autonomous gaze drift when the pointer is inactive and damped pointer tracking when active.
- Drive existing VRM SpringBone motion through subtle head movement; do not rotate hair bones directly.
- Publish a live `v48` diagnostics object through `window.__vrmLab`.

## Frozen V4.7 baseline

The following source blocks must remain byte-identical:

- `const poses=...`
- `function fit()`
- `function frame()`
- V4.7 MToon material tuning
- night-apartment CSS and camera defaults

Only the build identifier, runtime motion state, `publish`, `animate`, and pointer timestamp handling may change.

## Motion limits

- Chest breathing rotation: peak absolute target no more than `0.022 rad`.
- Hip vertical motion: peak absolute target no more than `0.006 m`.
- Shoulder micro-rotation: peak absolute target no more than `0.018 rad`.
- Autonomous head yaw: peak target no more than `0.045 rad`.
- Pointer-driven head yaw: peak target no more than `0.14 rad`.
- Frame-to-frame head yaw step in the cloud test: below `0.035 rad`.
- Blink interval: deterministic range `2.2–5.4 s`; first blink before `2.4 s`.

## Verification

1. Static source test proves frozen V4.7 blocks are unchanged.
2. Runtime time-series test records at least 8 seconds of motion.
3. At least one full blink is observed, with non-periodic scheduling reported.
4. Breathing, shoulders, and head motion are non-zero and remain under safety limits.
5. Pointer tracking changes gaze smoothly rather than snapping.
6. SpringBone manager is present and receives continuous `vrm.update(dt)` frames.
7. V4.7 visual bounds, luma, natural wave, and closeup gates remain green.
8. Production is updated only after Preview evidence and manual screenshot review pass.
