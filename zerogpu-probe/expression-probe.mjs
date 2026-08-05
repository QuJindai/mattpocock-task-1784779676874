import { Client } from '@gradio/client';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = 'expression-artifacts';
const spaceId = 'fffiloni/expression-editor';
const sourceUrl = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
await mkdir(outputDir, { recursive: true });

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

const client = await Client.connect(spaceId, {
  events: ['status', 'data'],
  status_callback: (event) => console.log('[space-status]', JSON.stringify(event)),
});
const apiInfo = await client.view_api();
const entries = Object.entries(apiInfo?.named_endpoints || {});
const endpoint = entries.find(([name]) => name.toLowerCase().includes('edit_expression'))?.[0]
  || entries.find(([, info]) => JSON.stringify(info).includes('Rotate Up-Down'))?.[0];
if (!endpoint) {
  throw new Error(`expression endpoint missing: ${entries.map(([name]) => name).join(',')}`);
}
await writeFile(`${outputDir}/api-info.json`, `${JSON.stringify({ endpoint, apiInfo }, null, 2)}\n`, 'utf8');

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`source fetch failed: ${response.status}`);
const sourceFile = new File([await response.arrayBuffer()], 's9.jpg', {
  type: response.headers.get('content-type') || 'image/jpeg',
});

const input = [
  sourceFile,
  -2,
  4,
  1,
  -1,
  2,
  0,
  1,
  -1,
  12,
  0,
  0,
  0.32,
  1,
  1,
  'OnlyExpression',
  1.7,
];

const events = [];
let outputData = null;
const job = client.submit(endpoint, input);
const cancelTimer = setTimeout(() => job.cancel?.(), 180_000);
for await (const message of job) {
  events.push(message);
  console.log('[event]', JSON.stringify(message));
  if (message.type === 'status' && message.stage === 'error') {
    clearTimeout(cancelTimer);
    await writeFile(`${outputDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
    throw new Error(message.message || JSON.stringify(message));
  }
  if (message.type === 'data') outputData = message.data;
}
clearTimeout(cancelTimer);

const urls = collectUrls(outputData);
const result = {
  status: urls.length ? 'pass' : 'fail',
  spaceId,
  endpoint,
  urls,
  outputData,
  events,
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (!urls.length) throw new Error(`expression backend returned no output: ${JSON.stringify(outputData)}`);

for (let index = 0; index < urls.length; index += 1) {
  const output = await fetch(urls[index]);
  if (!output.ok) throw new Error(`output download failed ${output.status}: ${urls[index]}`);
  await writeFile(`${outputDir}/output-${index + 1}.png`, Buffer.from(await output.arrayBuffer()));
}
