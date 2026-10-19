/**
 * Structural validation for the unpacked extension.
 *
 *  - manifest.json parses, every referenced file exists
 *  - every <script src> / <link href> in HTML resolves
 *  - every relative ES module import resolves
 *  - no MV3 CSP violations (inline handlers, javascript: URLs, eval / new Function)
 *
 *   node tools/validate.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const rel = (path) => path.replace(ROOT + sep, '').replace(/\\/g, '/');

/** Directories that are not part of the shipped project. */
const SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', '.shots']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) out.push(...await walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const files = await walk(ROOT);
const relFiles = files.map(rel).filter((path) => !path.startsWith('tools/'));

/* ------------------------------------------------------------- manifest */
let manifest;
try {
  manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
} catch (err) {
  problems.push(`manifest.json is not valid JSON: ${err.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  const referenced = [
    manifest.background?.service_worker,
    manifest.chrome_url_overrides?.newtab,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ].filter(Boolean);
  for (const path of referenced) {
    if (!await exists(join(ROOT, path))) problems.push(`manifest references missing file: ${path}`);
  }
  if (!manifest.permissions?.includes('storage')) notes.push('permissions: storage missing');
  const required = ['storage', 'unlimitedStorage', 'tabs', 'activeTab', 'alarms', 'notifications', 'contextMenus'];
  for (const scope of required) {
    if (!manifest.permissions?.includes(scope)) problems.push(`manifest is missing the "${scope}" permission`);
  }
}

/* ------------------------------------------------- html + module imports */
const htmlFiles = relFiles.filter((path) => path.endsWith('.html'));
for (const path of htmlFiles) {
  const html = await readFile(join(ROOT, path), 'utf8');
  const refs = [
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+href="([^"]+)"/g),
  ].map((match) => match[1]).filter((ref) => !ref.startsWith('http') && !ref.startsWith('data:'));

  for (const ref of refs) {
    const target = resolve(dirname(join(ROOT, path)), ref.split('?')[0]);
    if (!await exists(target)) problems.push(`${path} references missing file: ${ref}`);
  }
  const inlineHandlers = [...html.matchAll(/\son[a-z]+\s*=\s*"/gi)].map((m) => m[0].trim());
  if (inlineHandlers.length) {
    problems.push(`${path} uses inline event handlers (blocked by MV3 CSP): ${[...new Set(inlineHandlers)].join(', ')}`);
  }
  if (/javascript:/i.test(html)) problems.push(`${path} contains a javascript: URL`);
  if (!/<meta charset="utf-8">/i.test(html)) notes.push(`${path} has no explicit <meta charset>`);
}

const scriptFiles = relFiles.filter((path) => path.endsWith('.js'));
for (const path of scriptFiles) {
  const source = await readFile(join(ROOT, path), 'utf8');
  const imports = [
    ...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]);

  for (const spec of imports) {
    const target = resolve(dirname(join(ROOT, path)), spec.split('?')[0]);
    if (!await exists(target)) problems.push(`${path} imports missing module: ${spec}`);
  }
  if (/\beval\s*\(/.test(source)) problems.push(`${path} uses eval() (blocked by MV3 CSP)`);
  if (/new\s+Function\s*\(/.test(source)) problems.push(`${path} uses new Function() (blocked by MV3 CSP)`);
  if (/document\.write\s*\(/.test(source)) notes.push(`${path} uses document.write()`);
}

/* ----------------------------------------------------------- statistics */
const jsLines = (await Promise.all(scriptFiles.map(async (path) => (
  (await readFile(join(ROOT, path), 'utf8')).split('\n').length
)))).reduce((sum, value) => sum + value, 0);
const cssLines = (await Promise.all(relFiles.filter((p) => extname(p) === '.css').map(async (path) => (
  (await readFile(join(ROOT, path), 'utf8')).split('\n').length
)))).reduce((sum, value) => sum + value, 0);

console.log(`Checked ${relFiles.length} project files (${scriptFiles.length} JS, ${htmlFiles.length} HTML).`);
console.log(`JavaScript: ${jsLines} lines · CSS: ${cssLines} lines`);
for (const note of notes) console.log(`  note: ${note}`);

if (problems.length) {
  console.error('\nFAILED');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('\nAll structural checks passed.');
