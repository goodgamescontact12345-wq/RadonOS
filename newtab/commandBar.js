/**
 * FILE: newtab/commandBar.js
 *
 * Spotlight for RadonOS. Super+Space (Windows/Command + Space) or Ctrl/Cmd+K
 * opens one input that searches, in parallel, across:
 *
 *   - open windows      focus or restore
 *   - installed apps    launch (or focus a singleton already open)
 *   - system commands   theme, palette, dock, lock, settings sections, ...
 *   - the virtual disk  open files and folders
 *   - the web           fallback that opens a RadonOS browser window
 *
 * Results are ranked with a small fuzzy matcher (prefix > substring >
 * in-order subsequence), grouped in the UI, and fully keyboard driven:
 * ↑ ↓ move, ↵ runs, Esc closes. The runner always closes the palette before
 * executing so actions that open modals never stack on top of it.
 */
import { getSettings, updateSettings } from '../shared/settings.js';
import { APPS } from '../shared/registry.js';
import { icon } from '../shared/icons.js';
import { escapeHtml } from '../shared/ui.js';
import * as FS from '../shared/fs.js';

const RECENT_KEY = 'radonos:cmdk-recent';
const MAX_RESULTS = 42;
const MAX_FILES = 6;

const GROUPS = ['Windows', 'Applications', 'Commands', 'Files', 'Web'];

/** Order in which equally-scored entries are listed. */
const groupRank = (group) => GROUPS.indexOf(group);

function readRecents() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(key) {
  if (!key) return;
  const next = [key, ...readRecents().filter((item) => item !== key)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage may be full or blocked */ }
}

/**
 * Score `text` against `query` in [0, 1].
 * Exact > prefix > substring > in-order subsequence; 0 means "no match".
 */
export function fuzzyScore(text, query) {
  const haystack = String(text || '').toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 0.3;
  if (!haystack) return 0;
  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.95;
  const sub = haystack.indexOf(needle);
  if (sub !== -1) {
    // Earlier matches and shorter haystacks rank higher.
    return 0.9 - (sub / Math.max(haystack.length, 1)) * 0.18 - Math.min(haystack.length, 60) * 0.001;
  }
  let cursor = 0;
  let streak = 0;
  let points = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return 0;
    points += streak > 0 ? 2 : 1;
    streak = found === cursor ? streak + 1 : 0;
    cursor = found + 1;
  }
  return Math.min(0.8, 0.35 + points / (needle.length * 5));
}

function bestScore(query, fields) {
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    const score = fuzzyScore(field, query);
    if (score > best) best = score;
  }
  return best;
}

export function createCommandBar({ wm, taskbar, desktop, controlCenter }) {
  const backdrop = document.querySelector('#command-bar');
  const input = document.querySelector('#cmdk-input');
  const results = document.querySelector('#cmdk-results');
  const counter = document.querySelector('#cmdk-count');
  if (!backdrop || !input || !results) {
    console.warn('[RadonOS] Command bar markup is missing');
    return { open() {}, close() {}, toggle() {}, isOpen: () => false, search: async () => [] };
  }

  let items = [];
  let index = 0;
  let token = 0;
  let opened = false;

  const isOpen = () => !backdrop.hidden;

  /* ------------------------------------------------------------- commands */
  function paletteTarget() {
    const order = ['midnight', 'lavender', 'sage', 'peach'];
    const current = getSettings().palette || 'midnight';
    return order[(order.indexOf(current) + 1) % order.length];
  }

  async function newNote() {
    const documents = await FS.resolvePath('/Documents');
    const base = 'Untitled note';
    let name = `${base}.md`;
    let counterValue = 2;
    while (await FS.byName(documents.id, name)) {
      name = `${base} ${counterValue}.md`;
      counterValue += 1;
    }
    await FS.writeText({ parentId: documents.id, name, content: '# ' + base + '\n\n' });
    const path = `/Documents/${name}`;
    wm.open('notepad', { args: { path } });
    taskbar?.notify?.({
      title: 'Note created',
      body: `${path} is ready to edit.`,
      iconName: 'file-text',
      silent: true,
      timeout: 2400,
    });
  }

  function commands() {
    const settings = getSettings();
    return [
      {
        key: 'cmd:settings',
        title: 'Open Settings',
        subtitle: 'Wallpaper, palette, dock and storage',
        iconName: 'settings',
        keywords: 'settings preferences configure',
        run: () => wm.open('settings'),
      },
      {
        key: 'cmd:appearance',
        title: 'Change wallpaper and palette',
        subtitle: 'Appearance settings',
        iconName: 'image',
        keywords: 'wallpaper background picture accent palette theme glass blur',
        run: () => wm.open('settings', { args: { section: 'appearance' } }),
      },
      {
        key: 'cmd:dock',
        title: 'Move the dock',
        subtitle: 'Switch between bottom and top placement',
        iconName: 'monitor',
        keywords: 'dock taskbar position move top bottom',
        run: () => updateSettings({ dock: settings.dock === 'top' ? 'bottom' : 'top' }),
      },
      {
        key: 'cmd:palette',
        title: 'Cycle colour palette',
        subtitle: `Next: ${paletteTarget()}`,
        iconName: 'palette',
        keywords: 'palette colour color scheme theme lavender sage peach midnight',
        run: () => updateSettings({ palette: paletteTarget() }),
      },
      {
        key: 'cmd:theme',
        title: 'Toggle light / dark theme',
        subtitle: settings.theme === 'dark' ? 'Switch to light' : 'Switch to dark',
        iconName: settings.theme === 'dark' ? 'sun' : 'moon',
        keywords: 'theme dark light mode night day',
        run: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      {
        key: 'cmd:control',
        title: 'Open Control Center',
        subtitle: 'Brightness, volume, blur and dock',
        iconName: 'sliders',
        keywords: 'control center brightness volume audio display quick settings',
        run: () => controlCenter?.open?.(),
      },
      {
        key: 'cmd:terminal',
        title: 'Open Terminal',
        subtitle: 'Command line access to RadonOS',
        iconName: 'terminal',
        keywords: 'terminal shell console command cli',
        run: () => wm.open('terminal'),
      },
      {
        key: 'cmd:note',
        title: 'New note',
        subtitle: 'Create a markdown note in /Documents',
        iconName: 'plus',
        keywords: 'new note create markdown write document',
        run: () => newNote(),
      },
      {
        key: 'cmd:tile-left',
        title: 'Tile window left',
        subtitle: 'Snap the focused window to the left half',
        iconName: 'grid',
        keywords: 'tile snap layout window left half split',
        run: () => wm.tile(undefined, 'left'),
      },
      {
        key: 'cmd:tile-right',
        title: 'Tile window right',
        subtitle: 'Snap the focused window to the right half',
        iconName: 'grid',
        keywords: 'tile snap layout window right half split',
        run: () => wm.tile(undefined, 'right'),
      },
      {
        key: 'cmd:tile-center',
        title: 'Centre window',
        subtitle: 'Return the focused window to a centred layout',
        iconName: 'maximize',
        keywords: 'tile centre center layout window reset',
        run: () => wm.tile(undefined, 'center'),
      },
      {
        key: 'cmd:desktop',
        title: 'Show desktop',
        subtitle: 'Minimise or restore every window',
        iconName: 'grid',
        keywords: 'show desktop minimise minimize hide windows',
        run: () => wm.toggleShowDesktop(),
      },
      {
        key: 'cmd:trash',
        title: 'Empty trash',
        subtitle: 'Permanently delete trashed files',
        iconName: 'trash',
        keywords: 'trash empty delete recycle bin',
        run: async () => {
          await FS.emptyTrash();
          taskbar?.notify?.({
            title: 'Trash emptied',
            body: 'Deleted files were permanently removed.',
            iconName: 'trash',
            type: 'success',
            silent: true,
          });
        },
      },
      {
        key: 'cmd:lock',
        title: 'Lock screen',
        subtitle: 'Return to the lock screen',
        iconName: 'lock',
        keywords: 'lock away screen session',
        run: () => taskbar?.lockScreen?.(),
      },
      {
        key: 'cmd:about',
        title: 'About RadonOS',
        subtitle: 'Version, build and credits',
        iconName: 'info',
        keywords: 'about version info credits help',
        run: () => taskbar?.showAbout?.(),
      },
      {
        key: 'cmd:restart',
        title: 'Restart RadonOS',
        subtitle: 'Reload the desktop and restore the session',
        iconName: 'power',
        keywords: 'restart reload reboot refresh',
        run: () => window.location.reload(),
      },
    ].map((entry) => ({ group: 'Commands', ...entry }));
  }

  /* --------------------------------------------------------------- search */
  function windowEntries() {
    return (wm?.list?.() || []).map((win) => ({
      group: 'Windows',
      key: `win:${win.id}`,
      title: win.title,
      subtitle: `${win.minimized ? 'Minimised' : win.active ? 'Focused' : 'Running'} · window`,
      iconName: win.icon,
      color: win.color,
      keywords: `window ${win.appId}`,
      run: () => {
        if (win.minimized) wm.restore(win.id);
        wm.focus(win.id);
      },
    }));
  }

  function appEntries() {
    return APPS.map((app) => ({
      group: 'Applications',
      key: `app:${app.id}`,
      title: app.name,
      subtitle: app.description,
      iconName: app.icon,
      color: app.color,
      keywords: app.keywords,
      run: () => wm.open(app.id),
    }));
  }

  async function fileEntries(query) {
    if (query.length < 2) return [];
    let nodes = [];
    try {
      nodes = await FS.search(query);
    } catch {
      return [];
    }
    return Promise.all(nodes.slice(0, MAX_FILES).map(async (node) => {
      const parent = await FS.pathString(node.parentId).catch(() => '/');
      const directory = parent === '/' ? '' : parent;
      const path = `${directory}/${node.name}`;
      return {
        group: 'Files',
        key: `file:${node.id}`,
        title: node.name,
        subtitle: `${parent === '/' ? '/' : parent} · ${node.kind === 'folder' ? 'Folder' : 'File'}`,
        iconName: node.kind === 'folder' ? 'folder' : 'file-text',
        keywords: 'file folder vfs',
        run: () => {
          if (node.kind === 'folder') {
            wm.open('explorer', { args: { path } });
            return;
          }
          const mime = String(node.mime || '');
          if (mime.startsWith('audio/') || mime.startsWith('video/')) wm.open('media', { args: { path } });
          else if (mime.startsWith('image/')) wm.open('explorer', { args: { path } });
          else wm.open('notepad', { args: { path } });
        },
      };
    }));
  }

  function webEntry(query) {
    const trimmed = query.trim();
    if (!trimmed) return null;
    return {
      group: 'Web',
      key: 'web:search',
      title: `Search the web for “${trimmed}”`,
      subtitle: 'Opens a RadonOS browser window',
      iconName: 'globe',
      keywords: 'web internet search duckduckgo',
      run: () => wm.open('browser', { args: { url: `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}` } }),
    };
  }

  function rank(query, entries) {
    const recents = readRecents();
    return entries
      .map((entry) => {
        const score = bestScore(query, [entry.title, entry.subtitle || '', entry.keywords || '']);
        const recent = recents.indexOf(entry.key);
        return {
          ...entry,
          score: score + (recent >= 0 ? 0.12 - recent * 0.01 : 0),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.02) return b.score - a.score;
        return groupRank(a.group) - groupRank(b.group);
      });
  }

  async function search(query) {
    const trimmed = query.trim();
    // Windows are always searchable; with an empty query every title scores
    // the same, so the group order naturally puts live windows first.
    const entries = [
      ...windowEntries(),
      ...appEntries(),
      ...commands(),
    ];
    if (!trimmed) {
      // Keep the launcher calm: no command wall until the user types.
      const ranked = rank(trimmed, entries).slice(0, 14);
      return ranked;
    }
    const files = await fileEntries(trimmed);
    const web = webEntry(trimmed);
    const ranked = rank(trimmed, [...entries, ...files]).slice(0, web ? MAX_RESULTS - 1 : MAX_RESULTS);
    if (web) ranked.push({ ...web, score: 0 });
    return ranked;
  }

  /* --------------------------------------------------------------- render */
  function render() {
    if (!items.length) {
      results.innerHTML = `<div class="cmdk-empty">${icon('search', { size: 18 })}<span>No matches. Keep typing, or press ↵ to search the web.</span></div>`;
      counter.textContent = '0 results';
      return;
    }
    let html = '';
    let previous = '';
    items.forEach((entry, itemIndex) => {
      if (entry.group !== previous) {
        previous = entry.group;
        html += `<div class="cmdk-group">${escapeHtml(entry.group)}</div>`;
      }
      html += `
        <button type="button" class="cmdk-item${itemIndex === index ? ' active' : ''}" data-index="${itemIndex}"
          role="option" aria-selected="${itemIndex === index}">
          <span class="cmdk-icon"${entry.color ? ` style="color:${entry.color}"` : ''}>${icon(entry.iconName || 'file', { size: 16 })}</span>
          <span class="cmdk-text">
            <span class="cmdk-title">${escapeHtml(entry.title)}</span>
            <span class="cmdk-sub">${escapeHtml(entry.subtitle || '')}</span>
          </span>
          <kbd class="cmdk-key">${itemIndex === index ? '↵' : ''}</kbd>
        </button>`;
    });
    results.innerHTML = html;
    counter.textContent = `${items.length} result${items.length === 1 ? '' : 's'}`;
    results.querySelectorAll('.cmdk-item').forEach((button) => {
      const itemIndex = Number(button.dataset.index);
      button.addEventListener('pointerenter', () => {
        index = itemIndex;
        markActive();
      });
      button.addEventListener('click', () => run(itemIndex));
    });
    results.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function markActive() {
    results.querySelectorAll('.cmdk-item').forEach((button) => {
      const active = Number(button.dataset.index) === index;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      const key = button.querySelector('.cmdk-key');
      if (key) key.textContent = active ? '↵' : '';
    });
    results.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  async function refresh() {
    const local = ++token;
    const found = await search(input.value);
    if (local !== token) return;
    items = found;
    index = 0;
    render();
  }

  function run(itemIndex = index) {
    const entry = items[itemIndex];
    if (!entry) return;
    close();
    pushRecent(entry.key);
    try {
      const outcome = entry.run();
      if (outcome?.catch) {
        outcome.catch((err) => taskbar?.notify?.({
          title: 'Command failed',
          body: err.message,
          type: 'error',
          iconName: 'alert',
        }));
      }
    } catch (err) {
      taskbar?.notify?.({ title: 'Command failed', body: err.message, type: 'error', iconName: 'alert' });
    }
  }

  /* ----------------------------------------------------------------- open */
  function open(seed = '') {
    if (opened) {
      input.focus();
      return;
    }
    opened = true;
    taskbar?.closeStartMenu?.();
    taskbar?.closePopover?.();
    controlCenter?.close?.();
    backdrop.hidden = false;
    backdrop.classList.remove('closing');
    input.value = seed;
    index = 0;
    input.focus();
    input.select();
    void refresh();
  }

  function close() {
    if (!isOpen()) return;
    backdrop.hidden = true;
    opened = false;
    items = [];
    token += 1;
    input.value = '';
  }

  function toggle(seed = '') {
    if (isOpen()) close();
    else open(seed);
  }

  /* -------------------------------------------------------------- events */
  input.addEventListener('input', () => {
    index = 0;
    void refresh();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      markActive();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (!items.length) return;
      index = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      markActive();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (items.length) {
        run(index);
        return;
      }
      const query = input.value.trim();
      if (!query) return;
      close();
      wm.open('browser', { args: { url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` } });
    }
  });

  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });

  document.addEventListener('keydown', (event) => {
    const locked = !document.querySelector('#lock-screen')?.hidden;
    if (locked) return;
    const withModifier = event.metaKey || event.ctrlKey;
    // Super+Space is the documented shortcut; Ctrl/Cmd+K is the portable one
    // (Windows reserves Win+Space for the input-language switcher).
    const spotlight = (event.metaKey && event.code === 'Space' && !event.ctrlKey && !event.altKey)
      || (withModifier && event.code === 'KeyK' && !event.shiftKey && !event.altKey);
    if (!spotlight) return;
    // Never steal the shortcut from a text field in an app iframe.
    if (isOpen() || !event.target.closest?.('input, textarea, [contenteditable="true"]')) {
      event.preventDefault();
      toggle();
    }
  });

  // `>` typed on the desktop opens the palette, like a shell prompt.
  document.addEventListener('keydown', (event) => {
    if (isOpen() || event.key !== '>' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target.closest?.('input, textarea, [contenteditable="true"], #command-bar')) return;
    event.preventDefault();
    open();
  });

  return {
    open,
    close,
    toggle,
    isOpen,
    /** Exposed for tests and for future integrations (e.g. a terminal command). */
    search,
    runAt: (itemIndex) => run(itemIndex),
    get results() {
      return items.map(({ title, group, key }) => ({ title, group, key }));
    },
    get selection() {
      return items[index] ? { title: items[index].title, group: items[index].group } : null;
    },
    get recent() {
      return readRecents();
    },
  };
}
