import { APPS, getApp } from '../shared/registry.js';
import { icon } from '../shared/icons.js';
import { getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { showContextMenu } from '../shared/ui.js';
import { playClick } from '../shared/audio.js';

/**
 * The dock is the Linux half of the shell: pinned apps plus whatever is
 * running, down the left edge. Everything else (windows, menus, session) is
 * unchanged, so this stays a view over the window manager rather than a second
 * source of truth.
 */
const DEFAULT_PINNED = [
  'explorer', 'browser', 'terminal', 'notepad', 'media',
  'calculator', 'calendar', 'notes', 'clock', 'monitor', 'help', 'settings',
];

export function createDock({ wm }) {
  const el = document.getElementById('dock');
  if (!el) return { render() {}, destroy() {} };
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Dock');

  function pinned() {
    const stored = getSettings().dockPinned;
    const list = Array.isArray(stored) ? stored : DEFAULT_PINNED;
    return list.filter((id) => getApp(id));
  }

  function windowsOf(appId) {
    return wm.list().filter((win) => win.appId === appId);
  }

  function openApp(appId) {
    const windows = windowsOf(appId);
    playClick();
    if (!windows.length) {
      wm.open(appId);
      return;
    }
    const active = windows.find((win) => win.active && !win.minimized);
    if (active) wm.minimize(active.id);
    else {
      const target = windows.find((win) => !win.minimized) || windows[0];
      if (target.minimized) wm.restore(target.id);
      else wm.focus(target.id);
    }
  }

  function makeItem({ appId, title, iconName, color, running, active, minimized, onClick, menu }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `dock-item${running ? ' running' : ''}${active ? ' active' : ''}${minimized ? ' minimized' : ''}`;
    button.title = title;
    button.dataset.appId = appId;
    button.style.setProperty('--tile-color', color);
    button.innerHTML = `<span class="dock-glyph">${icon(iconName, { size: 22 })}</span><span class="dock-dot"></span>`;
    button.addEventListener('click', onClick);
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      menu(event.clientX, event.clientY);
    });
    return button;
  }

  function menuFor(appId) {
    const app = getApp(appId);
    const windows = windowsOf(appId);
    const isPinned = pinned().includes(appId);
    return (x, y) => showContextMenu([
      { label: windows.length ? 'New window' : `Open ${app.name}`, iconName: 'external', action: () => wm.open(appId, { singleton: false }) },
      {
        label: isPinned ? 'Unpin from dock' : 'Pin to dock',
        iconName: 'pin',
        action: async () => {
          const next = isPinned ? pinned().filter((id) => id !== appId) : [...pinned(), appId];
          await updateSettings({ dockPinned: next });
          render();
        },
      },
      ...(windows.length ? [
        { separator: true },
        ...windows.map((win) => ({
          label: win.title,
          iconName: win.app.icon,
          action: () => (win.minimized ? wm.restore(win.id) : wm.focus(win.id)),
        })),
        {
          label: `Close all ${windows.length > 1 ? `${windows.length} windows` : 'window'}`,
          iconName: 'close',
          danger: true,
          action: () => windows.forEach((win) => wm.close(win.id)),
        },
      ] : []),
    ], x, y);
  }

  function render() {
    const pinnedIds = pinned();
    const runningApps = new Set(wm.list().map((win) => win.appId));
    el.innerHTML = '';

    for (const appId of pinnedIds) {
      const app = getApp(appId);
      const windows = windowsOf(appId);
      const active = windows.find((win) => win.active && !win.minimized);
      el.appendChild(makeItem({
        appId,
        title: `${app.name}${windows.length ? ` · ${windows.length} open` : ''}`,
        iconName: app.icon,
        color: app.color,
        running: windows.length > 0,
        active: !!active,
        minimized: windows.length > 0 && windows.every((win) => win.minimized),
        onClick: () => openApp(appId),
        menu: menuFor(appId),
      }));
    }

    // Apps with windows but no pin still belong in the dock while they run.
    const extras = APPS.filter((app) => runningApps.has(app.id) && !pinnedIds.includes(app.id));
    if (extras.length) el.appendChild(Object.assign(document.createElement('span'), { className: 'dock-sep' }));
    for (const app of extras) {
      const windows = windowsOf(app.id);
      const active = windows.find((win) => win.active && !win.minimized);
      el.appendChild(makeItem({
        appId: app.id,
        title: app.name,
        iconName: app.icon,
        color: app.color,
        running: true,
        active: !!active,
        minimized: windows.every((win) => win.minimized),
        onClick: () => openApp(app.id),
        menu: menuFor(app.id),
      }));
    }
  }

  wm.subscribe(render);
  const offSettings = onSettingsChange((settings, previous) => {
    if (!previous || JSON.stringify(settings.dockPinned) !== JSON.stringify(previous.dockPinned)) render();
  });
  render();

  return {
    render,
    destroy() {
      offSettings.then((off) => off?.());
    },
  };
}
