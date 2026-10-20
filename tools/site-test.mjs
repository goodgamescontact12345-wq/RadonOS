/**
 * Smoke test for the hosted (GitHub Pages) build.
 *
 * Usage:
 *   npm run site:dev                        # serves http://127.0.0.1:8787/RadonOS/
 *   npm run site:test                       # against that server
 *   node tools/site-test.mjs https://user.github.io/RadonOS
 *
 * It crawls every document in `site/dist`, resolves every local href/src, and
 * checks the URL behaviour a static host has to fake: `/` redirecting to the
 * desktop, deep links surviving the redirect, and unknown paths landing on the
 * desktop via `404.html`. No browser, no dependencies.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787/RadonOS').replace(/\/$/, '');
// A project page lives at https://user.github.io/<repo>/, so the site root is a
// prefix of every path rather than the origin itself.
const PREFIX = new URL(`${BASE}/`).pathname.replace(/\/$/, '');
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
const rel = (file) => relative(DIST, file).replaceAll('\\', '/');

/* ------------------------------------------------------------------ routes */
const root = await get('/');
check(root.response.status === 200 && root.type.startsWith('text/html'), 'root serves the redirect document', `${root.response.status} ${root.type}`);
check(root.body.includes('redirect.js'), 'root document loads the redirect script');
check(/http-equiv="refresh"[^>]*newtab\//i.test(root.body), 'root has a no-JavaScript fallback');

const deep = await get('/?app=terminal');
check(deep.response.status === 200 && deep.body.includes('redirect.js'), 'deep link reaches the redirect document');

const script = await get('/redirect.js');
check(script.response.status === 200 && script.type.includes('javascript'), 'redirect script is served', script.type);

// Run the redirect script the server actually sent (not the local copy) against
// stubs, to prove where it sends the visitor: the desktop relative to the
// script, path intact, query and hash carried over.
const redirectSource = script.body || await readFile(join(DIST, 'redirect.js'), 'utf8');
function redirectTo(pageUrl) {
  const page = new URL(pageUrl);
  // The script is fetched from the site root; it resolves the desktop from
  // there, which is why a project-page subpath and a 404 at any depth work.
  const scriptUrl = `${page.origin}${PREFIX}/redirect.js`;
  let target = null;
  const location = {
    search: page.search,
    hash: page.hash,
    href: page.href,
    replace: (url) => { target = url; },
  };
  new Function('document', 'location', redirectSource)({ currentScript: { src: scriptUrl } }, location);
  return target;
}
// Shape the URLs like the origin being tested, so this works for a project
// page (/<repo>/) and for an origin root alike.
const at = (path) => `https://user.github.io${PREFIX}${path}`;
check(redirectTo(at('/')) === at('/newtab/'), 'root redirect lands on the desktop', redirectTo(at('/')));
check(redirectTo(`${at('/')}?app=terminal`) === `${at('/newtab/')}?app=terminal`, 'deep links keep their query string', redirectTo(`${at('/')}?app=terminal`));
check(redirectTo(at('/a/b/c#frag')) === `${at('/newtab/')}#frag`, 'the 404 page redirects from any depth', redirectTo(at('/a/b/c#frag')));

const desktop = await get('/newtab/');
check(desktop.response.status === 200 && desktop.type.startsWith('text/html'), 'desktop document is served', desktop.type);
check(desktop.body.includes('id="desktop"') && desktop.body.includes('boot.js'), 'desktop document contains the shell');
const metaCsp = /http-equiv="Content-Security-Policy"/i.test(desktop.body);
check(metaCsp, 'desktop ships a Content-Security-Policy', metaCsp ? 'meta tag' : 'missing');

const trailing = await get('/newtab');
check(trailing.response.status === 301 && (trailing.response.headers.get('location') || '').endsWith('/newtab/'), 'directories redirect to their trailing-slash form', String(trailing.response.status));

const guard = await get('/', { method: 'POST' });
check(guard.response.status === 405, 'writes are rejected', String(guard.response.status));

const missing = await get('/shared/definitely-missing.js');
check(missing.response.status === 404, 'missing assets stay 404s');

const DEPTH = '/some/unknown/page';
const unknownPage = await get(DEPTH, { headers: { accept: 'text/html' } });
check(unknownPage.response.status === 404, 'unknown paths keep the 404 status', String(unknownPage.response.status));
check(unknownPage.body.includes('redirect.js'), 'unknown paths land on the desktop via 404.html');
// GitHub Pages serves 404.html *at the requested URL*, so unlike every other
// document its references must resolve from there, not from its own folder.
for (const match of unknownPage.body.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const target = new URL(match[1], `${BASE}${DEPTH}`);
  const inside = target.pathname.startsWith(`${PREFIX}/`);
  check(inside, `404 reference ${match[1]} resolves from a deep path`, target.pathname);
  const { response } = await get(target.pathname.slice(PREFIX.length));
  check(response.status === 200, `404 reference ${match[1]} loads`, String(response.status));
}

/* ------------------------------------------------------- documents + links */
const refs = new Map();
const absolute = [];
for (const file of htmlFiles) {
  const url = toUrl(file);
  const { response, body, type } = await get(url);
  check(response.status === 200 && type.startsWith('text/html'), `document ${url}`, String(response.status));
  // `index.html` is already served as its directory; other documents resolve
  // their relative links against their own directory.
  const dir = url.endsWith('/') ? url : `${url.replace(/[^/]+$/, '')}`;
  for (const match of body.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(https?:|data:|blob:|#|mailto:)/.test(value)) continue;
    // A project page lives under /<repo>/, so every reference must be relative —
    // except an absolute one rooted at the site's own prefix (the generated
    // entry documents, which have to be absolute to survive a deep 404).
    if (value.startsWith('/') && !value.startsWith(`${PREFIX}/`)) absolute.push(`${rel(file)} → ${value}`);
    const resolved = new URL(value, `${BASE}${dir}`);
    refs.set(resolved.pathname.slice(PREFIX.length) || '/', value);
  }
}
check(absolute.length === 0, 'documents only use relative URLs or the site prefix (so /<repo>/ works)', absolute.join(', '));

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
check(leaked.length === 0, 'no chrome-extension:// links into the project', leaked.map(({ file }) => rel(file)).join(', '));

const forbidden = files.filter((file) => /(^|\/)(tools|node_modules|site)(\/|$)|\.(pem|crx|map)$/.test(rel(file)));
check(forbidden.length === 0, 'no tooling, keys or source maps shipped', forbidden.map(rel).join(', '));

const deployFiles = files.map(rel);
const leftovers = deployFiles.filter((file) => ['worker.js', 'wrangler.toml', '_headers', 'deploy.json'].includes(file));
check(leftovers.length === 0, 'no Worker or previous-host files shipped', leftovers.join(', '));

check(deployFiles.includes('.nojekyll'), '.nojekyll is shipped (GitHub Pages skips Jekyll)');

console.log(`\n${passed}/${passed + failures.length} hosted-build checks passed`);
if (failures.length) {
  console.log(`Failures:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
