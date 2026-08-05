# Avatar Showcase Lab v0.7 Release Record

## Release Status

```text
ENGINEERING_E2E: PASS
VISUAL_BASELINE: PASS
TARGET_CONVERGENCE: PARTIAL
```

Release date: 2026-08-05

Public application:

- Studio: https://avatar-showcase-lab.vercel.app/studio
- Showcase: https://avatar-showcase-lab.vercel.app/showcase
- Capture: https://avatar-showcase-lab.vercel.app/capture
- Compare: https://avatar-showcase-lab.vercel.app/compare

The legacy `vrm-showcase-lab` project was not modified or redeployed as part of this release.

## Architecture Boundary

v0.7 introduces a renderer-neutral `AvatarRenderer` contract. The current implementation is `FrameBlendRenderer`, which consumes baked transparent frames and semantic state. Future `Live2DRenderer` or `VrmRenderer` implementations can replace the character renderer without replacing the scene, routes, URL state, voice/event integration, capture pipeline, or acceptance tests.

## Production Deployment

- Vercel project: `avatar-showcase-lab`
- Deployment ID: `dpl_75kVLt2N2qkX2hmiJrNifXt24qEZ`
- Final deployment files use explicit static route entries for `/studio`, `/showcase`, `/capture`, and `/compare`.
- Immutable application asset commit: `b7ecb5ea48f8b50ada8e1b92bbf596208e9fef98`
- Branch: `avatar-showcase-v0.7`
- Rollback deployment for v0.6.2: `dpl_Ga5QeHCJt71BAp6XW3ERAXp1PHkm`

## Verification Evidence

### Unit and contract tests

- Workflow: `Avatar v0.7 Unit Contracts`
- Run ID: `31000730126`
- Result: PASS
- Coverage includes renderer contract, semantic normalization, URL restore, deterministic clock, frame delta handling, blink/talk sequences, renderer lifecycle, autoplay timeline, interaction pause, fallback behavior, routes, layered scene, and renderer factory isolation.

### Isolated cloud browser acceptance

- Workflow: `Avatar v0.7 Isolated Cloud Acceptance`
- Run ID: `31000729916`
- Result: PASS
- Purpose: execute the exact branch files in a clean GitHub Runner without Vercel Preview authentication interference.

### Production public-domain acceptance

- Workflow: `Avatar v0.7 Production Acceptance`
- Run ID: `31001058666`
- Result: PASS
- Public base URL: `https://avatar-showcase-lab.vercel.app`
- Expected asset commit: `b7ecb5ea48f8b50ada8e1b92bbf596208e9fef98`
- Artifact ID: `8928314482`
- Artifact SHA-256: `7c2432d664290b238e155568ed3bc9e815daa1962f7e37b8ef68fdb46d76559b`
- Fatal browser errors: 0

The only browser log messages were repeated WebGL `ReadPixels` performance warnings caused by automated screenshots. They did not affect correctness.

## Formal Frame Manifest

- Character ID: `formal-v1`
- Dimensions: 1344×1728
- Alpha retained: yes, all required frames
- Source SHA-256: `057411c2cfe595f2bb12a32a4a59ad04e014b2acf2a33d8c8c2f90cda567b0b1`
- Generated at: `2026-08-05T10:34:13.106Z`

| Frame | Expression basis | SHA-256 |
|---|---|---|
| `idle-open` | neutral/open | `482818da955300d54a18c818b66132d3f6923d21bcf720e4e25bf9ed98cf0be6` |
| `blink-half` | blink `-10` | `11339e921d6aeb6ceea36a9ac437e567343fe75d4746e580887f1e787494c778` |
| `blink-closed` | blink `-20` | `8ad49492a55332e06797c32b40f2d1ca34857b8d7008d2c3118dfd4f8e2b2368` |
| `happy` | smile `0.78` | `250028aa64d30d7d63d04597418a759674a5315b6ddd31c78b5a3e19e4aeb9f3` |
| `listen` | yaw `8`, pitch `-3` | `cde0bf2e9e140a1e15b95edbcaa7669398a37d91862cfde0c483d60ab84f62b5` |
| `mouth-a` | `aaa=42` | `3c87f4d6cd320689712cfd21e6531c007f85aefc5ecb0079c990d26ae126e843` |
| `mouth-e` | `eee=12` | `da0c721c2600a8fda1386b366fc12af25133e67ee9f27047485fe4c2b0161146` |
| `mouth-u` | `woo=12` | `46f320f32be4b4dd7f326847f1fb168e77a77d5e78fb34d01a539e509adc4915` |

## Production Screenshot Evidence

| Scene | SHA-256 |
|---|---|
| Idle showcase | `8aae9bb808b5cd759cf840aa00a23d47b2353e987cf3642bf7d473092b06cc62` |
| Happy showcase | `8f46f07bca28870c4cb8cfa918e191277f30898755343396fdb27f5e5e3e4499` |
| Listening showcase | `cbd4af44c97202e550e11d08b9bb1c8307583b417610e5204b7df89dcba655b1` |
| Talking showcase | `7f2c7948d5e2cc144ebd9a09ca5b8238838da04292d2e44a66ad74b667999312` |
| Deterministic capture | `8f6746ce737eeb5b0793d834904f39662f0fc4bfc961fb0a290d174fc7f88044` |
| Studio | `6a154bce10c9dc1672c24f2d30ea8d804a8575439576bdf4b8b337a8533970c7` |

Two independent screenshots of the same Capture URL produced the exact same SHA-256.

## Acceptance Gates Passed

1. Public `/studio`, `/showcase`, `/capture`, and `/compare` routes return the application.
2. `AvatarRenderer` exposes the complete renderer-neutral lifecycle.
3. `FrameBlendRenderer` loads all eight formal transparent semantic frames.
4. Showcase hides Studio controls.
5. Capture hides Studio controls and animated bokeh.
6. Blink sequence reaches `blink-half` and `blink-closed` at deterministic timestamps.
7. Talk playback observes `mouth-a`, `mouth-e`, and `mouth-u`.
8. Idle, happy, listening, and talking screenshots are distinct.
9. Autoplay reaches `idle`, `happy`, `listen`, and `talk` in one cycle.
10. URL parameters survive a full page reload.
11. Capture is deterministic across repeated runs.
12. Formal background loads without degraded mode.
13. No fatal page errors or required-resource failures occurred.

## Runtime Security Status

Supabase Edge Function `avatar-motion-runtime` is configured with custom application-layer controls:

- exact Production origin allowlist;
- Preview-domain pattern restriction;
- malicious origin rejection with HTTP 403;
- 30 requests per 10-minute in-memory limit;
- request and output size limits;
- allowed-method checks;
- 90-second processing timeout;
- formal asset caching.

This remains a prototype security boundary. Origin headers and in-memory rate limits do not replace authenticated users, durable quotas, abuse detection, or billing controls.

## Known Limitations

- The body pose still comes from one formal source illustration. v0.7 animates face state, frame transitions, breathing, shoulder sway, look target, and scene parallax rather than full-body skeletal motion.
- Lip-sync is a deterministic three-mouth animation, not phoneme-aligned TTS yet.
- The first load fetches PixiJS and immutable application assets from public CDNs.
- The Studio interface is an engineering control surface, not a final consumer interface.
- The apartment background is a single high-resolution image plus layered visual effects, not a navigable 3D room.
- Live2D and VRM implementations are not included in v0.7; they are future renderers behind the same contract.

## Next Recommended Milestone

v0.8 should consume real TTS timing and map phoneme/energy events to `setLipSync()`, add prefetch and offline fallback for immutable assets, and expose a renderer capability descriptor so a future Live2D implementation can be introduced without altering semantic state or route behavior.
