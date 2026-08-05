import * as Gradio from '@gradio/client';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = 'liveportrait-probe';
const sourceImage = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/source/s9.jpg';
const endpoint = '/gpu_wrapped_execute_image';
await mkdir(outputDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
  const sources = ['https://klingteam-liveportrait.hf.space', 'KlingTeam/LivePortrait'];
  let lastError;
  for (const source of sources) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const app = await Gradio.client(source, {
          status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
        });
        return { app, source, attempt };
      } catch (error) {
        lastError = error;
        console.error(`[connect-failed] ${source} attempt=${attempt}`, error);
        await sleep(attempt * 1500);
      }
    }
  }
  throw lastError;
}

function extractUrls(value) {
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

const sourceResponse = await fetch(sourceImage);
if (!sourceResponse.ok) throw new Error(`source image fetch failed: ${sourceResponse.status}`);
const sourceBlob = await sourceResponse.blob();
console.log(`[source] type=${sourceBlob.type} bytes=${sourceBlob.size}`);

const { app, source, attempt } = await connectWithRetry();
console.log(`[connected] source=${source} attempt=${attempt} version=${app.config?.version}`);
console.log(`[predict-signature] ${String(app.predict).slice(0, 1800)}`);

const startedAt = Date.now();
const result = await app.predict(endpoint, [0.45, 0.22, sourceBlob, true]);
const elapsedMs = Date.now() - startedAt;
const urls = extractUrls(result);

const summary = {
  status: 'pass',
  connectedSource: source,
  connectedAttempt: attempt,
  configVersion: app.config?.version || null,
  endpoint,
  elapsedMs,
  result,
  urls,
};
console.log(JSON.stringify(summary, null, 2));
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

if (urls.length < 1) throw new Error(`no output URL in prediction: ${JSON.stringify(result)}`);
for (let index = 0; index < urls.length; index += 1) {
  const response = await fetch(urls[index]);
  if (!response.ok) throw new Error(`output download failed ${response.status}: ${urls[index]}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(`${outputDir}/output-${index + 1}.png`, bytes);
}
