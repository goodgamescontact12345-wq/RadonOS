/**
 * Smoke test for the hosted build.
 *
 * Usage:
 *   node tools/site-test.mjs                       # http://127.0.0.1:8787
 *   node tools/site-test.mjs https://example.com   # a deployed origin
 *
 * It crawls every document in `site/dist`, resolves every local href/src, and
 * checks the Worker's URL behaviour. No browser, no dependencies.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'site', 'dist');

let passed = 0;
const failures = [];

function check(ok, label, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

async function get(path, init) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  const body = await response.text();
  return { response, body, type: response.headers.get('content-type') || '' };
}

const files = await walk(DIST);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const toUrl = (file) => `/${relative(DIST, file).replaceAll('\\', '/')}`.replace(/index\.html$/, '');

/* ------------------------------------------------------------------ routes */
const root = await get('/');
check(root.response.status === 302 || root.response.status === 308, 'root redirects to the desktop', `${root.response.status} → ${root.response.headers.get('location')}`);
check((root.response.headers.get('location') || '').endsWith('/newtab/'), 'root redirect target is canonical');

const deep = await get('/?app=terminal');
check((deep.response.headers.get('location') || '').includes('/newtab/?app=terminal'), 'deep link keeps its query string');

const desktop = await get('/newtab/');
check(desktop.response.status === 200 && desktop.type.startsWith('text/html'), 'desktop document is served', desktop.type);
check(desktop.body.includes('id="desktop"') && desktop.body.includes('boot.js'), 'desktop document contains the shell');
// The policy may arrive as a response header (site/_headers, honoured by
// wrangler dev) or as a meta tag (works on every static host). Either is a
// real, enforced policy; the browser suite proves it blocks inline scripts.
const headerCsp = /content-security-policy/i.test([...desktop.response.headers.keys()].join(' '));
const metaCsp = /http-equiv="Content-Security-Policy"/i.test(desktop.body);
check(headerCsp || metaCsp, 'desktop ships a Content-Security-Policy', headerCsp ? 'header' : metaCsp ? 'meta tag' : 'missing');

const guard = await get('/', { method: 'POST' });
check(guard.response.status === 405, 'writes are rejected', String(guard.response.status));

const missing = await get('/shared/definitely-missing.js');
check(missing.response.status === 404, 'missing assets stay 404s');

const unknownPage = await get('/some/unknown/page', { headers: { accept: 'text/html' } });
check([302, 308].includes(unknownPage.response.status), 'unknown navigations fall back to the desktop', String(unknownPage.response.status));

/* ------------------------------------------------------- documents + links */
const refs = new Map();
for (const file of htmlFiles) {
  const url = toUrl(file);
  const { response, body, type } = await get(url);
  check(response.status === 200 && type.startsWith('text/html'), `document ${url}`, String(response.status));
  const dir = url.endsWith('/') ? url : `${url}/`;
  for (const match of body.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(https?:|data:|blob:|#|mailto:)/.test(value)) continue;
    const resolved = new URL(value, `${BASE}${dir}`);
    refs.set(resolved.pathname, value);
  }
}

for (const [path, from] of refs) {
  // Skip paths that are documents (already checked above).
  if (htmlFiles.some((file) => toUrl(file) === path)) continue;
  const { response, type } = await get(path);
  const expected = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') || /\.mjs$/.test(path) ? 'javascript' : '';
  check(
    response.status === 200 && (!expected || type.includes(expected)),
    `asset ${path}`,
    `${response.status} ${type} (from ${from})`,
  );
}

/* ------------------------------------------------------------ shipped files */
const shipped = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, 'utf8').catch(() => '') })));
// A literal chrome-extension:// link to one of our own folders cannot resolve on
// the web. Filtering the scheme out of a tab list (see the terminal's `tabs`
// command) is fine, so only flag URLs that point into the project.
const leaked = shipped.filter(({ text }) => /chrome-extension:\/\/[^\s'"`]*(newtab|apps|shared|icons|assets)\//.test(text));
check(leaked.length === 0, 'no chrome-extension:// links into the project', leaked.map(({ file }) => relative(DIST, file)).join(', '));

const forbidden = files.filter((file) => /[\\/](tools|node_modules)[\\/]|\.(pem|crx|map)$/.test(file));
check(forbidden.length === 0, 'no tooling, keys or source maps shipped');

const headers = await readFile(join(DIST, '_headers'), 'utf8');
check(headers.includes('frame-ancestors'), '_headers is shipped with the CSP');

console.log(`\n${passed}/${passed + failures.length} hosted-build checks passed`);
if (failures.length) {
  console.log(`Failures:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
