import * as Gradio from '@gradio/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = 'liveportrait-upload-probe';
const sourceImage = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
await mkdir(outputDir, { recursive: true });

const sourceResponse = await fetch(sourceImage);
if (!sourceResponse.ok) throw new Error(`source image fetch failed: ${sourceResponse.status}`);
const bytes = await sourceResponse.arrayBuffer();
const sourceFile = new File([bytes], 's9.jpg', {
  type: sourceResponse.headers.get('content-type') || 'image/jpeg',
});
const fileData = {
  blob: sourceFile,
  path: sourceFile.name,
  orig_name: sourceFile.name,
  size: sourceFile.size,
  mime_type: sourceFile.type,
};

const app = await Gradio.client('https://klingteam-liveportrait.hf.space');
const root = app.config?.root;
if (!root) throw new Error('LivePortrait root URL missing');

const startedAt = Date.now();
const uploaded = await Gradio.upload(fileData, root, randomUUID());
const elapsedMs = Date.now() - startedAt;

const result = {
  status: 'pass',
  root,
  elapsedMs,
  input: {
    name: sourceFile.name,
    size: sourceFile.size,
    type: sourceFile.type,
  },
  uploaded,
};
console.log(JSON.stringify(result, null, 2));
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

if (!Array.isArray(uploaded) || uploaded.length < 1 || !uploaded[0]?.path) {
  throw new Error(`upload returned no server path: ${JSON.stringify(uploaded)}`);
}
