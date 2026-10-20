/**
 * Builds the hosted (GitHub Pages) flavour of RadonOS into `site/dist/`.
 *
 * The extension needs no bundler and neither does this: the desktop, the apps
 * and the shared kernel are already plain ES modules, so the build is a copy
 * plus the three files a static host needs to answer URLs the assets cannot:
 *
 *   index.html     `/` → `/newtab/`, keeping `?app=` deep links
 *   404.html       unknown paths → the desktop instead of a dead end
 *   redirect.js    the (external) script both of those use, because the CSP
 *                  forbids inline scripts
 *
 * `.nojekyll` keeps GitHub Pages from running Jekyll over the output, so files
 * such as `_headers`-style names would be published verbatim and nothing waits
 * on a Jekyll build. Nothing from `tools/`, `site/`, the extension manifest or
 * the node_modules tree is published.
 */
import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE = join(ROOT, 'site');
const DIST = join(SITE, 'dist');

/** Everything the browser needs at runtime, relative to the project root. */
const INCLUDE = ['newtab', 'apps', 'shared', 'icons', 'assets'];

/** Standalone files published from site/ into the root of the build. */
const ROOT_FILES = ['redirect.js'];

/**
 * Every hosted document gets a meta CSP.
 *
 * GitHub Pages cannot send response headers, so the documents carry their own
 * policy. Directives that a meta tag cannot express (frame-ancestors) are
 * simply unavailable here; `frame-src *` still lets the shell embed apps.
 */
const META_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src * data: blob:; media-src * data: blob:; font-src 'self' data:; connect-src *; "
  + "frame-src *; object-src 'none'; base-uri 'self'; form-action 'self'";

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The two redirect documents.
 *
 * Both load `redirect.js` from the site root, so they work no matter how deep
 * the requested URL is; the script resolves the desktop relative to its own
 * src, which is what makes the `/RadonOS/` project-page subpath work. The root
 * document also gets a meta-refresh fallback for visitors without JavaScript.
 */
function redirectPage({ title, fallback }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    ${fallback ? '<noscript><meta http-equiv="refresh" content="0; url=./newtab/"></noscript>\n    ' : ''}<script src="redirect.js"></script>
  </head>
  <body>
    <p>Starting RadonOS…</p>
    <p><a href="newtab/">Open the desktop</a></p>
  </body>
</html>
`;
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const dir of INCLUDE) {
    await cp(join(ROOT, dir), join(DIST, dir), { recursive: true });
  }
  for (const file of ROOT_FILES) {
    await cp(join(SITE, file), join(DIST, file));
  }

  await writeFile(join(DIST, 'index.html'), redirectPage({ title: 'RadonOS', fallback: true }));
  await writeFile(join(DIST, '404.html'), redirectPage({ title: 'RadonOS — not found', fallback: false }));
  await writeFile(join(DIST, '.nojekyll'), '');

  const files = await walk(DIST);
  const forbidden = files.filter((file) => {
    const rel = relative(DIST, file).replaceAll('\\', '/');
    return /\.(map|pem|crx)$/i.test(rel)
      || /(^|\/)(node_modules|tools|site|\.wrangler|\.shots)(\/|$)/.test(rel)
      || ['manifest.json', 'worker.js', 'wrangler.toml', '_headers', 'deploy.json'].includes(rel);
  });
  if (forbidden.length) {
    throw new Error(`Refusing to publish:\n${forbidden.map((f) => relative(DIST, f)).join('\n')}`);
  }

  const html = files.filter((file) => file.endsWith('.html'));
  if (!html.some((file) => relative(DIST, file).replaceAll('\\', '/') === 'newtab/index.html')) {
    throw new Error('newtab/index.html is missing from the build');
  }

  // The meta tag must come before any stylesheet or module for the policy to
  // govern them, so it is inserted as the first thing inside <head>.
  for (const file of html) {
    const source = await readFile(file, 'utf8');
    if (/http-equiv="Content-Security-Policy"/i.test(source)) continue;
    const meta = `<meta http-equiv="Content-Security-Policy" content="${META_CSP}">`;
    const withMeta = source.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n  ${meta}`);
    if (withMeta === source) throw new Error(`No <head> to inject the CSP into: ${file}`);
    await writeFile(file, withMeta);
  }

  const bytes = (await Promise.all(files.map(async (file) => (await stat(file)).size)))
    .reduce((total, size) => total + size, 0);

  console.log(`Built ${files.length} files · ${(bytes / 1024).toFixed(1)} KiB → site/dist`);
  console.log('Publish site/dist as the GitHub Pages artifact (.github/workflows/pages.yml).');
}

await main();
