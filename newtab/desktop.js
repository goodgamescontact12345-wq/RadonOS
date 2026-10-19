import { APPS, getApp } from '../shared/registry.js';
import { icon } from '../shared/icons.js';
import { getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { showContextMenu, promptDialog, toast, escapeHtml, confirmDialog } from '../shared/ui.js';
import { playClick } from '../shared/audio.js';
import * as FS from '../shared/fs.js';

const CELL_W = 96;
const CELL_H = 114;
const PAD = 6;

const appKey = (id) => `app:${id}`;
const shortcutKey = (id) => `shortcut:${id}`;

export function createDesktop({ wm }) {
  const surface = document.getElementById('icon-surface');
  const desktop = document.getElementById('desktop');
  const marquee = document.getElementById('marquee');
  const iconNodes = new Map();
  const selected = new Set();
  let entries = [];
  let lastFingerprint = '';
  let layoutFrame = 0;

  /* ------------------------------------------------------------ ordering */
  function settingsOrder() {
    const settings = getSettings();
    const raw = Array.isArray(settings.iconOrder) ? settings.iconOrder : [];
    const seen = new Set();
    const order = [];

    for (const key of raw) {
      const normalized = key.includes(':') ? key : appKey(key);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        order.push(normalized);
      }
    }
    for (const app of APPS) {
      const key = appKey(app.id);
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
    for (const shortcut of settings.shortcuts || []) {
      const key = shortcutKey(shortcut.id);
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
    return order.filter((key) => {
      if (key.startsWith('app:')) return !!getApp(key.slice(4));
      return (getSettings().shortcuts || []).some((sc) => key === shortcutKey(sc.id));
    });
  }

  function buildEntries() {
    const settings = getSettings();
    const shortcuts = new Map((settings.shortcuts || []).map((sc) => [shortcutKey(sc.id), sc]));
    return settingsOrder().map((key) => {
      if (key.startsWith('shortcut:')) {
        const shortcut = shortcuts.get(key);
        return {
          key,
          kind: 'shortcut',
          name: shortcut.name,
          icon: shortcut.icon || 'link',
          color: '#64748b',
          url: shortcut.url,
          shortcut,
        };
      }
      const app = getApp(key.slice(4));
      return { key, kind: 'app', appId: app.id, name: app.name, icon: app.icon, color: app.color, app };
    });
  }

  function persistOrder() {
    return updateSettings({ iconOrder: entries.map((entry) => entry.key) });
  }

  /* -------------------------------------------------------------- render */
  function render() {
    const settings = getSettings();
    entries = buildEntries();
    iconNodes.clear();
    surface.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'desktop-icon';
      node.dataset.key = entry.key;
      node.setAttribute('role', 'listitem');
      node.title = entry.kind === 'app'
        ? `${entry.name} — double-click to open`
        : `${entry.name}\n${entry.url}`;
      node.innerHTML = `
        <span class="icon-tile${entry.kind === 'shortcut' ? ' shortcut' : ''}">${icon(entry.icon, { size: 24 })}</span>
        <span class="desktop-icon-label">${escapeHtml(entry.name)}</span>`;
      node.style.setProperty('--tile-color', entry.color);
      if (selected.has(entry.key)) node.classList.add('selected');

      node.addEventListener('pointerdown', (event) => onIconPointerDown(entry, node, event));
      node.addEventListener('dblclick', (event) => {
        event.preventDefault();
        openEntry(entry);
      });
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openEntry(entry);
        }
        if (event.key === 'Delete') removeShortcut(entry);
      });
      node.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectOnly(entry.key);
        showIconMenu(entry, event.clientX, event.clientY);
      });

      fragment.appendChild(node);
      iconNodes.set(entry.key, node);
    }

    surface.appendChild(fragment);
    lastFingerprint = fingerprint();
    layout();
    applyLabelVisibility(settings);
  }

  function fingerprint() {
    const settings = getSettings();
    return JSON.stringify([
      settings.iconOrder,
      settings.shortcuts,
      settings.iconSize,
      settings.iconLabels,
    ]);
  }

  function applyLabelVisibility(settings) {
    document.documentElement.dataset.labels = settings.iconLabels === false ? 'hidden' : 'shown';
  }

  function layout() {
    const rect = surface.getBoundingClientRect();
    const rows = Math.max(1, Math.floor((rect.height - PAD * 2) / CELL_H));
    entries.forEach((entry, index) => {
      const node = iconNodes.get(entry.key);
      if (!node) return;
      const column = Math.floor(index / rows);
      const row = index % rows;
      node.style.left = `${PAD + column * CELL_W}px`;
      node.style.top = `${PAD + row * CELL_H}px`;
    });
    surface.dataset.rows = String(rows);
  }

  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layout);
  }

  /* ------------------------------------------------------------ selection */
  function selectOnly(key) {
    selected.clear();
    if (key) selected.add(key);
    for (const [nodeKey, node] of iconNodes) node.classList.toggle('selected', selected.has(nodeKey));
  }

  function clearSelection() {
    selected.clear();
    for (const node of iconNodes.values()) node.classList.remove('selected');
  }

  function toggleSelection(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    iconNodes.get(key)?.classList.toggle('selected', selected.has(key));
  }

  /* ---------------------------------------------------------------- open */
  function openEntry(entry) {
    playClick();
    if (entry.kind === 'shortcut') {
      wm.open('browser', { args: { url: entry.url } });
      return;
    }
    wm.open(entry.appId);
  }

  function openApp(appId, args = {}) {
    return wm.open(appId, { args });
  }

  /* ------------------------------------------------------ icon interactions */
  function onIconPointerDown(entry, node, event) {
    if (event.button !== 0) return;
    const multi = event.ctrlKey || event.metaKey;
    if (multi) toggleSelection(entry.key);
    else if (!selected.has(entry.key)) selectOnly(entry.key);

    const start = { x: event.clientX, y: event.clientY };
    const surfaceRect = surface.getBoundingClientRect();
    const grabX = event.clientX - node.getBoundingClientRect().left;
    const grabY = event.clientY - node.getBoundingClientRect().top;
    let dragging = false;

    const onMove = (moveEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 4) return;
      if (!dragging) {
        dragging = true;
        node.classList.add('dragging');
        clearSelection();
        selectOnly(entry.key);
      }
      node.style.left = `${moveEvent.clientX - surfaceRect.left - grabX}px`;
      node.style.top = `${moveEvent.clientY - surfaceRect.top - grabY}px`;
    };

    const onUp = async (upEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!dragging) return;
      node.classList.remove('dragging');

      const rect = surface.getBoundingClientRect();
      const rows = Math.max(1, Number(surface.dataset.rows) || 1);
      const centerX = upEvent.clientX - rect.left;
      const centerY = upEvent.clientY - rect.top;
      const column = Math.max(0, Math.floor((centerX - PAD) / CELL_W));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((centerY - PAD) / CELL_H)));
      const target = Math.min(entries.length - 1, column * rows + row);
      const from = entries.findIndex((item) => item.key === entry.key);
      if (from !== -1 && target !== from) {
        const next = [...entries];
        const [moved] = next.splice(from, 1);
        next.splice(target, 0, moved);
        entries = next;
        await persistOrder();
        render();
      } else {
        layout();
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function showIconMenu(entry, x, y) {
    const items = [
      { label: 'Open', iconName: 'external', action: () => openEntry(entry) },
      {
        label: entry.kind === 'shortcut' ? 'Open in new tab' : 'Open in new window',
        iconName: 'copy',
        action: () => {
          if (entry.kind === 'shortcut') window.open(entry.url, '_blank', 'noopener');
          else wm.open(entry.appId, { singleton: false });
        },
      },
      { separator: true },
    ];

    if (entry.kind === 'shortcut') {
      items.push({
        label: 'Rename shortcut',
        iconName: 'edit',
        action: async () => {
          const name = await promptDialog({ title: 'Rename shortcut', label: 'Name', value: entry.name });
          if (!name) return;
          const shortcuts = getSettings().shortcuts.map((sc) => (
            sc.id === entry.shortcut.id ? { ...sc, name } : sc
          ));
          await updateSettings({ shortcuts });
          render();
        },
      });
      items.push({
        label: 'Remove shortcut',
        iconName: 'trash',
        danger: true,
        action: () => removeShortcut(entry),
      });
    } else {
      items.push({
        label: 'App settings',
        iconName: 'settings',
        action: () => wm.open('settings', { args: { section: 'about' } }),
      });
    }

    items.push({ separator: true });
    items.push({
      label: 'Refresh desktop',
      iconName: 'refresh',
      action: refresh,
    });

    showContextMenu(items, x, y);
  }

  async function removeShortcut(entry) {
    if (entry.kind !== 'shortcut') return;
    const ok = await confirmDialog({
      title: 'Remove shortcut?',
      message: `"${entry.name}" will be removed from the desktop. The website itself is untouched.`,
      confirmText: 'Remove',
      danger: true,
      iconName: 'trash',
    });
    if (!ok) return;
    const shortcuts = getSettings().shortcuts.filter((sc) => sc.id !== entry.shortcut.id);
    await updateSettings({ shortcuts });
    selected.delete(entry.key);
    render();
    toast('Shortcut removed', { type: 'success' });
  }

  async function addShortcut() {
    const name = await promptDialog({
      title: 'New desktop shortcut',
      label: 'Name',
      placeholder: 'My favourite site',
      confirmText: 'Next',
      iconName: 'link',
      validate: (value) => (value.length > 40 ? 'Keep it under 40 characters' : null),
    });
    if (!name) return;

    const url = await promptDialog({
      title: 'Shortcut address',
      label: 'URL',
      value: 'https://',
      placeholder: 'https://example.com',
      confirmText: 'Create shortcut',
      iconName: 'globe',
      validate: (value) => (/^https?:\/\/\S+\.\S+/i.test(value) ? null : 'Enter a full http(s) URL'),
    });
    if (!url) return;

    const shortcuts = [...(getSettings().shortcuts || []), {
      id: crypto.randomUUID(),
      name,
      url,
      icon: 'link',
    }];
    await updateSettings({ shortcuts });
    render();
    toast('Shortcut created on the desktop', { type: 'success', title: name });
  }

  async function sortIcons() {
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    await persistOrder();
    render();
    toast('Icons sorted alphabetically', { type: 'success' });
  }

  function refresh() {
    render();
    toast('Desktop refreshed', { iconName: 'refresh' });
  }

  /* --------------------------------------------------------- desktop menu */
  function showDesktopMenu(x, y) {
    showContextMenu([
      { label: 'Refresh', iconName: 'refresh', action: refresh },
      { label: 'New shortcut', iconName: 'plus', action: addShortcut },
      { label: 'New note', iconName: 'file-plus', action: () => wm.open('notepad') },
      { separator: true },
      {
        label: 'Change background',
        iconName: 'image',
        action: () => wm.open('settings', { args: { section: 'appearance' } }),
      },
      {
        label: 'Display settings',
        iconName: 'monitor',
        action: () => wm.open('settings', { args: { section: 'desktop' } }),
      },
      { label: 'Sort icons', iconName: 'list', action: sortIcons },
      { separator: true },
      { label: 'Open Terminal', iconName: 'terminal', action: () => wm.open('terminal') },
      {
        label: 'About RadonOS',
        iconName: 'info',
        action: () => window.RadonOS?.showAbout?.(),
      },
    ], x, y);
  }

  /* ------------------------------------------------------------ marquee */
  function initMarquee() {
    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target !== surface) return;
      clearSelection();
      const rect = surface.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;

      const onMove = (moveEvent) => {
        const left = Math.min(startX, moveEvent.clientX) - rect.left;
        const top = Math.min(startY, moveEvent.clientY) - rect.top;
        const width = Math.abs(moveEvent.clientX - startX);
        const height = Math.abs(moveEvent.clientY - startY);
        if (width < 3 && height < 3) return;
        Object.assign(marquee.style, {
          left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        });
        marquee.hidden = false;

        const box = { left: rect.left + left, top: rect.top + top, right: rect.left + left + width, bottom: rect.top + top + height };
        for (const [key, node] of iconNodes) {
          const iconRect = node.getBoundingClientRect();
          const hit = iconRect.left < box.right && iconRect.right > box.left
            && iconRect.top < box.bottom && iconRect.bottom > box.top;
          if (hit) selected.add(key);
          else selected.delete(key);
          node.classList.toggle('selected', hit);
        }
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        marquee.hidden = true;
        marquee.style.width = '0px';
        marquee.style.height = '0px';
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  /* ----------------------------------------------------------- file drop */
  function initFileDrop() {
    let dragDepth = 0;
    desktop.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      dragDepth += 1;
      document.body.classList.add('file-drag');
    });
    desktop.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    desktop.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove('file-drag');
    });
    desktop.addEventListener('drop', async (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('file-drag');
      const downloads = await FS.resolvePath('/Downloads');
      if (!downloads) {
        toast('Downloads folder is missing', { type: 'error' });
        return;
      }
      for (const file of files) {
        await FS.writeBlob(downloads.id, file);
      }
      toast(`${files.length} file${files.length > 1 ? 's' : ''} saved to Downloads`, {
        type: 'success',
        title: 'Import complete',
      });
    });
  }

  /* --------------------------------------------------------------- wiring */
  surface.addEventListener('contextmenu', (event) => {
    if (event.target !== surface) return;
    event.preventDefault();
    clearSelection();
    showDesktopMenu(event.clientX, event.clientY);
  });

  desktop.addEventListener('contextmenu', (event) => {
    if (event.target !== desktop) return;
    event.preventDefault();
    showDesktopMenu(event.clientX, event.clientY);
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!event.target.closest('.desktop-icon, .ros-menu, .window, .widget, .taskbar, .start-menu, .popover')) {
      clearSelection();
    }
  });

  window.addEventListener('resize', scheduleLayout);
  initMarquee();
  initFileDrop();

  const unsubscribePromise = onSettingsChange(() => {
    if (fingerprint() !== lastFingerprint) render();
    else layout();
  });

  render();

  return {
    render,
    sortIcons,
    addShortcut,
    openApp,
    openEntry,
    clearSelection,
    get entries() { return entries; },
    destroy() {
      window.removeEventListener('resize', scheduleLayout);
      unsubscribePromise.then((off) => off?.());
    },
  };
}

/** Full-screen hint while files are dragged over the desktop. */
const style = document.createElement('style');
style.textContent = `
  body.file-drag .wallpaper-shade { box-shadow: inset 0 0 0 2px var(--accent); }
  body.file-drag .wallpaper-shade::after {
    content: "Drop files to save them in Downloads";
    position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%);
    padding: 14px 22px; border-radius: 12px;
    background: color-mix(in srgb, var(--surface-solid) 92%, transparent);
    border: 1px dashed var(--accent); color: var(--text);
    font-size: 13px; box-shadow: var(--shadow-md); backdrop-filter: blur(12px);
    pointer-events: none;
  }
`;
document.head.appendChild(style);
