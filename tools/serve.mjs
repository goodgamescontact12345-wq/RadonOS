/**
 * RadonOS development server.
 *
 * Serves the unpacked extension over http://localhost so the desktop and every
 * app can be developed and tested in a normal tab. `shared/platform.js` detects
 * the missing chrome.* APIs and falls back to localStorage + BroadcastChannel,
 * so the UI behaves identically to the installed extension.
 *
 *   node tools/serve.mjs [--port 4173]
 *   node tools/serve.mjs --root site/dist --pages   # the GitHub Pages build
 *   node tools/serve.mjs --root site/dist --pages --base /RadonOS
 *
 * `--pages` makes the server behave like GitHub Pages rather than like a plain
 * file server: directories without a trailing slash are redirected, unknown
 * paths answer `404.html` with a 404 status, and non-GET/HEAD requests get a
 * 405. That is the shape the hosted smoke test asserts.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const ROOT = resolve(HERE, '..', flag('--root') || '.');
/** Emulate GitHub Pages' status codes and 404 document. */
const PAGES = args.includes('--pages');
/** Mount the tree under a prefix, the way a project page lives at /<repo>/. */
const BASE_PATH = (flag('--base') || '').replace(/\/$/, '');

const requested = Number(flag('--port') || process.env.RADONOS_PORT);
const PORT = Number.isFinite(requested) && requested > 0 ? requested : PAGES ? 8787 : 4173;
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

async function isDirectory(urlPath) {
  const target = normalize(join(ROOT, decodeURIComponent(urlPath)));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return false;
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const requested = request.url || '/';
  const [requestedPath, query] = requested.split('?');

  // Project pages are served from /<repo>/, not from the origin root.
  let pathname = requestedPath;
  if (BASE_PATH) {
    if (requestedPath === BASE_PATH) {
      response.writeHead(301, { location: `${BASE_PATH}/${query ? `?${query}` : ''}` });
      response.end();
      return;
    }
    if (!requestedPath.startsWith(`${BASE_PATH}/`)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('404 Not found\n');
      return;
    }
    pathname = requestedPath.slice(BASE_PATH.length);
  }
  const url = `${pathname}${query ? `?${query}` : ''}`;

  if (PAGES && request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    response.end('405 Method not allowed\n');
    return;
  }

  // GitHub Pages redirects `/newtab` to `/newtab/` so relative links resolve.
  if (PAGES && !pathname.endsWith('/') && (await isDirectory(pathname))) {
    response.writeHead(301, { location: `${BASE_PATH}${pathname}/${query ? `?${query}` : ''}` });
    response.end();
    return;
  }

  const file = await resolveFile(url);
  if (!file) {
    if (PAGES) {
      const notFound = await readFile(join(ROOT, '404.html')).catch(() => null);
      if (notFound) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(notFound);
        return;
      }
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`404 Not found: ${url}`);
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
  console.log(`RadonOS dev server → http://${HOST}:${PORT}${BASE_PATH}/newtab/index.html`);
  console.log(`Serving ${ROOT}${PAGES ? ' (GitHub Pages emulation)' : ''}${BASE_PATH ? ` at ${BASE_PATH}/` : ''}`);
});
