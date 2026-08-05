# Avatar Showcase Lab v0.8 Release Record

## Release Status

```text
BROWSER_TTS_E2E: PASS
V0.7_VISUAL_REGRESSION: PASS
ENGINEERING_E2E: PASS
TARGET_CONVERGENCE: PARTIAL
```

Release date: 2026-08-05

Public application:

- Studio: https://avatar-showcase-lab.vercel.app/studio
- Showcase: https://avatar-showcase-lab.vercel.app/showcase
- Capture: https://avatar-showcase-lab.vercel.app/capture
- Compare: https://avatar-showcase-lab.vercel.app/compare

The legacy `vrm-showcase-lab` project was not modified or redeployed.

## Confirmed Product Scope

v0.8 uses only browser-native `speechSynthesis` and `SpeechSynthesisUtterance`.

It does **not** include:

- cloud TTS;
- TTS API keys;
- microphone access;
- audio recording or upload;
- voiceprint collection;
- voice cloning;
- speaker recognition.

## Architecture

New renderer-neutral components:

- `BrowserSpeechEngine`: wraps browser speech synthesis behind an injectable adapter;
- `SpeechAvatarBridge`: maps speech events into semantic avatar state and lip-sync values;
- `renderer-capabilities.js`: describes speech and lip-sync support without coupling callers to PixiJS;
- `mouth-timeline.js`: deterministic mouth fallback for browsers without useful boundary events.

Existing v0.7 `AvatarRenderer`, `AvatarController`, `FrameBlendRenderer`, scene composition, routes, URL state, and Capture remain compatible.

## Production Deployment

- Vercel project: `avatar-showcase-lab`
- Deployment ID: `dpl_EM7gCQALMgru9suet37F99EiZnHS`
- Immutable application commit: `e389671e01dc3226d164e21a1d09e410efd587d4`
- Development branch: `avatar-showcase-v0.8`
- v0.7 rollback deployment: `dpl_75kVLt2N2qkX2hmiJrNifXt24qEZ`
- v0.6.2 rollback deployment: `dpl_Ga5QeHCJt71BAp6XW3ERAXp1PHkm`

Each public route is an explicit static HTML entry pinned to the same immutable application commit.

## Verification Evidence

### Unit and contract tests

- Workflow: `Avatar v0.8 Unit Contracts`
- Run ID: `31026820512`
- Result: PASS

Coverage includes:

- speech option normalization and limits;
- Chinese voice selection priority;
- unsupported-browser detection;
- utterance lifecycle and single-settlement behavior;
- start, boundary, end, error, cancel, and destroy handling;
- deterministic fallback mouth timing;
- queued rapid boundary cues with a 260ms minimum hold;
- prior-state restoration;
- browser speech URL fields;
- renderer capabilities;
- no microphone, recording, or voiceprint interfaces;
- all existing v0.7 renderer and timeline contracts.

### Isolated cloud acceptance

- Workflow: `Avatar v0.8 Isolated Acceptance`
- Run ID: `31026820398`
- Result: PASS
- Artifact ID: `8939032867`
- Artifact SHA-256: `fb953f0ab8b4944a44a084398854f41d8ff997dc7da08c7852d718114da9ed1b`

This gate ran browser speech acceptance followed by the complete v0.7 visual regression in a clean GitHub Runner.

### Public Production acceptance

- Workflow: `Avatar v0.8 Production Acceptance`
- Run ID: `31027416973`
- Result: PASS
- Public base URL: `https://avatar-showcase-lab.vercel.app`
- Expected immutable commit: `e389671e01dc3226d164e21a1d09e410efd587d4`
- Artifact ID: `8939275767`
- Artifact SHA-256: `695d72bfad783162e99be41815ce18db89fd52042b73f7bf20b5f699ed92afd5`

## Browser Speech Evidence

The Production browser-level mock supplied two Chinese voices and exercised the real application through standard Web Speech API surfaces.

Applied utterance settings:

- voice: `zh-local`;
- language: `zh-CN`;
- rate: `1.25`;
- pitch: `1.1`;
- volume: `0.7`.

Observed lip-sync values:

```text
0.20 → 0.88 → 0.52 → 0.24
```

Observed semantic frames:

```text
mouth-u → mouth-a → mouth-e
```

Verified lifecycle:

1. `speak()` called;
2. avatar enters `talk` and `soft-smile`;
3. browser boundary events enter the cue queue;
4. A/E/U mouth cues are displayed for a minimum stable interval;
5. `end` restores the prior state;
6. `stop()` causes cancellation and restores the prior state;
7. spoken text is never written to the URL;
8. voice, rate, pitch, and volume survive reload;
9. unsupported browsers disable only speech and do not degrade the renderer.

## Production Speech Screenshot Hashes

| Scene | SHA-256 |
|---|---|
| Speaking | `e2719bb2d8f9b308976838fe287aba54592370a29967954f0f3f0c56ce0ac776` |
| Completed | `721eee45250eb374e027574300190a81f36b976371469595fff3925c0d4e10fb` |
| Stopped | `96b9649876f3d762a93608b6decc89c10dacad37f0e253b3874e978ec0daeeed` |
| Showcase without controls | `a55fb6961c7c7d4cf7b6a471ba5983fa34229c62a2d4120dbb63014e4079eac6` |
| Unsupported-browser state | `45762248a9c3c528c2baae593e9ec73b74186e168552eecfacd2d49fc71d903d` |

## v0.7 Visual Regression Evidence

All v0.7 gates remained active and passed after adding browser speech.

| Scene | SHA-256 |
|---|---|
| Idle | `4065316caae2696e0f92e76496795a8bea806bf6626411d5d6312a5444106169` |
| Happy | `efdb148bf752a7d718580db79c87a082d5832722cd22391210bab8eace840fea` |
| Listen | `530ff42dc4839092ad86348b9740b6c775e9e72507e26e72990c7e3da953b115` |
| Talk | `b613b1a65f3c67e3cc63db33193552518c8b677eeec6bf649de54585e46eddd7` |
| Studio | `d08cf42c0d0bfa21914f3b0ea13b731810be3efa0ec26be89b57c0b81d7236a1` |

Deterministic Capture SHA-256 remained unchanged from v0.7:

```text
8f6746ce737eeb5b0793d834904f39662f0fc4bfc961fb0a290d174fc7f88044
```

Blink still reaches `blink-half` and `blink-closed`; autoplay still covers `idle`, `happy`, `listen`, and `talk`.

## Public API

```js
window.__avatarLab.speech.supported
window.__avatarLab.speech.speaking
window.__avatarLab.speech.voices
window.__avatarLab.speech.speak(text, options)
window.__avatarLab.speech.stop()
window.__avatarLab.speech.refreshVoices()
window.__avatarLab.speak(text, options)
window.__avatarLab.stopSpeaking()
```

## Real-Device Limitation

Automated browsers prove API invocation, utterance parameters, event handling, state transitions, and visual mouth movement. They do not prove that a human listener hears audio through a headless runner.

Actual sound quality and available voices depend on the operating system, browser, installed language packs, and device. The Studio displays the voices returned by the user's own browser.

## Known Limitations

- Web Speech API boundary events vary by browser and voice.
- Mouth movement is stable A/E/U semantic animation, not professional phoneme-level lip synchronization.
- Some mobile browsers require a user gesture before audio starts; the Studio button satisfies this requirement.
- Browser speech is not available in every embedded WebView.
- Spoken text is session input only and is not persisted.
- The body pose remains a frame-blended 2.5D illustration rather than a skeletal Live2D or 3D model.

## Next Recommended Milestone

v0.9 should focus on real-device browser compatibility and UX rather than adding cloud services:

- Android Chrome and Samsung Internet voice inventory checks;
- iOS Safari user-gesture and interruption handling;
- long-text sentence chunking;
- pause/resume controls;
- visibility-change recovery;
- optional subtitle highlighting synchronized to browser boundary events.
