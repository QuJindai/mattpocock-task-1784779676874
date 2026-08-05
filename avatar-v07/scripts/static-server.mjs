import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const routeFallbacks = new Set(['/studio', '/showcase', '/capture', '/compare', '/']);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

function safeFilePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

async function fileResponse(filePath, response) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('not a file');
  const body = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': mime.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Content-Length': body.byteLength,
    'Cache-Control': extname(filePath) === '.webp' ? 'public, max-age=31536000, immutable' : 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (routeFallbacks.has(pathname)) {
      await fileResponse(resolve(root, 'index.html'), response);
      return;
    }
    const filePath = safeFilePath(pathname);
    if (!filePath) {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }
    await fileResponse(filePath, response);
  } catch (error) {
    response.writeHead(error?.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error?.code === 'ENOENT' ? 'Not Found' : `Server Error: ${error.message || error}`);
  }
});

server.listen(port, host, () => {
  console.log(`Avatar v0.7 isolated server listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
