# V4.7 Character Refinement Design

## Objective

Improve the visual match between the existing Avatar A V4.6 Production scene and the target concept without changing the character model, action poses, camera framing, or night-apartment composition.

## Fixed baseline

- Default model remains `AvatarSample_A.vrm`.
- Existing idle, wave, and close-up framing logic remains unchanged.
- Existing V4.6 loading, URL state, 30-second readiness gate, and Production deployment chain remain unchanged.
- The night apartment remains a programmatic 2.5D background.

## Candidate approaches

Three candidates are generated from the immutable V4.6 payload and rendered under identical conditions.

### Candidate A — Toon depth

Adjust MToon shade and rim parameters for skin, hair, and cardigan materials. It does not edit source textures or background layers. This is the lowest-risk candidate.

### Candidate B — Texture recolor

Includes Candidate A and creates derived browser-side textures for hair and cardigan materials. Hair hue is shifted from pink-purple toward neutral brown. Light cardigan pixels are remapped toward warm cream while dark inner clothing, blue trim, and brown buttons are preserved.

### Candidate C — Integrated refinement

Includes Candidate B and adds visual integration: background depth blur, a subtle warm character halo, screen-space character drop shadow, and a stronger but soft contact-shadow treatment.

## Selection method

Each candidate must:

1. Load Avatar A within 30 seconds.
2. Preserve idle, natural wave, and close-up composition gates.
3. Produce zero page errors and zero critical request failures.
4. Report the expected MToon material settings.
5. Produce idle and close-up screenshots in the same 1600×900 Chromium environment.

The final candidate is selected by screenshot review, supported by image metrics:

- face luminance contrast;
- hair brown-versus-purple pixel ratio;
- cardigan cream-versus-pink pixel ratio;
- far-background edge energy;
- character/background separation.

## Production gate

Only the selected candidate is packaged into an immutable payload. Production is updated only after the Preview artifact passes automated checks and manual screenshot review. Production then reruns readiness, material, night-atmosphere, wave, close-up, and scene-difference gates.

## Rollback

V4.6 payload commit `b961e4c665f791f84bc386e94a107f206a8513bf` remains immutable and can be restored by repointing the Vercel loader to its payload metadata.
