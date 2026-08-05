import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const runtimeUrl = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const sourceUrl = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
const anonKey = process.env.SUPABASE_ANON_KEY;
const origin = 'https://avatar-showcase-lab.vercel.app';
const outputDir = 'avatar-runtime-artifacts';

if (!anonKey) throw new Error('SUPABASE_ANON_KEY is required');
await mkdir(outputDir, { recursive: true });

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${anonKey}`,
  origin,
};

function compact(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = structuredClone(value);
  if (typeof clone.imageBase64 === 'string') {
    clone.imageBase64Length = clone.imageBase64.length;
    delete clone.imageBase64;
  }
  return clone;
}

function decodeBase64(value) {
  return Buffer.from(value.replace(/^data:[^,]+,/, ''), 'base64');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parsePng(bytes, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} is not a valid PNG`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${label} has no PNG IHDR chunk`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  return {
    width,
    height,
    bitDepth,
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

async function fetchRuntimeJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { response, body, text };
}

async function fetchAsset(name) {
  const startedAt = Date.now();
  const { response, body, text } = await fetchRuntimeJson(`${runtimeUrl}?asset=${encodeURIComponent(name)}`);
  const elapsedMs = Date.now() - startedAt;
  await writeFile(
    `${outputDir}/${name}-response.json`,
    `${JSON.stringify({ status: response.status, elapsedMs, body: compact(body) }, null, 2)}\n`,
  );
  if (!response.ok || body?.ok !== true || body?.asset !== name || typeof body?.imageBase64 !== 'string') {
    throw new Error(`${name} asset failed: status=${response.status} body=${text.slice(0, 1000)}`);
  }
  const bytes = decodeBase64(body.imageBase64);
  const png = parsePng(bytes, name);
  if (body.mimeType !== 'image/png') throw new Error(`${name} unexpected mime: ${body.mimeType}`);
  if (body.bytes !== bytes.length) throw new Error(`${name} byte count mismatch: body=${body.bytes} decoded=${bytes.length}`);
  await writeFile(`${outputDir}/${name}.png`, bytes);
  return {
    name,
    bytes: bytes.length,
    sha256: sha256(bytes),
    elapsedMs,
    ...png,
  };
}

const healthStartedAt = Date.now();
const { response: healthResponse, body: health, text: healthText } = await fetchRuntimeJson(runtimeUrl);
await writeFile(
  `${outputDir}/health.json`,
  `${JSON.stringify({ status: healthResponse.status, elapsedMs: Date.now() - healthStartedAt, body: health }, null, 2)}\n`,
);
if (!healthResponse.ok || health?.ok !== true || health?.endpoint !== '/edit_expression') {
  throw new Error(`runtime health failed: status=${healthResponse.status} body=${healthText}`);
}
if (!Array.isArray(health.assets) || !health.assets.includes('character') || !health.assets.includes('background')) {
  throw new Error(`runtime health missing formal assets: ${JSON.stringify(health.assets)}`);
}

const character = await fetchAsset('character');
const background = await fetchAsset('background');

if (character.width !== 1344 || character.height !== 1728 || !character.hasAlpha) {
  throw new Error(`character asset contract failed: ${JSON.stringify(character)}`);
}
if (character.bytes < 100_000) throw new Error(`character asset too small: ${character.bytes}`);
if (background.width / background.height < 1.7 || background.width / background.height > 1.8) {
  throw new Error(`background aspect ratio is not 16:9-like: ${JSON.stringify(background)}`);
}
if (background.bytes < 100_000) throw new Error(`background asset too small: ${background.bytes}`);

const sourceResponse = await fetch(sourceUrl);
if (!sourceResponse.ok) throw new Error(`source fetch failed: ${sourceResponse.status}`);
const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
const sourceMimeType = sourceResponse.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

const expression = {
  pitch: -3,
  yaw: 8,
  roll: 2,
  blink: -1,
  eyebrow: 4,
  wink: 1,
  pupilX: 2,
  pupilY: -1,
  aaa: 18,
  eee: 0,
  woo: 0,
  smile: 0.45,
  cropFactor: 1.7,
};

const generationStartedAt = Date.now();
const { response: generationResponse, body: generation, text: generationText } = await fetchRuntimeJson(runtimeUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    imageBase64: sourceBytes.toString('base64'),
    mimeType: sourceMimeType,
    expression,
  }),
});
const elapsedMs = Date.now() - generationStartedAt;
await writeFile(
  `${outputDir}/generation.json`,
  `${JSON.stringify({ status: generationResponse.status, elapsedMs, body: compact(generation) }, null, 2)}\n`,
);
if (!generationResponse.ok || generation?.ok !== true || typeof generation?.imageBase64 !== 'string') {
  throw new Error(`runtime generation failed: status=${generationResponse.status} body=${generationText}`);
}
if (generation.backend !== 'fffiloni/expression-editor' || generation.endpoint !== '/edit_expression') {
  throw new Error(`unexpected backend response: ${JSON.stringify(compact(generation))}`);
}

const outputBytes = decodeBase64(generation.imageBase64);
if (outputBytes.length < 20_000) throw new Error(`runtime output too small: ${outputBytes.length}`);
await writeFile(`${outputDir}/output.webp`, outputBytes);

const result = {
  status: 'pass',
  runtimeUrl,
  backend: generation.backend,
  endpoint: generation.endpoint,
  assets: { character, background },
  healthElapsedMs: health.elapsedMs,
  requestElapsedMs: elapsedMs,
  runtimeElapsedMs: generation.elapsedMs,
  sourceBytes: sourceBytes.length,
  outputBytes: outputBytes.length,
  outputSha256: sha256(outputBytes),
  mimeType: generation.mimeType,
  expression: generation.expression,
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
