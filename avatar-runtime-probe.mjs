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

const healthStartedAt = Date.now();
const healthResponse = await fetch(runtimeUrl, { headers });
const healthText = await healthResponse.text();
let health;
try { health = JSON.parse(healthText); } catch { health = { raw: healthText }; }
await writeFile(`${outputDir}/health.json`, `${JSON.stringify({ status: healthResponse.status, elapsedMs: Date.now() - healthStartedAt, body: health }, null, 2)}\n`);
if (!healthResponse.ok || health?.ok !== true || health?.endpoint !== '/edit_expression') {
  throw new Error(`runtime health failed: status=${healthResponse.status} body=${healthText}`);
}

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
const generationResponse = await fetch(runtimeUrl, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    imageBase64: sourceBytes.toString('base64'),
    mimeType: sourceMimeType,
    expression,
  }),
});
const generationText = await generationResponse.text();
let generation;
try { generation = JSON.parse(generationText); } catch { generation = { raw: generationText }; }
const elapsedMs = Date.now() - generationStartedAt;
await writeFile(`${outputDir}/generation.json`, `${JSON.stringify({ status: generationResponse.status, elapsedMs, body: compact(generation) }, null, 2)}\n`);
if (!generationResponse.ok || generation?.ok !== true || typeof generation?.imageBase64 !== 'string') {
  throw new Error(`runtime generation failed: status=${generationResponse.status} body=${generationText}`);
}
if (generation.backend !== 'fffiloni/expression-editor' || generation.endpoint !== '/edit_expression') {
  throw new Error(`unexpected backend response: ${JSON.stringify(compact(generation))}`);
}

const outputBytes = decodeBase64(generation.imageBase64);
if (outputBytes.length < 50_000) throw new Error(`runtime output too small: ${outputBytes.length}`);
await writeFile(`${outputDir}/output.webp`, outputBytes);

const result = {
  status: 'pass',
  runtimeUrl,
  backend: generation.backend,
  endpoint: generation.endpoint,
  healthElapsedMs: health.elapsedMs,
  requestElapsedMs: elapsedMs,
  runtimeElapsedMs: generation.elapsedMs,
  sourceBytes: sourceBytes.length,
  outputBytes: outputBytes.length,
  outputSha256: createHash('sha256').update(outputBytes).digest('hex'),
  mimeType: generation.mimeType,
  expression: generation.expression,
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
