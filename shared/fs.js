/**
 * RadonOS virtual file system.
 *
 * Every file and folder is a record in IndexedDB:
 *   { id, parentId, name, kind, mime, size, content, createdAt, updatedAt, origin }
 * Text files keep a string in `content`; binary files keep a Blob.
 * "Deleting" moves a node into the fixed `trash` folder, keeping its origin so
 * it can be restored. Every mutation is broadcast to other open pages.
 */
import { openDB, idb } from './idb.js';

export const ROOT_ID = 'root';
export const TRASH_ID = 'trash';

const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('radonos-fs') : null;
let readyPromise = null;

export const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);

function emit(detail, fromRemote = false) {
  for (const listener of listeners) {
    try { listener(detail); } catch (err) { console.warn(err); }
  }
  if (!fromRemote) channel?.postMessage({ type: 'change', detail });
}

if (channel) {
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'change') emit(event.data.detail, true);
  });
}

export function onFsChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const now = () => Date.now();
const norm = (value) => (value || '').trim();
const ext = (name) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index) : '';
};

export function mimeFor(name) {
  const e = ext(name).toLowerCase();
  return {
    '.txt': 'text/plain', '.md': 'text/markdown', '.js': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.html': 'text/html',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
  }[e] || 'application/octet-stream';
}

export function kindForMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'binary';
}

const WELCOME = `Welcome to RadonOS
==================

This desktop is a real, offline-first workspace that lives inside your
browser's new tab. Everything you create here is stored locally in an
IndexedDB virtual file system.

Try this:
  1. Double-click "Notepad" on the desktop and save a file.
  2. Open "Files" and look in Documents - your note is there.
  3. Open "Terminal" and run:  ls /Documents
  4. Drag desktop icons around; they snap to the grid.
  5. Right-click the desktop to change the wallpaper.

Nothing leaves your machine. No accounts, no servers, no tracking.
`;

const CHEATSHEET = `RadonOS quick reference
========================

Window controls
  Double-click title bar   Maximize / restore
  Drag title bar to edge   Snap to half screen
  Drag title bar to top    Maximize
  Alt+W                    Close focused window
  Alt+M                    Minimize focused window
  Alt+Tab                  Cycle windows
  Esc                      Close menus

Desktop
  Double-click icon        Launch app
  Right-click desktop      Context menu
  Drag icon                Reorder + auto-snap

Terminal
  help                     List every command
  ls /Documents            List a folder
  cat /Documents/RadonOS Cheatsheet.md
  open notepad             Launch an app
  theme light              Switch theme
  wallpaper aurora         Change wallpaper
  df                       Virtual disk usage
  neofetch                 System summary

Files
  Upload real files with the toolbar or drag-and-drop.
  Media app can play audio/video you upload.
`;

async function insert(node) {
  await idb.put('nodes', node);
  return node;
}

function makeNode({ id = uid(), parentId = ROOT_ID, name, kind = 'file', mime = '', content = null, size = 0, origin = null }) {
  const stamp = now();
  return {
    id,
    parentId,
    name,
    kind,
    mime: mime || (kind === 'folder' ? 'inode/directory' : mimeFor(name)),
    size: kind === 'folder' ? 0 : size,
    content,
    createdAt: stamp,
    updatedAt: stamp,
    origin,
  };
}

/**
 * Idempotent initialisation + repair. Uses the raw IndexedDB helpers only:
 * calling list()/byName() here would await `ready()` from inside the promise
 * that `ready()` is still resolving and deadlock the whole file system.
 */
async function seed() {
  const nodes = await idb.getAll('nodes');

  if (!nodes.some((node) => node.id === ROOT_ID)) {
    const root = makeNode({ id: ROOT_ID, parentId: null, name: 'Home', kind: 'folder' });
    await insert(root);
    nodes.push(root);
  }

  for (const name of ['Documents', 'Pictures', 'Downloads', 'Music', 'Videos']) {
    if (!nodes.some((node) => node.parentId === ROOT_ID && node.name === name && node.kind === 'folder')) {
      const folder = makeNode({ parentId: ROOT_ID, name, kind: 'folder' });
      await insert(folder);
      nodes.push(folder);
    }
  }

  if (!nodes.some((node) => node.id === TRASH_ID)) {
    const trash = makeNode({ id: TRASH_ID, parentId: ROOT_ID, name: 'Trash', kind: 'folder', mime: 'inode/directory' });
    await insert(trash);
    nodes.push(trash);
  }

  const seeded = await idb.get('kv', 'fs:seed');
  if (!seeded) {
    const documents = nodes.find((node) => node.parentId === ROOT_ID && node.name === 'Documents');
    const isEmpty = documents && !nodes.some((node) => node.parentId === documents.id);
    if (documents && isEmpty) {
      await insert(makeNode({
        parentId: documents.id, name: 'Welcome.txt', content: WELCOME, size: WELCOME.length,
      }));
      await insert(makeNode({
        parentId: documents.id,
        name: 'RadonOS Cheatsheet.md',
        content: CHEATSHEET,
        size: CHEATSHEET.length,
      }));
    }
    await idb.put('kv', { seeded: now() }, 'fs:seed');
  }
}

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await openDB();
      await seed();
      let trash = await idb.get('nodes', TRASH_ID);
      if (!trash) {
        trash = makeNode({ id: TRASH_ID, parentId: ROOT_ID, name: 'Trash', kind: 'folder', mime: 'inode/directory' });
        await insert(trash);
      }
      return true;
    })();
  }
  return readyPromise;
}

/* ------------------------------------------------------------------ reads */

export async function list(parentId = ROOT_ID) {
  await ready();
  const nodes = await idb.getAll('nodes');
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
}

export async function allNodes() {
  await ready();
  return idb.getAll('nodes');
}

export async function get(id) {
  await ready();
  return idb.get('nodes', id);
}

export async function byName(parentId, name) {
  const nodes = await list(parentId);
  const needle = norm(name).toLowerCase();
  return nodes.find((node) => node.name.toLowerCase() === needle) || null;
}

export async function pathOf(id) {
  await ready();
  const trail = [];
  let node = await idb.get('nodes', id);
  let guard = 0;
  while (node && guard++ < 100) {
    trail.unshift({ id: node.id, name: node.name });
    if (!node.parentId) break;
    node = await idb.get('nodes', node.parentId);
  }
  if (!trail.length) trail.push({ id: ROOT_ID, name: 'Home' });
  return trail;
}

export async function pathString(id) {
  const trail = await pathOf(id);
  if (trail.length === 1) return '/';
  return `/${trail.slice(1).map((part) => part.name).join('/')}`;
}

/** Resolve '/Documents/notes.txt', 'Documents/notes.txt', '..', '~' etc. */
export async function resolvePath(input, cwd = ROOT_ID) {
  await ready();
  const current = input == null ? cwd : String(input).trim();
  if (!current || current === '~' || current === '.') return get(current === '~' ? ROOT_ID : cwd);
  let node = current.startsWith('/') ? await get(ROOT_ID) : await get(cwd);
  const parts = current.split('/').filter(Boolean);
  for (const part of parts) {
    if (!node || node.kind !== 'folder') return null;
    if (part === '.') continue;
    if (part === '..') {
      node = node.parentId ? await get(node.parentId) : node;
      continue;
    }
    node = await byName(node.id, part);
  }
  return node || null;
}

export async function readText(id) {
  const node = await get(id);
  if (!node) return null;
  if (node.content instanceof Blob) return node.content.text();
  return typeof node.content === 'string' ? node.content : '';
}

export async function readBlob(id) {
  const node = await get(id);
  if (!node) return null;
  if (node.content instanceof Blob) return node.content;
  return new Blob([node.content ?? ''], { type: node.mime || 'text/plain' });
}

/* --------------------------------------------------------------- mutations */

async function assertName(parentId, name, ignoreId = null) {
  const clean = norm(name);
  if (!clean) throw new Error('Name cannot be empty');
  if (clean.includes('/') || clean.includes('\\')) throw new Error('Name cannot contain slashes');
  const siblings = await list(parentId);
  const clash = siblings.find(
    (node) => node.id !== ignoreId && node.name.toLowerCase() === clean.toLowerCase(),
  );
  if (clash) throw new Error(`"${clean}" already exists here`);
  return clean;
}

async function uniqueName(parentId, name, ignoreId = null) {
  const siblings = await list(parentId);
  const taken = new Set(
    siblings.filter((node) => node.id !== ignoreId).map((node) => node.name.toLowerCase()),
  );
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : '';
  let index = 2;
  while (taken.has(`${base} (${index})${suffix}`.toLowerCase())) index += 1;
  return `${base} (${index})${suffix}`;
}

export async function mkdir(parentId, name) {
  await ready();
  const parent = await get(parentId);
  if (!parent || parent.kind !== 'folder') throw new Error('Target folder does not exist');
  const clean = await assertName(parentId, name);
  const node = makeNode({ parentId, name: clean, kind: 'folder' });
  await insert(node);
  emit({ type: 'create', id: node.id, parentId });
  return node;
}

export async function createFile(parentId, name, content = '', mime) {
  await ready();
  const parent = await get(parentId);
  if (!parent || parent.kind !== 'folder') throw new Error('Target folder does not exist');
  const clean = await assertName(parentId, name);
  const isBlob = content instanceof Blob;
  const node = makeNode({
    parentId,
    name: clean,
    mime: mime || (isBlob ? content.type : mimeFor(clean)),
    content,
    size: isBlob ? content.size : String(content).length,
  });
  await insert(node);
  emit({ type: 'create', id: node.id, parentId });
  return node;
}

/** Write a text file, creating it or replacing the content of `id`. */
export async function writeText({ id, parentId = ROOT_ID, name, content }) {
  await ready();
  if (id) {
    const node = await get(id);
    if (!node) throw new Error('File not found');
    const next = { ...node, content: String(content), size: String(content).length, updatedAt: now() };
    if (name && name !== node.name) {
      next.name = await assertName(node.parentId, name, node.id);
    }
    await idb.put('nodes', next);
    emit({ type: 'update', id: node.id, parentId: node.parentId });
    return next;
  }
  const clean = name || 'Untitled.txt';
  const parent = await get(parentId);
  if (!parent) throw new Error('Target folder does not exist');
  const existing = await byName(parentId, clean);
  if (existing) return writeText({ id: existing.id, content });
  const node = makeNode({
    parentId,
    name: await assertName(parentId, clean),
    content: String(content),
    size: String(content).length,
    mime: mimeFor(clean),
  });
  await insert(node);
  emit({ type: 'create', id: node.id, parentId });
  return node;
}

export async function writeBlob(parentId, file) {
  await ready();
  const parent = await get(parentId);
  if (!parent) throw new Error('Target folder does not exist');
  const name = await uniqueName(parentId, file.name || 'upload.bin');
  const node = makeNode({
    parentId,
    name,
    kind: 'file',
    mime: file.type || mimeFor(name),
    content: file,
    size: file.size,
  });
  await insert(node);
  emit({ type: 'create', id: node.id, parentId });
  return node;
}

export async function rename(id, name) {
  const node = await get(id);
  if (!node) throw new Error('Not found');
  if (node.id === ROOT_ID || node.id === TRASH_ID) throw new Error('This folder cannot be renamed');
  const next = {
    ...node,
    name: await assertName(node.parentId, name, node.id),
    updatedAt: now(),
  };
  await idb.put('nodes', next);
  emit({ type: 'update', id, parentId: node.parentId });
  return next;
}

export async function updateMeta(id, patch) {
  const node = await get(id);
  if (!node) throw new Error('Not found');
  const next = { ...node, ...patch, id: node.id, updatedAt: now() };
  await idb.put('nodes', next);
  emit({ type: 'update', id, parentId: next.parentId });
  return next;
}

async function descendants(id) {
  const nodes = await allNodes();
  const out = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const node of nodes) {
      if (node.parentId === current) {
        out.push(node);
        if (node.kind === 'folder') stack.push(node.id);
      }
    }
  }
  return out;
}

export async function move(id, newParentId) {
  const node = await get(id);
  const target = await get(newParentId);
  if (!node || !target) throw new Error('Not found');
  if (target.kind !== 'folder') throw new Error('Target is not a folder');
  if (id === ROOT_ID || id === TRASH_ID) throw new Error('This folder cannot be moved');
  if (id === newParentId) throw new Error('Cannot move a folder into itself');
  const kids = await descendants(id);
  if (kids.some((child) => child.id === newParentId)) {
    throw new Error('Cannot move a folder into its own contents');
  }
  const next = {
    ...node,
    parentId: newParentId,
    origin: newParentId === TRASH_ID ? node.parentId : null,
    name: await uniqueName(newParentId, node.name, node.id),
    updatedAt: now(),
  };
  await idb.put('nodes', next);
  emit({ type: 'move', id, parentId: newParentId });
  return next;
}

export async function trash(id) {
  if (id === ROOT_ID || id === TRASH_ID) throw new Error('This folder cannot be deleted');
  return move(id, TRASH_ID);
}

export async function restore(id) {
  const node = await get(id);
  if (!node) throw new Error('Not found');
  const target = node.origin && (await get(node.origin)) ? node.origin : ROOT_ID;
  return move(id, target);
}

export async function deleteForever(id) {
  if (id === ROOT_ID || id === TRASH_ID) throw new Error('This folder cannot be deleted');
  const node = await get(id);
  if (!node) return;
  const kids = await descendants(id);
  for (const child of kids.reverse()) await idb.delete('nodes', child.id);
  await idb.delete('nodes', id);
  emit({ type: 'delete', id, parentId: node.parentId });
}

export async function emptyTrash() {
  const nodes = await list(TRASH_ID);
  for (const node of nodes) await deleteForever(node.id);
  emit({ type: 'empty-trash', parentId: TRASH_ID });
}

export async function search(term, { within = null } = {}) {
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return [];
  const nodes = await allNodes();
  const scope = within ? new Set((await descendants(within)).map((n) => n.id)) : null;
  return nodes
    .filter((node) => node.id !== ROOT_ID && node.parentId !== null)
    .filter((node) => !scope || scope.has(node.id))
    .filter((node) => node.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function stats() {
  const nodes = await allNodes();
  const files = nodes.filter((node) => node.kind === 'file');
  const folders = nodes.filter((node) => node.kind === 'folder');
  const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const trashNodes = nodes.filter((node) => node.parentId === TRASH_ID);
  return {
    files: files.length,
    folders: folders.length,
    bytes,
    trash: trashNodes.length,
    nodes: nodes.length,
  };
}

export async function download(node) {
  const target = typeof node === 'string' ? await get(node) : node;
  if (!target) throw new Error('File not found');
  const blob = await readBlob(target.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = target.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
