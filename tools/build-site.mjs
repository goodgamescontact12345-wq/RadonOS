/**
 * Builds the hosted (static) flavour of RadonOS into `site/dist/`.
 *
 * The extension needs no bundler and neither does this: the desktop, the apps
 * and the shared kernel are already plain ES modules, so the build is a copy
 * plus a manifest for the deploy tool. Nothing from `tools/`, `site/`, the
 * extension manifest or the node_modules tree is published.
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

/** Published as-is from site/ next to the built assets. */
const WORKER = 'worker.js';

/**
 * Every hosted document gets a meta CSP.
 *
 * `site/_headers` is also shipped, but not every host applies it, so the
 * documents carry their own policy too. Directives that a meta tag cannot
 * express (frame-ancestors) live only in the headers file.
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

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const dir of INCLUDE) {
    await cp(join(ROOT, dir), join(DIST, dir), { recursive: true });
  }
  // Cloudflare serves these headers alongside the static files.
  await cp(join(SITE, '_headers'), join(DIST, '_headers'));

  const files = await walk(DIST);
  const forbidden = files.filter((file) => {
    const rel = relative(DIST, file);
    return /\.(map|pem|crx)$/i.test(rel)
      || /(^|[\\/])(node_modules|tools|\.wrangler|\.shots)([\\/]|$)/.test(rel)
      || rel === 'manifest.json';
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

  // The deploy tool resolves these paths relative to the manifest itself.
  await writeFile(
    join(SITE, 'deploy.json'),
    `${JSON.stringify({
      entrypoint: WORKER,
      compatibilityDate: '2026-10-18',
      modules: [{ name: WORKER, type: 'esm', path: `./${WORKER}` }],
      assetsDirectory: './dist',
      spa: false,
    }, null, 2)}\n`,
  );

  console.log(`Built ${files.length} files · ${(bytes / 1024).toFixed(1)} KiB → site/dist`);
  console.log('Manifest: site/deploy.json');
}

await main();
