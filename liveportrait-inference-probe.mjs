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

async function submitAndWait(app, data, timeoutMs = 720_000) {
  const events = [];
  const job = app.submit(endpoint, data);
  let latestData = null;
  let completed = false;

  return await new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {
      console.log('[keepalive] waiting for LivePortrait');
    }, 15_000);
    const timeout = setTimeout(() => {
      clearInterval(keepAlive);
      job.cancel?.();
      reject(new Error(`LivePortrait timed out after ${timeoutMs} ms; events=${JSON.stringify(events)}`));
    }, timeoutMs);

    function finish(error, value) {
      clearInterval(keepAlive);
      clearTimeout(timeout);
      job.destroy?.();
      if (error) reject(error);
      else resolve({ value, events });
    }

    job.on('data', (dataEvent) => {
      latestData = dataEvent;
      events.push({ type: 'data', data: dataEvent });
      console.log('[data]', JSON.stringify(dataEvent));
      if (completed) finish(null, latestData);
    });

    job.on('status', (statusEvent) => {
      events.push({ type: 'status', status: statusEvent });
      console.log('[status]', JSON.stringify(statusEvent));
      if (statusEvent.stage === 'error') {
        finish(new Error(`LivePortrait status error: ${JSON.stringify(statusEvent)}`));
        return;
      }
      if (statusEvent.stage === 'complete') {
        completed = true;
        if (latestData !== null) finish(null, latestData);
      }
    });
  });
}

const sourceResponse = await fetch(sourceImage);
if (!sourceResponse.ok) throw new Error(`source image fetch failed: ${sourceResponse.status}`);
const sourceBytes = await sourceResponse.arrayBuffer();
const sourceFile = new File([sourceBytes], 's9.jpg', {
  type: sourceResponse.headers.get('content-type') || 'image/jpeg',
});
console.log(`[source] type=${sourceFile.type} bytes=${sourceFile.size} name=${sourceFile.name}`);

await writeFile(
  `${outputDir}/started.json`,
  `${JSON.stringify({ sourceImage, endpoint, sourceBytes: sourceFile.size, startedAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);

const { app, source, attempt } = await connectWithRetry();
console.log(`[connected] source=${source} attempt=${attempt} version=${app.config?.version}`);
console.log(`[submit-signature] ${String(app.submit).slice(0, 2400)}`);

const startedAt = Date.now();
const { value: result, events } = await submitAndWait(app, [0.45, 0.22, sourceFile, true]);
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
  events,
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
