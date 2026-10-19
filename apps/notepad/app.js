import { icon } from '../../shared/icons.js';
import * as FS from '../../shared/fs.js';
import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { showModal, promptDialog, toast, paintIcons, escapeHtml, formatBytes, formatDate, openApp } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const editor = $('#editor');
const filename = $('#filename');
const state = { nodeId: null, parentId: null, path: null, dirty: false };

/* ---------------------------------------------------------------- status */
function updateStats() {
  const text = editor.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $('#stat-stats').textContent = `${text.length} chars · ${words} words · ${text.split('\n').length} lines`;
  $('#stat-path').textContent = state.path || 'Not saved yet';
  const badge = $('#stat-state');
  badge.textContent = state.dirty ? 'Unsaved changes' : (state.nodeId ? 'Saved' : 'Draft');
  badge.className = state.dirty ? 'dirty' : 'saved';
  document.title = `${state.dirty ? '• ' : ''}${filename.value || 'Untitled'} — Notepad`;
}

function markDirty() {
  if (state.dirty) return;
  state.dirty = true;
  updateStats();
}

/* ------------------------------------------------------------ file open */
async function openFromNode(node) {
  const text = await FS.readText(node.id);
  editor.value = text ?? '';
  state.nodeId = node.id;
  state.parentId = node.parentId;
  state.path = await FS.pathString(node.id);
  filename.value = node.name;
  state.dirty = false;
  updateStats();
}

async function openFromPath(path) {
  const node = await FS.resolvePath(path);
  if (!node || node.kind !== 'file') {
    toast(`Could not find ${path}`, { type: 'error', title: 'Open failed' });
    return false;
  }
  await openFromNode(node);
  return true;
}

async function openDialog() {
  const nodes = (await FS.allNodes())
    .filter((node) => node.kind === 'file' && FS.kindForMime(node.mime) === 'text')
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="search-shell" style="width:100%">
      <span data-icon="search" data-size="15"></span>
      <input id="pick-search" placeholder="Filter files" autocomplete="off">
    </div>
    <div class="file-pick-list" id="pick-list"></div>`;

  const list = body.querySelector('#pick-list');
  const paint = async (query = '') => {
    const needle = query.trim().toLowerCase();
    const filtered = nodes.filter((node) => node.name.toLowerCase().includes(needle));
    if (!filtered.length) {
      list.innerHTML = `<div class="ros-empty">${icon('file-text', { size: 24 })}<span>No text files found</span></div>`;
      return;
    }
    const rows = await Promise.all(filtered.slice(0, 60).map(async (node) => ({
      node,
      path: await FS.pathString(node.id),
    })));
    list.innerHTML = rows.map(({ node, path }) => `
      <button class="file-pick" data-id="${node.id}">
        <span class="file-icon">${icon('file-text', { size: 15 })}</span>
        <span class="file-pick-text">
          <span class="file-pick-name">${escapeHtml(node.name)}</span>
          <span class="file-pick-path">${escapeHtml(path)} · ${formatBytes(node.size || 0)} · ${formatDate(node.updatedAt)}</span>
        </span>
      </button>`).join('');
    list.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const node = nodes.find((item) => item.id === button.dataset.id);
        await openFromNode(node);
        document.querySelector('.ros-modal-backdrop')?.remove();
        toast(`Opened ${node.name}`, { type: 'success' });
      });
    });
  };
  await paint();

  paintIcons(body);
  const modal = showModal({
    title: 'Open from RadonOS',
    subtitle: `${nodes.length} text file${nodes.length === 1 ? '' : 's'} in the virtual file system`,
    iconName: 'folder',
    width: 540,
    body,
    actions: [{ label: 'Cancel', value: null, variant: 'ghost' }],
  });
  body.querySelector('#pick-search').addEventListener('input', (event) => paint(event.target.value));
  setTimeout(() => body.querySelector('#pick-search')?.focus(), 60);
  return modal;
}

/* ------------------------------------------------------------ file save */
async function saveAs() {
  const suggested = filename.value.trim() || 'Untitled.txt';
  const name = await promptDialog({
    title: 'Save as',
    label: 'File name',
    value: suggested,
    confirmText: 'Save to Documents',
    iconName: 'save',
    hint: 'Saved inside the RadonOS virtual file system',
  });
  if (!name) return false;

  const settings = await loadSettings();
  const documents = await FS.resolvePath('/Documents');
  const target = documents || await FS.get(FS.ROOT_ID);
  const existing = await FS.byName(target.id, name);
  const node = await FS.writeText({
    id: existing?.id,
    parentId: target.id,
    name,
    content: editor.value,
  });
  state.nodeId = node.id;
  state.parentId = node.parentId;
  state.path = await FS.pathString(node.id);
  filename.value = node.name;
  state.dirty = false;
  updateStats();
  toast(`Saved to ${state.path}`, { type: 'success', title: node.name });
  void settings;
  return true;
}

async function save() {
  if (!state.nodeId) return saveAs();
  const name = filename.value.trim() || 'Untitled.txt';
  try {
    const node = await FS.writeText({ id: state.nodeId, name, content: editor.value });
    state.path = await FS.pathString(node.id);
    state.dirty = false;
    updateStats();
    toast(`Saved ${node.name}`, { type: 'success', iconName: 'save', timeout: 1800 });
    return true;
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Save failed' });
    return false;
  }
}

async function download() {
  const name = filename.value.trim() || 'Untitled.txt';
  const blob = new Blob([editor.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${name}`, { type: 'success', iconName: 'download' });
}

function newDocument() {
  editor.value = '';
  state.nodeId = null;
  state.parentId = null;
  state.path = null;
  state.dirty = false;
  filename.value = '';
  updateStats();
  editor.focus();
}

/* ---------------------------------------------------------------- wiring */
editor.addEventListener('input', markDirty);
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = editor;
    editor.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    editor.selectionStart = editor.selectionEnd = selectionStart + 2;
    markDirty();
  }
});

document.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    void save();
  } else if (key === 'o') {
    event.preventDefault();
    void openDialog();
  } else if (key === 'n') {
    event.preventDefault();
    newDocument();
  }
});

$('#new').addEventListener('click', newDocument);
$('#open').addEventListener('click', () => void openDialog());
$('#save').addEventListener('click', () => void save());
$('#save-as').addEventListener('click', () => void saveAs());
$('#download').addEventListener('click', () => void download());
$('#reveal').addEventListener('click', () => {
  if (!state.path) {
    toast('Save the file first', { type: 'info' });
    return;
  }
  const folder = state.path.slice(0, state.path.lastIndexOf('/')) || '/';
  openApp('explorer', { path: folder });
});

$('#wrap').addEventListener('click', (event) => {
  const wrapped = editor.classList.toggle('wrap');
  event.currentTarget.classList.toggle('active', wrapped);
});

$('#font').addEventListener('click', (event) => {
  const serif = editor.classList.toggle('serif');
  event.currentTarget.classList.toggle('active', serif);
});

filename.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void save();
  }
});

/* ----------------------------------------------------------------- boot */
(async () => {
  await loadSettings();
  await initTheme();
  await FS.ready();
  paintIcons();

  const path = new URLSearchParams(location.search).get('path');
  if (path && await openFromPath(path)) {
    toast(`Opened ${path}`, { iconName: 'file-text', timeout: 1800 });
  } else {
    editor.value = '';
    updateStats();
  }
})();
