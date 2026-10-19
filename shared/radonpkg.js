/**
 * FILE: shared/radonpkg.js
 *
 * `radonpkg` is RadonOS's tiny package manager. It ships a catalogue of six
 * self-contained CLI tools, installs them into the user's profile, writes a
 * manifest for each one to /System/Packages, and hands the terminal the
 * implementations to merge into its command table.
 *
 * Nothing is downloaded: the "packages" are a few hundred lines of real
 * JavaScript that would otherwise bloat the default command set. Installing
 * one is an explicit, reversible act supported by the Settings export/import
 * path (the installed ids live in settings.packages).
 */
import { getSettings, updateSettings } from './settings.js';
import { vfs, capacity } from './storageManager.js';
import * as FS from './fs.js';

export const MANIFEST_DIR = '/System/Packages';

export const PACKAGES = [
  {
    id: 'json-tools',
    name: 'json-tools',
    version: '1.2.0',
    size: '6 KB',
    description: 'Pretty-print and validate JSON from a file or an inline string',
    commands: ['json'],
    tags: 'json format pretty validate data jq',
  },
  {
    id: 'b64',
    name: 'b64',
    version: '1.0.2',
    size: '4 KB',
    description: 'Base64 encode and decode UTF-8 text',
    commands: ['base64'],
    tags: 'base64 encode decode text transform',
  },
  {
    id: 'uuidgen',
    name: 'uuidgen',
    version: '1.0.0',
    size: '3 KB',
    description: 'Generate RFC 4122 version 4 UUIDs',
    commands: ['uuid'],
    tags: 'uuid random identifier generate id',
  },
  {
    id: 'hashsum',
    name: 'hashsum',
    version: '1.1.0',
    size: '5 KB',
    description: 'SHA-256 digests for text or files in the virtual disk',
    commands: ['hash'],
    tags: 'hash sha256 checksum integrity crypto',
  },
  {
    id: 'sysmon',
    name: 'sysmon',
    version: '1.3.1',
    size: '7 KB',
    description: 'Memory, storage and runtime report',
    commands: ['sysmon'],
    tags: 'system monitor memory disk performance stats',
  },
  {
    id: 'tidy',
    name: 'tidy',
    version: '1.0.1',
    size: '3 KB',
    description: 'Empty the trash and report the space you reclaimed',
    commands: ['tidy'],
    tags: 'trash clean disk free space cleanup',
  },
];

export const PACKAGE_MAP = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]));

/* --------------------------------------------------------------- helpers */
export function installedIds() {
  const list = getSettings().packages;
  return Array.isArray(list) ? list.filter((id) => PACKAGE_MAP.has(id)) : [];
}

export function isInstalled(id) {
  return installedIds().includes(id);
}

export function installedPackages() {
  return installedIds().map((id) => PACKAGE_MAP.get(id));
}

/** Search the catalogue by id, name, description and tags. */
export function search(term) {
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return [...PACKAGES];
  return PACKAGES.filter((pkg) => (
    pkg.id.includes(needle)
    || pkg.tags.includes(needle)
    || pkg.description.toLowerCase().includes(needle)
  ));
}

const manifestPath = (id) => `${MANIFEST_DIR}/${id}.json`;

/* -------------------------------------------------------------- install */
export async function install(id) {
  const pkg = PACKAGE_MAP.get(id);
  if (!pkg) throw new Error(`No such package: ${id}`);
  const ids = installedIds();
  if (ids.includes(id)) throw new Error(`${id} is already installed`);
  await updateSettings({ packages: [...ids, id] });
  await vfs.write(manifestPath(id), JSON.stringify({
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    commands: pkg.commands,
    installedAt: new Date().toISOString(),
    source: 'radonpkg',
  }, null, 2));
  return pkg;
}

export async function remove(id) {
  const ids = installedIds();
  if (!ids.includes(id)) throw new Error(`${id} is not installed`);
  await updateSettings({ packages: ids.filter((item) => item !== id) });
  if (await vfs.exists(manifestPath(id))) {
    await vfs.remove(manifestPath(id), { permanent: true });
  }
  return PACKAGE_MAP.get(id);
}

/** Verify the on-disk manifest for an installed package still exists. */
export async function manifest(id) {
  if (!await vfs.exists(manifestPath(id))) return null;
  try {
    return JSON.parse(await vfs.read(manifestPath(id)));
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- tools */
const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToUtf8 = (text) => {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const hex = (buffer) => [...new Uint8Array(buffer)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const looksLikeJson = (value) => /^[[{"]/.test(value.trim());

/**
 * Terminal implementations, keyed by command name.
 * Each receives the terminal context: { print, escape, formatBytes, vfs, state }.
 */
export const TOOLS = {
  json: {
    usage: 'json <file|json>',
    description: 'Pretty-print JSON from a file or inline value',
    async run(ctx, args) {
      const input = args.join(' ').trim();
      if (!input) throw new Error('Usage: json <file|json>');
      const raw = looksLikeJson(input) ? input : await ctx.vfs.read(input, { cwd: ctx.state.cwd });
      let value;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
      const pretty = JSON.stringify(value, null, 2);
      ctx.print(`<pre class="term-pre">${ctx.escape(pretty)}</pre>`);
      ctx.print(`${Array.isArray(value) ? `${value.length} items` : `${Object.keys(value ?? {}).length} keys`} · ${pretty.length} bytes`, 'dim');
    },
  },

  base64: {
    usage: 'base64 <encode|decode> <text>',
    description: 'Base64 encode or decode UTF-8 text',
    async run(ctx, args) {
      const [mode, ...rest] = args;
      const text = rest.join(' ');
      if (!mode || !text) throw new Error('Usage: base64 <encode|decode> <text>');
      if (mode === 'encode') {
        ctx.print(ctx.escape(utf8ToBase64(text)));
        return;
      }
      if (mode !== 'decode') throw new Error('Mode must be encode or decode');
      try {
        ctx.print(ctx.escape(base64ToUtf8(text)));
      } catch {
        throw new Error('Input is not valid base64');
      }
    },
  },

  uuid: {
    usage: 'uuid [count]',
    description: 'Generate RFC 4122 v4 UUIDs',
    async run(ctx, args) {
      const count = Math.min(50, Math.max(1, Number(args[0]) || 1));
      for (let index = 0; index < count; index += 1) {
        ctx.print(crypto.randomUUID());
      }
      if (count > 1) ctx.print(`${count} UUIDs generated`, 'dim');
    },
  },

  hash: {
    usage: 'hash <text> | hash --file <path>',
    description: 'SHA-256 digest of text or a file',
    async run(ctx, args) {
      if (!args.length) throw new Error('Usage: hash <text> | hash --file <path>');
      let input;
      let label;
      if (args[0] === '--file' || args[0] === '-f') {
        const path = args[1];
        if (!path) throw new Error('Usage: hash --file <path>');
        const blob = await ctx.vfs.readBlob(path, { cwd: ctx.state.cwd });
        input = new Uint8Array(await blob.arrayBuffer());
        label = `${path} (${ctx.formatBytes(input.byteLength)})`;
      } else {
        input = new TextEncoder().encode(args.join(' '));
        label = 'stdin (text)';
      }
      const digest = await crypto.subtle.digest('SHA-256', input);
      ctx.print(`<span class="accent">${hex(digest)}</span>`);
      ctx.print(`SHA-256 · ${label}`, 'dim');
    },
  },

  sysmon: {
    usage: 'sysmon',
    description: 'Memory, storage and runtime report',
    async run(ctx) {
      const report = await capacity();
      const memory = performance.memory;
      const rows = [
        ['Backend', report.backend],
        ['Virtual disk', `${report.files} files · ${report.folders} folders`],
        ['Disk bytes', ctx.formatBytes(report.bytes)],
        ['Browser quota', report.quota ? `${ctx.formatBytes(report.usage || 0)} / ${ctx.formatBytes(report.quota)}` : 'not reported'],
        ['JS heap', memory ? `${ctx.formatBytes(memory.usedJSHeapSize)} / ${ctx.formatBytes(memory.jsHeapSizeLimit)}` : 'not exposed'],
        ['CPU threads', String(navigator.hardwareConcurrency || '?')],
        ['Viewport', `${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio || 1}x`],
        ['Uptime', `${Math.round(performance.now() / 1000)}s this window`],
      ];
      ctx.print('<b>sysmon</b>');
      for (const [key, value] of rows) {
        ctx.print(`<span class="dim">${ctx.escape(key.padEnd(14, ' '))}</span> ${ctx.escape(value)}`);
      }
    },
  },

  tidy: {
    usage: 'tidy',
    description: 'Empty the trash and report reclaimed space',
    async run(ctx) {
      const before = await FS.stats();
      if (!before.trash) {
        ctx.print('Trash is already empty', 'dim');
        return;
      }
      await FS.emptyTrash();
      const after = await FS.stats();
      const freed = Math.max(0, before.bytes - after.bytes);
      ctx.print(`Removed ${before.trash} item${before.trash === 1 ? '' : 's'} · freed ${ctx.formatBytes(freed)}`, 'ok');
    },
  },
};

/** Command table contributed by installed packages. */
export function installedTools() {
  const table = {};
  for (const pkg of installedPackages()) {
    for (const name of pkg.commands) {
      if (TOOLS[name]) table[name] = TOOLS[name];
    }
  }
  return table;
}
