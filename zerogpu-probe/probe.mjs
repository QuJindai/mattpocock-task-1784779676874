import { Client } from '@gradio/client';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = 'artifacts';
const sourceUrl = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
const endpoint = '/gpu_wrapped_execute_image';
await mkdir(outputDir, { recursive: true });

const events = [];
const startedAt = Date.now();
const client = await Client.connect('KlingTeam/LivePortrait', {
  events: ['status', 'data'],
  status_callback: (event) => {
    events.push({ type: 'space-status', event });
    console.log('[space-status]', JSON.stringify(event));
  },
});

const apiInfo = await client.view_api();
if (!apiInfo?.named_endpoints?.[endpoint]) {
  throw new Error(`endpoint missing: ${endpoint}; available=${Object.keys(apiInfo?.named_endpoints || {}).join(',')}`);
}
await writeFile(`${outputDir}/api-info.json`, `${JSON.stringify(apiInfo, null, 2)}\n`, 'utf8');

const sourceResponse = await fetch(sourceUrl);
if (!sourceResponse.ok) throw new Error(`source fetch failed: ${sourceResponse.status}`);
const bytes = await sourceResponse.arrayBuffer();
const sourceFile = new File([bytes], 's9.jpg', {
  type: sourceResponse.headers.get('content-type') || 'image/jpeg',
});

const job = client.submit(endpoint, [0.45, 0.22, sourceFile, true]);
let outputData = null;
const timeout = setTimeout(() => {
  job.cancel?.();
}, 240_000);

for await (const message of job) {
  events.push(message);
  console.log('[event]', JSON.stringify(message));
  if (message.type === 'data') outputData = message.data;
}
clearTimeout(timeout);

function collectUrls(value) {
  const urls = [];
  const seen = new Set();
  function walk(item) {
    if (item == null || seen.has(item)) return;
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item)) urls.push(item);
      return;
    }
    if (typeof item !== 'object') return;
    seen.add(item);
    if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) urls.push(item.url);
    if (typeof item.path === 'string' && /^https?:\/\//i.test(item.path)) urls.push(item.path);
    if (Array.isArray(item)) item.forEach(walk);
    else Object.values(item).forEach(walk);
  }
  walk(value);
  return [...new Set(urls)];
}

const urls = collectUrls(outputData);
const result = {
  status: urls.length >= 1 ? 'pass' : 'fail',
  clientVersionTarget: '1.10.0',
  endpoint,
  elapsedMs: Date.now() - startedAt,
  outputData,
  urls,
  events,
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

if (urls.length < 1) throw new Error(`ZeroGPU returned no output URL: ${JSON.stringify(outputData)}`);
for (let index = 0; index < urls.length; index += 1) {
  const response = await fetch(urls[index]);
  if (!response.ok) throw new Error(`output download failed ${response.status}: ${urls[index]}`);
  await writeFile(`${outputDir}/output-${index + 1}.png`, Buffer.from(await response.arrayBuffer()));
}
