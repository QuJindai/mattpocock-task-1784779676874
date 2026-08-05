import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outputDir = resolve(root, 'public/frames/formal-v1');
const presetPath = resolve(root, 'frame-presets.json');
const runtimeUrl = process.env.AVATAR_RUNTIME_URL || 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const allowedOrigin = process.env.AVATAR_ORIGIN || 'https://avatar-showcase-lab.vercel.app';
const requiredFrameIds = [
  'idle-open', 'blink-half', 'blink-closed', 'happy',
  'listen', 'mouth-a', 'mouth-e', 'mouth-u',
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchJson(url, options = {}, timeoutMs = 150_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Origin: allowedOrigin,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${url} returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
    }
    if (!response.ok || body.ok !== true) {
      throw new Error(`${url} failed (${response.status}): ${body.error || text.slice(0, 240)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function mergeSourceAlpha(generatedBuffer, sourceAlpha, width, height) {
  const rgb = await sharp(generatedBuffer)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(sourceAlpha, { raw: { width, height, channels: 1 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 })
    .toBuffer();
}

async function pixelDifference(leftBuffer, rightBuffer, width, height) {
  const left = await sharp(leftBuffer).resize(width, height).removeAlpha().raw().toBuffer();
  const right = await sharp(rightBuffer).resize(width, height).removeAlpha().raw().toBuffer();
  if (left.length !== right.length) throw new Error('pixel buffers have different lengths');
  let total = 0;
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) {
    const diff = Math.abs(left[index] - right[index]);
    total += diff;
    if (diff > 3) changed += 1;
  }
  return {
    meanAbsoluteDifference: total / left.length,
    changedRatio: changed / left.length,
  };
}

await mkdir(outputDir, { recursive: true });
const presets = JSON.parse(await readFile(presetPath, 'utf8'));
for (const id of requiredFrameIds) {
  if (!presets[id]) throw new Error(`missing preset: ${id}`);
}

const asset = await fetchJson(`${runtimeUrl}?asset=character`, { method: 'GET' }, 60_000);
const sourceBuffer = Buffer.from(asset.imageBase64, 'base64');
const sourceMetadata = await sharp(sourceBuffer).metadata();
const width = sourceMetadata.width;
const height = sourceMetadata.height;
if (!width || !height || width < 512 || height < 512 || !sourceMetadata.hasAlpha) {
  throw new Error(`formal character must be a large transparent image: ${JSON.stringify(sourceMetadata)}`);
}
const sourceAlpha = await sharp(sourceBuffer).ensureAlpha().extractChannel(3).raw().toBuffer();
const sourceWebp = await sharp(sourceBuffer).webp({ quality: 94, alphaQuality: 100, effort: 6 }).toBuffer();

const manifest = {
  version: 1,
  characterId: 'formal-v1',
  generatedAt: new Date().toISOString(),
  runtime: runtimeUrl,
  sourceSha256: sha256(sourceBuffer),
  width,
  height,
  frames: {},
};

let idleBuffer = sourceWebp;
for (const id of requiredFrameIds) {
  let outputBuffer;
  let runtimeElapsedMs = 0;
  if (id === 'idle-open') {
    outputBuffer = sourceWebp;
  } else {
    const startedAt = Date.now();
    const response = await fetchJson(runtimeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mimeType: asset.mimeType || 'image/png',
        imageBase64: asset.imageBase64,
        expression: presets[id],
      }),
    });
    runtimeElapsedMs = response.elapsedMs || Date.now() - startedAt;
    const generatedBuffer = Buffer.from(response.imageBase64, 'base64');
    outputBuffer = await mergeSourceAlpha(generatedBuffer, sourceAlpha, width, height);
  }

  if (id === 'idle-open') idleBuffer = outputBuffer;
  const metadata = await sharp(outputBuffer).metadata();
  const difference = id === 'idle-open'
    ? { meanAbsoluteDifference: 0, changedRatio: 0 }
    : await pixelDifference(idleBuffer, outputBuffer, width, height);
  const fileName = `${id}.webp`;
  await writeFile(resolve(outputDir, fileName), outputBuffer);
  manifest.frames[id] = {
    id,
    file: `./${fileName}`,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: Boolean(metadata.hasAlpha),
    bytes: outputBuffer.length,
    sha256: sha256(outputBuffer),
    expression: presets[id],
    runtimeElapsedMs,
    differenceFromIdle: difference,
  };
}

const mustDiffer = ['blink-half', 'blink-closed', 'happy', 'listen', 'mouth-a', 'mouth-e', 'mouth-u'];
for (const id of mustDiffer) {
  const frame = manifest.frames[id];
  if (frame.sha256 === manifest.frames['idle-open'].sha256) {
    throw new Error(`${id} is byte-identical to idle-open`);
  }
  if (frame.differenceFromIdle.changedRatio < 0.0001) {
    throw new Error(`${id} does not visibly differ from idle-open`);
  }
}
if (manifest.frames['mouth-a'].sha256 === manifest.frames['mouth-e'].sha256) {
  throw new Error('mouth-a and mouth-e are identical');
}

await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: 'pass',
  outputDir,
  source: { width, height, bytes: sourceBuffer.length, sha256: manifest.sourceSha256 },
  frames: Object.fromEntries(Object.entries(manifest.frames).map(([id, frame]) => [id, {
    bytes: frame.bytes,
    sha256: frame.sha256,
    differenceFromIdle: frame.differenceFromIdle,
    runtimeElapsedMs: frame.runtimeElapsedMs,
  }])),
}, null, 2));
