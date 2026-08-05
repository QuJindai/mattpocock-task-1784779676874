import * as Gradio from '@gradio/client';
import { writeFile } from 'node:fs/promises';

const exportsList = Object.keys(Gradio).sort();
const functionInfo = Object.fromEntries(
  ['normalise_file', 'get_fetchable_url_or_file', 'upload', 'upload_files']
    .filter((name) => typeof Gradio[name] === 'function')
    .map((name) => [name, {
      arity: Gradio[name].length,
      source: String(Gradio[name]).slice(0, 2400),
    }]),
);

const baseResult = {
  packageExports: exportsList,
  functionInfo,
  attempts: [],
};
await writeFile('gradio-probe-results.json', `${JSON.stringify(baseResult, null, 2)}\n`, 'utf8');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectOne(source) {
  if (Gradio.Client?.connect) {
    return {
      connectionMode: 'Client.connect',
      app: await Gradio.Client.connect(source, {
        status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
      }),
    };
  }
  if (typeof Gradio.client === 'function') {
    return {
      connectionMode: 'client',
      app: await Gradio.client(source, {
        status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
      }),
    };
  }
  throw new Error(`No supported connection export. Exports: ${exportsList.join(', ')}`);
}

const sources = [
  'https://klingteam-liveportrait.hf.space',
  'KlingTeam/LivePortrait',
];

let connected = null;
let lastError = null;
for (const source of sources) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { app, connectionMode } = await connectOne(source);
      connected = { app, connectionMode, source, attempt };
      break;
    } catch (error) {
      lastError = error;
      baseResult.attempts.push({
        source,
        attempt,
        error: error.stack || error.message,
      });
      await writeFile('gradio-probe-results.json', `${JSON.stringify(baseResult, null, 2)}\n`, 'utf8');
      await sleep(attempt * 1500);
    }
  }
  if (connected) break;
}

if (!connected) {
  throw new Error(`Unable to connect to LivePortrait after retries: ${lastError?.message || lastError}`);
}

const { app, connectionMode, source, attempt } = connected;
const apiInfo = await app.view_api();
const named = Object.keys(apiInfo?.named_endpoints || {});
const unnamed = Object.keys(apiInfo?.unnamed_endpoints || {});
const endpoints = [...named, ...unnamed];
const imageEndpoint = endpoints.find((name) => name.toLowerCase().includes('execute_image'))
  || endpoints.find((name) => JSON.stringify(apiInfo.named_endpoints?.[name] || apiInfo.unnamed_endpoints?.[name] || {}).toLowerCase().includes('eyes-open'))
  || null;

const prototype = Object.getPrototypeOf(app);
const methodNames = [...new Set([
  ...Object.keys(app),
  ...(prototype ? Object.getOwnPropertyNames(prototype) : []),
])].sort();
const endpointSchema = imageEndpoint
  ? (apiInfo.named_endpoints?.[imageEndpoint] || apiInfo.unnamed_endpoints?.[imageEndpoint] || null)
  : null;

const result = {
  ...baseResult,
  source,
  successfulAttempt: attempt,
  connectionMode,
  configVersion: app.config?.version || app.config?.version_info || null,
  rootUrl: app.config?.root || app.config?.root_url || null,
  methodNames,
  imageEndpoint,
  endpointSchema,
  named,
  unnamed,
};

console.log(JSON.stringify(result, null, 2));
await writeFile('gradio-probe-results.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');

if (!imageEndpoint) {
  throw new Error(`LivePortrait image endpoint not found. Endpoints: ${endpoints.join(', ')}`);
}
