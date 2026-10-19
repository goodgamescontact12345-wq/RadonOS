/**
 * FILE: shared/storageManager.js
 *
 * One import surface for everything RadonOS persists.
 *
 * The individual backends already exist and stay independent:
 *
 *   IndexedDB (`idb.js`)      -> virtual file system nodes + wallpaper blob
 *   chrome.storage / LS       -> settings and small key/value state
 *   `fs.js`                   -> the only writer of VFS nodes
 *   `settings.js`             -> the only writer of configuration
 *
 * This module adds the ergonomics that were missing for callers such as the
 * terminal and the command bar: POSIX-style paths, mkdir -p semantics,
 * dotfile JSON helpers under /System/Config, and a single capacity report.
 * Nothing here duplicates a backend; every write funnels through fs.js or
 * settings.js so change events keep firing for every open window.
 */
import * as FS from './fs.js';
import { idb } from './idb.js';
import { isExtension } from './platform.js';
import {
  getSettings, loadSettings, updateSettings, replaceSettings, resetSettings, onSettingsChange,
} from './settings.js';

export const CONFIG_DIR = '/System/Config';

const clean = (path) => String(path ?? '').trim().replace(/\/{2,}/g, '/');

/** Split "/a/b/c.txt" into { dir: '/a/b', name: 'c.txt' }. */
export function splitPath(path) {
  const value = clean(path);
  const index = value.lastIndexOf('/');
  if (index <= 0) return { dir: '/', name: value.replace(/^\//, '') };
  return { dir: value.slice(0, index), name: value.slice(index + 1) };
}

async function nodeOrThrow(path, cwd) {
  const node = await FS.resolvePath(path, cwd);
  if (!node) throw new Error(`No such file or directory: ${path}`);
  return node;
}

/** Create every missing folder in `/a/b/c` and return the deepest node. */
export async function mkdirp(path, cwd = FS.ROOT_ID) {
  const value = clean(path);
  let node = value.startsWith('/') ? await FS.get(FS.ROOT_ID) : await FS.get(cwd);
  for (const part of value.split('/').filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') {
      node = node?.parentId ? await FS.get(node.parentId) : node;
      continue;
    }
    const existing = node ? await FS.byName(node.id, part) : null;
    if (existing) {
      if (existing.kind !== 'folder') throw new Error(`${part} is not a folder`);
      node = existing;
      continue;
    }
    node = await FS.mkdir(node.id, part);
  }
  return node;
}

export async function stat(node, { cwd = FS.ROOT_ID } = {}) {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    mime: node.mime || (node.kind === 'folder' ? 'inode/directory' : 'text/plain'),
    size: node.kind === 'folder' ? 0 : Number(node.size) || 0,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt || node.createdAt,
    parentId: node.parentId,
    cwd,
    path: await FS.pathString(node.id),
  };
}

/* ------------------------------------------------------------------- vfs */
export const vfs = {
  /** Read a text file by path. Throws for missing paths and folders. */
  async read(path, { cwd = FS.ROOT_ID } = {}) {
    const node = await nodeOrThrow(path, cwd);
    if (node.kind === 'folder') throw new Error(`${path} is a folder`);
    return FS.readText(node.id);
  },

  /** Read a binary file by path and return a Blob. */
  async readBlob(path, { cwd = FS.ROOT_ID } = {}) {
    const node = await nodeOrThrow(path, cwd);
    if (node.kind === 'folder') throw new Error(`${path} is a folder`);
    return FS.readBlob(node.id);
  },

  /**
   * Write text, creating parent folders as needed (mkdir -p). Existing files
   * are updated in place so their id, mime type and metadata survive.
   */
  async write(path, content, { cwd = FS.ROOT_ID, mime } = {}) {
    const { dir, name } = splitPath(path);
    if (!name) throw new Error('A file name is required');
    const parent = await mkdirp(dir, cwd);
    const existing = await FS.byName(parent.id, name);
    if (existing) {
      if (existing.kind === 'folder') throw new Error(`${path} is a folder`);
      return FS.writeText({ id: existing.id, content });
    }
    return FS.createFile(parent.id, name, content, mime);
  },

  /** Write a Blob/File into a folder path (used by drag-and-drop imports). */
  async writeBlob(path, blob, { cwd = FS.ROOT_ID } = {}) {
    const { dir } = splitPath(path);
    const parent = await mkdirp(dir, cwd);
    const named = blob instanceof File ? blob : new File([blob], splitPath(path).name, { type: blob.type });
    return FS.writeBlob(parent.id, named);
  },

  /** List a folder (or describe a single file) with normalised metadata. */
  async list(path = '/', { cwd = FS.ROOT_ID } = {}) {
    const node = await FS.resolvePath(path || '/', cwd);
    if (!node) throw new Error(`No such file or directory: ${path}`);
    if (node.kind !== 'folder') return [await stat(node, { cwd })];
    const children = await FS.list(node.id);
    return Promise.all(children.map((child) => stat(child, { cwd })));
  },

  async stat(path, { cwd = FS.ROOT_ID } = {}) {
    return stat(await nodeOrThrow(path, cwd), { cwd });
  },

  async exists(path, { cwd = FS.ROOT_ID } = {}) {
    return Boolean(await FS.resolvePath(path, cwd));
  },

  async mkdir(path, { cwd = FS.ROOT_ID } = {}) {
    return mkdirp(path, cwd);
  },

  /** Move to Trash by default; `permanent: true` removes it from the disk. */
  async remove(path, { cwd = FS.ROOT_ID, permanent = false } = {}) {
    const node = await nodeOrThrow(path, cwd);
    if (node.id === FS.ROOT_ID) throw new Error('Refusing to remove the root folder');
    if (permanent) await FS.deleteForever(node.id);
    else await FS.trash(node.id);
    return stat(node, { cwd });
  },

  async move(path, targetDir, { cwd = FS.ROOT_ID } = {}) {
    const node = await nodeOrThrow(path, cwd);
    const target = await nodeOrThrow(targetDir, cwd);
    if (target.kind !== 'folder') throw new Error('Destination is not a folder');
    return FS.move(node.id, target.id);
  },

  async rename(path, name, { cwd = FS.ROOT_ID } = {}) {
    const node = await nodeOrThrow(path, cwd);
    return FS.rename(node.id, name);
  },

  /** Recursive search across the virtual disk. */
  async find(term, options = {}) {
    const nodes = await FS.search(term, options);
    return Promise.all(nodes.map((node) => stat(node)));
  },
};

/* ---------------------------------------------------------------- config */
export const config = {
  async load() {
    return loadSettings();
  },
  all() {
    return getSettings();
  },
  get(key, fallback = undefined) {
    const settings = getSettings();
    return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
  },
  /** Deep-merge a patch into the settings and persist it. */
  async patch(patch) {
    return updateSettings(patch);
  },
  async replace(value) {
    return replaceSettings(value);
  },
  async reset() {
    return resetSettings();
  },
  async subscribe(callback) {
    return onSettingsChange(callback);
  },
};

/* --------------------------------------------------------------- dotfiles */
async function configDir() {
  return mkdirp(CONFIG_DIR);
}

const dotfilePath = (name) => `${CONFIG_DIR}/${String(name).replace(/^\.+/, '').replace(/\//g, '-')}.json`;

export const dotfiles = {
  /** Absolute VFS path a dotfile is stored at. */
  pathFor(name) {
    return dotfilePath(name);
  },

  async list() {
    const dir = await configDir();
    const nodes = await FS.list(dir.id);
    const entries = [];
    for (const node of nodes.filter((item) => item.kind === 'file')) {
      let value = null;
      try {
        value = JSON.parse(await FS.readText(node.id));
      } catch { /* keep the raw entry visible even when invalid */ }
      entries.push({ name: node.name.replace(/\.json$/, ''), path: await FS.pathString(node.id), value });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  },

  async read(name, fallback = null) {
    const path = dotfilePath(name);
    try {
      return JSON.parse(await vfs.read(path));
    } catch {
      return fallback;
    }
  },

  async write(name, value) {
    const path = dotfilePath(name);
    await vfs.write(path, JSON.stringify(value, null, 2));
    return path;
  },

  async remove(name) {
    const path = dotfilePath(name);
    if (!await vfs.exists(path)) return false;
    await vfs.remove(path, { permanent: true });
    return true;
  },
};

/* -------------------------------------------------------------- capacity */
/** Storage report used by `df`, Settings -> Storage and `sysmon`. */
export async function capacity() {
  const [nodes, fsStats] = await Promise.all([idb.getAll('nodes'), FS.stats()]);
  let quota = null;
  let usage = null;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota ?? null;
      usage = estimate.usage ?? null;
    }
  } catch { /* estimate is optional */ }
  return {
    backend: isExtension ? 'chrome.storage + IndexedDB' : 'localStorage + IndexedDB',
    nodes: nodes.length,
    folders: fsStats.folders,
    files: fsStats.files,
    bytes: nodes.reduce((sum, node) => sum + (Number(node.size) || 0), 0),
    quota,
    usage,
  };
}

export const storageManager = { vfs, config, dotfiles, capacity, mkdirp, splitPath, stat };

export default storageManager;
