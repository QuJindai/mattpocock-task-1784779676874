import * as Gradio from '@gradio/client';
import { writeFile } from 'node:fs/promises';

const source = 'KlingTeam/LivePortrait';
const exportsList = Object.keys(Gradio).sort();
let app;
let connectionMode;

if (Gradio.Client?.connect) {
  connectionMode = 'Client.connect';
  app = await Gradio.Client.connect(source, {
    status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
  });
} else if (typeof Gradio.client === 'function') {
  connectionMode = 'client';
  app = await Gradio.client(source, {
    status_callback: (status) => console.log('[space-status]', JSON.stringify(status)),
  });
} else {
  throw new Error(`No supported connection export. Exports: ${exportsList.join(', ')}`);
}

const apiInfo = await app.view_api();
const named = Object.keys(apiInfo?.named_endpoints || {});
const unnamed = Object.keys(apiInfo?.unnamed_endpoints || {});
const endpoints = [...named, ...unnamed];
const imageEndpoint = endpoints.find((name) => name.toLowerCase().includes('execute_image'))
  || endpoints.find((name) => JSON.stringify((apiInfo.named_endpoints || apiInfo.unnamed_endpoints || {})[name] || {}).toLowerCase().includes('eyes-open'))
  || null;

const prototype = Object.getPrototypeOf(app);
const methodNames = [...new Set([
  ...Object.keys(app),
  ...(prototype ? Object.getOwnPropertyNames(prototype) : []),
])].sort();

const functionInfo = Object.fromEntries(
  ['normalise_file', 'get_fetchable_url_or_file', 'upload', 'upload_files']
    .filter((name) => typeof Gradio[name] === 'function')
    .map((name) => [name, {
      arity: Gradio[name].length,
      source: String(Gradio[name]).slice(0, 1600),
    }]),
);

const endpointSchema = imageEndpoint
  ? (apiInfo.named_endpoints?.[imageEndpoint] || apiInfo.unnamed_endpoints?.[imageEndpoint] || null)
  : null;

const result = {
  source,
  packageExports: exportsList,
  connectionMode,
  configVersion: app.config?.version || app.config?.version_info || null,
  methodNames,
  functionInfo,
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
