import * as Gradio from '@gradio/client';
import { writeFile } from 'node:fs/promises';

const source = 'KlingTeam/LivePortrait';
const exportsList = Object.keys(Gradio).sort();
let client;
let connectionMode;

if (Gradio.Client?.connect) {
  connectionMode = 'Client.connect';
  client = await Gradio.Client.connect(source, {
    status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
  });
} else if (typeof Gradio.client === 'function') {
  connectionMode = 'client';
  client = await Gradio.client(source, {
    status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
  });
} else {
  throw new Error(`No supported connection export. Exports: ${exportsList.join(', ')}`);
}

const apiInfo = await client.view_api();
const named = Object.keys(apiInfo?.named_endpoints || {});
const unnamed = Object.keys(apiInfo?.unnamed_endpoints || {});
const endpoints = [...named, ...unnamed];
const imageEndpoint = endpoints.find((name) => name.toLowerCase().includes('execute_image'))
  || endpoints.find((name) => JSON.stringify((apiInfo.named_endpoints || apiInfo.unnamed_endpoints || {})[name] || {}).toLowerCase().includes('eyes-open'))
  || null;

const result = {
  source,
  packageExports: exportsList,
  connectionMode,
  configVersion: client.config?.version || client.config?.version_info || null,
  imageEndpoint,
  named,
  unnamed,
};

console.log(JSON.stringify(result, null, 2));
await writeFile('gradio-probe-results.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');

if (!imageEndpoint) {
  throw new Error(`LivePortrait image endpoint not found. Endpoints: ${endpoints.join(', ')}`);
}
