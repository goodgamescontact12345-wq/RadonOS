import { icon } from '../../shared/icons.js';
import * as FS from '../../shared/fs.js';
import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import {
  showContextMenu, promptDialog, confirmDialog, showModal, toast, paintIcons,
  escapeHtml, formatBytes, formatDate, relativeTime, emptyState, openApp, debounce,
} from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const QUICK = [
  { name: 'Home', icon: 'home', resolve: () => FS.ROOT_ID },
  { name: 'Documents', icon: 'file-text', resolve: () => folderId('Documents') },
  { name: 'Pictures', icon: 'image', resolve: () => folderId('Pictures') },
  { name: 'Downloads', icon: 'download', resolve: () => folderId('Downloads') },
  { name: 'Music', icon: 'music', resolve: () => folderId('Music') },
  { name: 'Videos', icon: 'video', resolve: () => folderId('Videos') },
  { name: 'Trash', icon: 'trash', resolve: () => FS.TRASH_ID },
];

let foldersByName = new Map();

function folderId(name) {
  return foldersByName.get(name.toLowerCase()) || FS.ROOT_ID;
}

const state = {
  currentId: FS.ROOT_ID,
  history: [FS.ROOT_ID],
  index: 0,
  view: 'list',
  selection: new Set(),
  nodes: [],
  all: [],
  counts: new Map(),
  query: '',
  searching: false,
};

/* --------------------------------------------------------------- helpers */
const kindClassFor = (node) => {
  if (node.kind === 'folder') return 'folder';
  return FS.kindForMime(node.mime);
};

function iconFor(node) {
  if (node.kind === 'folder') return node.id === FS.TRASH_ID ? 'trash' : 'folder';
  const kind = FS.kindForMime(node.mime);
  if (kind === 'image') return 'image';
  if (kind === 'audio') return 'music';
  if (kind === 'video') return 'video';
  if (/\.(md|txt|log|json|js|css|html)$/i.test(node.name)) return 'file-text';
  return 'file';
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/* ----------------------------------------------------------- navigation */
function navigate(id, { push = true } = {}) {
  state.currentId = id;
  state.selection.clear();
  state.query = '';
  $('#search').value = '';
  state.searching = false;
  if (push) {
    state.history = state.history.slice(0, state.index + 1);
    state.history.push(id);
    state.index = state.history.length - 1;
  }
  void render();
}

function goBack() {
  if (state.index <= 0) return;
  state.index -= 1;
  navigate(state.history[state.index], { push: false });
}

function goForward() {
  if (state.index >= state.history.length - 1) return;
  state.index += 1;
  navigate(state.history[state.index], { push: false });
}

async function goUp() {
  const node = await FS.get(state.currentId);
  if (node?.parentId) navigate(node.parentId);
}

/* --------------------------------------------------------------- render */
async function render() {
  foldersByName = new Map();
  state.all = await FS.allNodes();
  for (const node of state.all) {
    if (node.kind === 'folder') foldersByName.set(node.name.toLowerCase(), node.id);
  }
  state.counts = new Map();
  for (const node of state.all) {
    if (!state.all.length) break;
    state.counts.set(node.parentId, (state.counts.get(node.parentId) || 0) + 1);
  }

  if (state.searching && state.query) {
    state.nodes = await FS.search(state.query, { within: state.currentId });
  } else {
    state.nodes = await FS.list(state.currentId);
  }

  await renderSidebar();
  await renderCrumbs();
  renderList();
  renderToolbar();
  await renderStatus();
}

async function renderSidebar() {
  const sidebar = $('#sidebar');
  const usage = await FS.stats().catch(() => ({ bytes: 0, trash: 0 }));
  const estimate = await navigator.storage?.estimate?.().catch(() => null) || null;
  const quota = estimate?.quota || 0;
  const used = estimate?.usage || usage.bytes;
  const percent = quota ? Math.min(100, (used / quota) * 100) : 12;

  const items = QUICK.map((entry) => {
    const id = entry.resolve();
    const count = state.counts.get(id) || 0;
    const active = state.currentId === id;
    return `
      <button class="sidebar-item${active ? ' active' : ''}" data-target="${id}">
        <span class="quick-icon" style="background:color-mix(in srgb, var(--accent) 12%, transparent)">${icon(entry.icon, { size: 14 })}</span>
        <span>${entry.name}</span>
        <span class="count">${count}</span>
      </button>`;
  }).join('');

  sidebar.innerHTML = `
    <div class="sidebar-title">Quick access</div>
    <div class="sidebar-group">${items}</div>
    <div class="sidebar-foot">
      <div class="sidebar-title" style="padding:0 0 4px">Storage</div>
      <div class="storage-meter"><span style="width:${percent}%"></span></div>
      <div class="ros-hint">${formatBytes(used)}${quota ? ` of ${formatBytes(quota)}` : ''} used<br>${plural(usage.files || 0, 'file')} · ${plural(usage.trash || 0, 'item')} in trash</div>
    </div>`;

  sidebar.querySelectorAll('[data-target]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.target));
  });
}

async function renderCrumbs() {
  const trail = await FS.pathOf(state.currentId);
  const host = $('#crumbs');
  host.innerHTML = trail.map((part, index) => `
    ${index ? '<span class="crumb-sep">›</span>' : ''}
    <button class="crumb${index === trail.length - 1 ? ' last' : ''}" data-crumb="${part.id}">${escapeHtml(index === 0 ? 'Home' : part.name)}</button>
  `).join('');
  host.querySelectorAll('[data-crumb]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.crumb));
  });
}

function renderList() {
  const host = $('#list-host');
  const { nodes } = state;

  if (!nodes.length) {
    host.innerHTML = emptyState(
      state.searching ? 'search' : 'folder',
      state.searching ? `Nothing matches “${state.query}” here.` : 'This folder is empty. Drop files here to add them.',
    );
    return;
  }

  if (state.view === 'grid') {
    host.innerHTML = `<div class="file-grid">${nodes.map((node) => `
      <button class="grid-cell${state.selection.has(node.id) ? ' selected' : ''}" data-id="${node.id}" title="${escapeHtml(node.name)}">
        <span class="file-icon ${kindClassFor(node)}">${icon(iconFor(node), { size: 18 })}</span>
        <span class="grid-label">${escapeHtml(node.name)}</span>
      </button>`).join('')}</div>`;
  } else {
    host.innerHTML = `<div class="file-list">${nodes.map((node) => {
      const secondary = state.searching ? 'in folder' : formatDate(node.updatedAt);
      const size = node.kind === 'folder'
        ? plural(state.counts.get(node.id) || 0, 'item')
        : formatBytes(node.size || 0);
      return `
        <button class="file-row${state.selection.has(node.id) ? ' selected' : ''}" data-id="${node.id}">
          <span class="file-name">
            <span class="file-icon ${kindClassFor(node)}">${icon(iconFor(node), { size: 15 })}</span>
            <span>${escapeHtml(node.name)}</span>
          </span>
          <span class="file-meta">${secondary}</span>
          <span class="file-meta">${size}</span>
        </button>`;
    }).join('')}</div>`;
  }

  host.querySelectorAll('[data-id]').forEach((row) => {
    const node = nodes.find((item) => item.id === row.dataset.id);
    row.addEventListener('click', (event) => select(node, event));
    row.addEventListener('dblclick', () => openNode(node));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (!state.selection.has(node.id)) select(node, { ctrlKey: false });
      showNodeMenu(node, event.clientX, event.clientY);
    });
  });
}

function renderToolbar() {
  $('#nav-back').disabled = state.index <= 0;
  $('#nav-forward').disabled = state.index >= state.history.length - 1;
  const inTrash = state.currentId === FS.TRASH_ID;
  $('#empty-trash').hidden = !inTrash;
  const toggle = $('#view-toggle');
  toggle.innerHTML = icon(state.view === 'list' ? 'grid' : 'list', { size: 17 });
  toggle.title = state.view === 'list' ? 'Switch to grid view' : 'Switch to list view';
}

async function renderStatus() {
  const usage = await FS.stats().catch(() => ({ bytes: 0 }));
  const count = state.nodes.length;
  $('#status-count').textContent = state.searching
    ? `${plural(count, 'result')} for “${state.query}”`
    : plural(count, 'item');
  $('#status-selection').textContent = state.selection.size
    ? `· ${state.selection.size} selected (${formatBytes(
      state.nodes.filter((node) => state.selection.has(node.id)).reduce((sum, node) => sum + (node.size || 0), 0),
    )})`
    : '';
  $('#status-disk').textContent = `RadonOS virtual disk · ${formatBytes(usage.bytes)}`;
}

/* ----------------------------------------------------------- selection */
function select(node, event = {}) {
  if (event.ctrlKey || event.metaKey) {
    if (state.selection.has(node.id)) state.selection.delete(node.id);
    else state.selection.add(node.id);
  } else if (event.shiftKey && state.selection.size) {
    const ids = state.nodes.map((item) => item.id);
    const anchor = Math.max(0, ids.findIndex((id) => state.selection.has(id)));
    const target = ids.indexOf(node.id);
    state.selection = new Set(ids.slice(Math.min(anchor, target), Math.max(anchor, target) + 1));
  } else {
    state.selection = new Set([node.id]);
  }
  document.querySelectorAll('[data-id]').forEach((row) => {
    row.classList.toggle('selected', state.selection.has(row.dataset.id));
  });
  void renderStatus();
}

function selectedNodes() {
  return state.nodes.filter((node) => state.selection.has(node.id));
}

/* -------------------------------------------------------------- actions */
async function openNode(node) {
  if (node.kind === 'folder') return navigate(node.id);
  const kind = FS.kindForMime(node.mime);
  const path = await FS.pathString(node.id);
  if (kind === 'text') return openApp('notepad', { path });
  if (kind === 'audio' || kind === 'video') return openApp('media', { path });
  if (kind === 'image') return previewImage(node);
  return FS.download(node);
}

async function previewImage(node) {
  const blob = await FS.readBlob(node.id);
  const url = URL.createObjectURL(blob);
  const body = document.createElement('div');
  body.className = 'preview-frame';
  body.innerHTML = `
    <img src="${url}" alt="${escapeHtml(node.name)}">
    <div class="ros-hint">${escapeHtml(node.name)} · ${formatBytes(node.size || 0)}</div>`;
  const action = await showModal({
    title: node.name,
    subtitle: 'Image preview',
    iconName: 'image',
    width: 720,
    body,
    actions: [
      { label: 'Close', value: null, variant: 'ghost' },
      { label: 'Download', value: 'download', variant: 'primary', iconName: 'download' },
    ],
  });
  URL.revokeObjectURL(url);
  if (action === 'download') await FS.download(node);
}

function showNodeMenu(node, x, y) {
  const inTrash = state.currentId === FS.TRASH_ID;
  const many = state.selection.size > 1;
  const items = [];

  if (!inTrash) {
    items.push({ label: many ? `Open ${state.selection.size} items` : 'Open', iconName: 'external', action: () => openNode(node) });
    if (node.kind === 'file' && FS.kindForMime(node.mime) === 'text') {
      items.push({
        label: 'Open in Notepad',
        iconName: 'file-text',
        action: async () => openApp('notepad', { path: await FS.pathString(node.id) }),
      });
    }
    items.push({ separator: true });
    items.push({
      label: 'Rename',
      iconName: 'edit',
      disabled: many,
      action: async () => {
        const name = await promptDialog({ title: 'Rename', label: 'Name', value: node.name, confirmText: 'Rename' });
        if (!name) return;
        try {
          await FS.rename(node.id, name);
          toast('Renamed', { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error', title: 'Could not rename' });
        }
      },
    });
    if (node.kind === 'file') {
      items.push({
        label: 'Duplicate',
        iconName: 'copy',
        disabled: many,
        action: async () => {
          const blob = await FS.readBlob(node.id);
          await FS.writeBlob(node.parentId, new File([blob], node.name, { type: node.mime }));
          toast('Copy created', { type: 'success' });
        },
      });
    }
    items.push({
      label: 'Download',
      iconName: 'download',
      disabled: node.kind === 'folder' || many,
      action: () => FS.download(node),
    });
    items.push({ separator: true });
    items.push({
      label: many ? `Move ${state.selection.size} items to Trash` : 'Move to Trash',
      iconName: 'trash',
      danger: true,
      action: () => trashSelection(node),
    });
  } else {
    items.push({
      label: 'Restore',
      iconName: 'rotate-ccw',
      action: async () => {
        await FS.restore(node.id);
        toast('Restored to its original folder', { type: 'success' });
      },
    });
    items.push({
      label: 'Download',
      iconName: 'download',
      disabled: node.kind === 'folder',
      action: () => FS.download(node),
    });
    items.push({ separator: true });
    items.push({
      label: 'Delete permanently',
      iconName: 'x-circle',
      danger: true,
      action: async () => {
        const ok = await confirmDialog({
          title: 'Delete permanently?',
          message: `"${node.name}" cannot be recovered after this.`,
          confirmText: 'Delete forever',
          danger: true,
        });
        if (!ok) return;
        await FS.deleteForever(node.id);
        toast('Deleted permanently', { type: 'success' });
      },
    });
  }

  items.push({ separator: true });
  items.push({ label: 'Properties', iconName: 'info', action: () => showProperties(node) });
  showContextMenu(items, x, y);
}

async function trashSelection(node) {
  const targets = state.selection.size > 1 ? selectedNodes() : [node];
  for (const target of targets) {
    try {
      await FS.trash(target.id);
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not delete' });
    }
  }
  state.selection.clear();
  toast(`${plural(targets.length, 'item')} moved to Trash`, { type: 'success' });
}

async function showProperties(node) {
  const path = await FS.pathString(node.id);
  const parent = await FS.pathString(node.parentId || FS.ROOT_ID);
  const body = `
    <dl class="prop-table">
      <dt>Name</dt><dd>${escapeHtml(node.name)}</dd>
      <dt>Path</dt><dd>${escapeHtml(path)}</dd>
      <dt>Type</dt><dd>${node.kind === 'folder' ? 'Folder' : escapeHtml(node.mime || 'binary')}</dd>
      <dt>Size</dt><dd>${node.kind === 'folder'
        ? plural(state.counts.get(node.id) || 0, 'item')
        : formatBytes(node.size || 0)}</dd>
      <dt>Created</dt><dd>${formatDate(node.createdAt, { withTime: true })} (${relativeTime(node.createdAt)})</dd>
      <dt>Modified</dt><dd>${formatDate(node.updatedAt, { withTime: true })}</dd>
      <dt>Parent</dt><dd>${escapeHtml(parent)}</dd>
      <dt>ID</dt><dd style="font-family:var(--mono);font-size:11px">${escapeHtml(node.id)}</dd>
    </dl>`;
  const action = await showModal({
    title: 'Properties',
    subtitle: node.name,
    iconName: 'info',
    width: 480,
    body,
    actions: [
      { label: 'Close', value: null, variant: 'ghost' },
      node.kind === 'file' && { label: 'Download', value: 'download', variant: 'primary', iconName: 'download' },
    ].filter(Boolean),
  });
  if (action === 'download') await FS.download(node);
}

/* --------------------------------------------------------------- upload */
async function importFiles(files) {
  if (!files?.length) return;
  const settings = await loadSettings();
  const target = state.currentId === FS.TRASH_ID ? folderId('Downloads') : state.currentId;
  if (state.currentId === FS.TRASH_ID) {
    toast('Uploading to Downloads instead of Trash', { type: 'info' });
  }
  let saved = 0;
  for (const file of files) {
    try {
      await FS.writeBlob(target, file);
      saved += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, { type: 'error' });
    }
  }
  if (saved) {
    toast(`${plural(saved, 'file')} imported`, {
      type: 'success',
      title: `Saved to ${folderNameOf(target) || 'this folder'}`,
      iconName: 'upload',
    });
  }
  void settings;
}

function folderNameOf(id) {
  const node = state.all.find((item) => item.id === id);
  return node?.name || '';
}

/* --------------------------------------------------------------- wiring */
$('#nav-back').addEventListener('click', goBack);
$('#nav-forward').addEventListener('click', goForward);
$('#nav-up').addEventListener('click', goUp);

$('#view-toggle').addEventListener('click', () => {
  state.view = state.view === 'list' ? 'grid' : 'list';
  void render();
});

$('#new-folder').addEventListener('click', async () => {
  const name = await promptDialog({
    title: 'New folder',
    label: 'Folder name',
    value: 'New folder',
    confirmText: 'Create',
    iconName: 'folder-plus',
    validate: (value) => (/[/\\]/.test(value) ? 'Slashes are not allowed' : null),
  });
  if (!name) return;
  try {
    const node = await FS.mkdir(state.currentId, name);
    toast('Folder created', { type: 'success' });
    navigate(node.id);
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Could not create folder' });
  }
});

$('#new-file').addEventListener('click', async () => {
  const name = await promptDialog({
    title: 'New text file',
    label: 'File name',
    value: 'Untitled.txt',
    confirmText: 'Create & edit',
    iconName: 'file-plus',
  });
  if (!name) return;
  try {
    const node = await FS.createFile(state.currentId, name, '');
    const path = await FS.pathString(node.id);
    openApp('notepad', { path });
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Could not create file' });
  }
});

$('#upload').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (event) => {
  await importFiles([...event.target.files]);
  event.target.value = '';
});

$('#empty-trash').addEventListener('click', async () => {
  const stats = await FS.stats();
  if (!stats.trash) {
    toast('Trash is already empty');
    return;
  }
  const ok = await confirmDialog({
    title: 'Empty the trash?',
    message: `${plural(stats.trash, 'item')} will be deleted permanently. This cannot be undone.`,
    confirmText: 'Empty trash',
    danger: true,
  });
  if (!ok) return;
  await FS.emptyTrash();
  toast('Trash emptied', { type: 'success' });
});

$('#search').addEventListener('input', debounce((event) => {
  state.query = event.target.value.trim();
  state.searching = state.query.length > 0;
  state.selection.clear();
  if (state.searching) state.history = state.history; // keep trail untouched
  void render();
}, 220));

$('#search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.target.value = '';
    state.query = '';
    state.searching = false;
    void render();
  }
});

const panel = $('#panel');
const dropZone = $('#drop-zone');
let dragDepth = 0;
panel.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  dragDepth += 1;
  dropZone.hidden = false;
});
panel.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
});
panel.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.hidden = true;
});
panel.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  dragDepth = 0;
  dropZone.hidden = true;
  await importFiles([...event.dataTransfer.files]);
});

document.addEventListener('keydown', async (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (event.key === 'Delete' && !typing && state.selection.size) {
    await trashSelection(selectedNodes()[0]);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !typing) {
    event.preventDefault();
    state.selection = new Set(state.nodes.map((node) => node.id));
    void renderList();
    void renderStatus();
  }
  if (event.key === 'Enter' && !typing && state.selection.size) {
    const node = selectedNodes()[0];
    if (node) await openNode(node);
  }
  if (event.key === 'Backspace' && !typing) {
    event.preventDefault();
    await goUp();
  }
});

FS.onFsChange(debounce(() => { void render(); }, 260));

/* ----------------------------------------------------------------- boot */
(async () => {
  await loadSettings();
  await initTheme();
  await FS.ready();
  paintIcons();

  const params = new URLSearchParams(location.search);
  const path = params.get('path');
  if (path) {
    const node = await FS.resolvePath(path).catch(() => null);
    if (node?.kind === 'folder') {
      state.currentId = node.id;
      state.history = [FS.ROOT_ID, node.id];
      state.index = 1;
    } else if (node) {
      state.currentId = node.parentId || FS.ROOT_ID;
      state.selection = new Set([node.id]);
    }
  }
  await render();
})();
