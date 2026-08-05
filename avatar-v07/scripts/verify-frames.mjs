import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const frameDir = resolve(here, '../public/frames/formal-v1');
const manifest = JSON.parse(await readFile(resolve(frameDir, 'manifest.json'), 'utf8'));
const required = [
  'idle-open', 'blink-half', 'blink-closed', 'happy',
  'listen', 'mouth-a', 'mouth-e', 'mouth-u',
];
const report = { status: 'pass', frames: {} };
for (const id of required) {
  const entry = manifest.frames[id];
  if (!entry) throw new Error(`manifest missing ${id}`);
  const buffer = await readFile(resolve(frameDir, entry.file.replace(/^\.\//, '')));
  const hash = createHash('sha256').update(buffer).digest('hex');
  const metadata = await sharp(buffer).metadata();
  if (hash !== entry.sha256) throw new Error(`${id} hash mismatch`);
  if (metadata.width !== manifest.width || metadata.height !== manifest.height) {
    throw new Error(`${id} dimensions mismatch`);
  }
  if (!metadata.hasAlpha) throw new Error(`${id} has no alpha channel`);
  report.frames[id] = { bytes: buffer.length, hash, width: metadata.width, height: metadata.height };
}
console.log(JSON.stringify(report, null, 2));
