import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, '../blink-probe-output');
const runtimeUrl = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const origin = 'https://avatar-showcase-lab.vercel.app';
const values = [-5, -10, -15, -20];
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(`${response.status}: ${body.error || 'request failed'}`);
  return body;
}

await mkdir(outputDir, { recursive: true });
const asset = await jsonFetch(`${runtimeUrl}?asset=character`);
const source = Buffer.from(asset.imageBase64, 'base64');
const metadata = await sharp(source).metadata();
const width = metadata.width;
const height = metadata.height;
if (!width || !height || !metadata.hasAlpha) throw new Error('formal source must have dimensions and alpha');
const alpha = await sharp(source).ensureAlpha().extractChannel(3).raw().toBuffer();
const report = { width, height, sourceSha256: sha256(source), candidates: [] };

for (const value of values) {
  const response = await jsonFetch(runtimeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mimeType: asset.mimeType || 'image/png',
      imageBase64: asset.imageBase64,
      expression: {
        pitch: 0, yaw: 0, roll: 0, blink: value, eyebrow: 0, wink: 0,
        pupilX: 0, pupilY: 0, aaa: 0, eee: 0, woo: 0, smile: 0.05, cropFactor: 1.7,
      },
    }),
  });
  const generated = Buffer.from(response.imageBase64, 'base64');
  const rgb = await sharp(generated).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const output = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .webp({ quality: 94, alphaQuality: 100, effort: 6 })
    .toBuffer();
  const file = `blink-${Math.abs(value)}.webp`;
  await writeFile(resolve(outputDir, file), output);
  report.candidates.push({ value, file, bytes: output.length, sha256: sha256(output), runtimeElapsedMs: response.elapsedMs });
}
await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
