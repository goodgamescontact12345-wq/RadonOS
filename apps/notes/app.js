import { loadSettings, getSettings, updateSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { paintIcons, toast, escapeHtml, relativeTime } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);
let activeId = null;
let saveTimer = 0;

const notes = () => (Array.isArray(getSettings().notes) ? getSettings().notes : []);

function persist(next) {
  return updateSettings({ notes: next });
}

function paintList() {
  const list = $('#note-list');
  const items = [...notes()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!items.length) {
    list.innerHTML = '<div class="empty-hint">No notes yet. Create one with New note.</div>';
    return;
  }
  list.innerHTML = items.map((note) => `
    <button type="button" class="note-item${note.id === activeId ? ' active' : ''}" data-id="${note.id}">
      <strong>${escapeHtml(note.title || 'Untitled note')}</strong>
      <small>${escapeHtml(relativeTime(note.updatedAt || Date.now()))} · ${escapeHtml((note.body || '').slice(0, 40) || 'Empty')}</small>
    </button>`).join('');
  $('#note-status').textContent = `${items.length} note${items.length === 1 ? '' : 's'}`;
}

function paintEditor() {
  const note = notes().find((item) => item.id === activeId);
  const title = $('#note-title');
  const body = $('#note-body');
  if (!note) {
    title.value = '';
    body.value = '';
    title.disabled = true;
    body.disabled = true;
    $('#note-saved').textContent = '';
    return;
  }
  title.disabled = false;
  body.disabled = false;
  title.value = note.title || '';
  body.value = note.body || '';
  $('#note-saved').textContent = `Saved ${relativeTime(note.updatedAt || Date.now())}`;
}

function commit() {
  const note = notes().find((item) => item.id === activeId);
  if (!note) return;
  const next = notes().map((item) => (item.id === note.id
    ? { ...item, title: $('#note-title').value, body: $('#note-body').value, updatedAt: Date.now() }
    : item));
  persist(next).then(() => {
    $('#note-saved').textContent = 'Saved just now';
    paintList();
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  $('#note-saved').textContent = 'Saving…';
  saveTimer = setTimeout(commit, 450);
}

async function createNote() {
  const note = { id: crypto.randomUUID(), title: 'Untitled note', body: '', updatedAt: Date.now() };
  await persist([note, ...notes()]);
  activeId = note.id;
  paintList();
  paintEditor();
  $('#note-title').focus();
  $('#note-title').select();
}

$('#note-new').addEventListener('click', createNote);
$('#note-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  commit();
  activeId = button.dataset.id;
  paintList();
  paintEditor();
});

$('#note-title').addEventListener('input', scheduleSave);
$('#note-body').addEventListener('input', scheduleSave);

$('#note-delete').addEventListener('click', async () => {
  if (!activeId) return;
  await persist(notes().filter((note) => note.id !== activeId));
  activeId = notes()[0]?.id || null;
  paintList();
  paintEditor();
  toast('Note deleted', { iconName: 'trash' });
});

$('#note-desktop').addEventListener('click', async () => {
  const note = notes().find((item) => item.id === activeId);
  if (!note) {
    toast('Pick a note first', { type: 'error' });
    return;
  }
  const desktopNotes = Array.isArray(getSettings().desktopNotes) ? getSettings().desktopNotes : [];
  if (desktopNotes.some((item) => item.sourceId === note.id)) {
    toast('That note is already on the desktop', { iconName: 'pin' });
    return;
  }
  await updateSettings({
    desktopNotes: [...desktopNotes, {
      id: crypto.randomUUID(),
      sourceId: note.id,
      text: [note.title, note.body].filter(Boolean).join('\n\n'),
      x: 260 + desktopNotes.length * 26,
      y: 120 + desktopNotes.length * 22,
      color: 'amber',
    }],
  });
  toast('Pinned to the desktop', { type: 'success', iconName: 'pin' });
});

await loadSettings();
await initTheme();
paintIcons();
activeId = notes()[0]?.id || null;
paintList();
paintEditor();
