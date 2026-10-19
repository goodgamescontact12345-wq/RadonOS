/**
 * RadonOS development server.
 *
 * Serves the unpacked extension over http://localhost so the desktop and every
 * app can be developed and tested in a normal tab. `shared/platform.js` detects
 * the missing chrome.* APIs and falls back to localStorage + BroadcastChannel,
 * so the UI behaves identically to the installed extension.
 *
 *   node tools/serve.mjs [--port 4173]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const requested = portFlag >= 0 ? Number(args[portFlag + 1]) : Number(process.env.RADONOS_PORT);
const PORT = Number.isFinite(requested) && requested > 0 ? requested : 4173;
const HOST = process.env.RADONOS_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = normalize(join(ROOT, clean));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return null;
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const index = join(target, 'index.html');
      await stat(index);
      return index;
    }
    return target;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const file = await resolveFile(request.url || '/');
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`404 Not found: ${request.url}`);
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    response.end(body);
  } catch (err) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`500 ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RadonOS dev server → http://${HOST}:${PORT}/newtab/index.html`);
  console.log(`Serving ${ROOT}`);
});
