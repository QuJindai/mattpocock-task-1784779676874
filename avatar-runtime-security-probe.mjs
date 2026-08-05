import { mkdir, writeFile } from 'node:fs/promises';

const runtimeUrl = 'https://ezvfqrhzucjvkwnnbjux.supabase.co/functions/v1/avatar-motion-runtime';
const allowedOrigin = 'https://avatar-showcase-lab.vercel.app';
const deniedOrigin = 'https://evil.example';
const outputDir = 'avatar-runtime-security-artifacts';
await mkdir(outputDir, { recursive: true });

async function probe(label, origin, url = runtimeUrl, method = 'GET') {
  const response = await fetch(url, {
    method,
    headers: {
      origin,
      ...(method === 'OPTIONS' ? {
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      } : {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return {
    label,
    origin,
    method,
    status: response.status,
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    body,
  };
}

const allowed = await probe('allowed-no-auth', allowedOrigin);
const denied = await probe('denied-no-auth', deniedOrigin);
const preflight = await probe('allowed-preflight', allowedOrigin, runtimeUrl, 'OPTIONS');
const asset = await probe('allowed-character-asset-no-auth', allowedOrigin, `${runtimeUrl}?asset=character`);

const failures = [];
if (allowed.status !== 200 || allowed.body?.ok !== true || allowed.body?.backend !== 'fffiloni/expression-editor') {
  failures.push(`allowed origin failed: ${JSON.stringify(allowed)}`);
}
if (denied.status !== 403 || denied.body?.error !== 'origin_not_allowed') {
  failures.push(`denied origin was not rejected: ${JSON.stringify(denied)}`);
}
if (preflight.status !== 204 || preflight.accessControlAllowOrigin !== allowedOrigin) {
  failures.push(`preflight failed: ${JSON.stringify(preflight)}`);
}
if (asset.status !== 200 || asset.body?.ok !== true || asset.body?.asset !== 'character' || asset.body?.bytes < 100000) {
  failures.push(`asset without auth failed: ${JSON.stringify({ ...asset, body: asset.body ? { ...asset.body, imageBase64: undefined } : null })}`);
}

const result = {
  status: failures.length ? 'fail' : 'pass',
  runtimeUrl,
  allowed,
  denied,
  preflight,
  asset: {
    ...asset,
    body: asset.body ? {
      ok: asset.body.ok,
      asset: asset.body.asset,
      mimeType: asset.body.mimeType,
      bytes: asset.body.bytes,
      base64Length: asset.body.imageBase64?.length || 0,
    } : null,
  },
  failures,
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length) throw new Error(failures.join('\n'));
