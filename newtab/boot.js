import { getSettings, loadSettings, updateSettings, resetSettings } from '../shared/settings.js';
import { initTheme } from '../shared/theme.js';
import { WindowManager } from './windowManager.js';
import { createDesktop } from './desktop.js';
import { createTaskbar } from './taskbar.js';
import { createWidgets } from './widgets.js';
import { createCommandBar } from './commandBar.js';
import { createControlCenter } from './controlCenter.js';
import { icon } from '../shared/icons.js';
import * as FS from '../shared/fs.js';

const $ = (selector) => document.querySelector(selector);


async function boot() {
  const settings = await loadSettings();
  await initTheme();

  const wm = new WindowManager({
    layer: $('#window-layer'),
    snapPreview: $('#snap-preview'),
  });

  const taskbar = createTaskbar({ wm });
  const desktop = createDesktop({ wm });
  const widgets = createWidgets({ wm });

  // Quick settings and the Super+Space palette are peers of the taskbar:
  // they read the same settings store and open the same window manager.
  const controlCenter = createControlCenter({ wm });
  const commandBar = createCommandBar({ wm, taskbar, desktop, controlCenter });

  window.RadonOS = {
    version: '1.0.0',
    wm,
    windows: wm,
    desktop,
    taskbar,
    widgets,
    controlCenter,
    commandBar,
    fs: FS,
    settings: getSettings(),
    openApp: (appId, args = {}) => wm.open(appId, { args }),
    command: (seed = '') => commandBar.open(seed),
    notify: (payload) => taskbar.notify(payload),
    showAbout: () => taskbar.showAbout(),
    updateSettings,
    resetSettings,
  };

  // Restore windows from the previous reload in this tab (never across tabs).
  try {
    const restored = wm.restoreSession();
    if (restored) {
      desktop.clearSelection();
      taskbar.notify({
        title: 'Session restored',
        body: `${restored} window${restored > 1 ? 's' : ''} returned from your last session.`,
        iconName: 'rotate-ccw',
        silent: true,
        timeout: 2600,
      });
    }
  } catch (err) {
    console.warn('[RadonOS] Session restore failed', err);
  }

  // Deep links from the service worker, context menus and shortcuts.
  const params = new URLSearchParams(window.location.search);
  const app = params.get('app');
  if (app) {
    const args = {};
    for (const key of ['url', 'path', 'section']) {
      const value = params.get(key);
      if (value) args[key] = value;
    }
    wm.open(app, { args });
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch { /* ignore */ }
  }

  // Boot splash is opt-in.
  if (settings.bootAnimation) {
    const splash = $('#boot-screen');
    splash.hidden = false;
    setTimeout(() => {
      splash.classList.add('leaving');
      setTimeout(() => { splash.hidden = true; }, 480);
    }, 950);
  }

  // A tiny timing hook for manual testing / automation.
  window.dispatchEvent(new CustomEvent('radonos:ready', {
    detail: { settings: getSettings(), windows: wm.list() },
  }));
  console.info(
    `%cRadonOS %cHalogen 1.0 %c· ${wm.list().length} window(s) · ${window.innerWidth}×${window.innerHeight}`,
    'color:#7dd3fc;font-weight:700',
    'color:#94a3b8',
    'color:#64748b',
  );
}

boot().catch((err) => {
  console.error('[RadonOS] Boot failed', err);
  const screen = document.createElement('div');
  screen.className = 'ros-modal-backdrop';
  screen.style.zIndex = '3000';
  screen.innerHTML = `
    <div class="ros-modal" style="width:min(560px,100%)">
      <div class="ros-modal-head">
        <span class="ros-modal-icon">${icon('alert', { size: 20 })}</span>
        <div>
          <div class="ros-modal-title">RadonOS could not start</div>
          <div class="ros-modal-sub">Something went wrong while booting the desktop.</div>
        </div>
      </div>
      <div class="ros-modal-body">
        <p style="font-family:var(--mono);font-size:12px;background:color-mix(in srgb,var(--bg) 50%,transparent);padding:10px;border-radius:8px;overflow:auto">${String(err?.stack || err)}</p>
        <p class="ros-hint">Try reloading the page. If you are running the extension, open
        <code>chrome://extensions</code> and inspect the RadonOS service worker / page console.</p>
      </div>
      <div class="ros-modal-foot">
        <button class="ros-btn primary" data-action="reload">Reload</button>
      </div>
    </div>`;
  screen.querySelector('[data-action="reload"]').addEventListener('click', () => window.location.reload());
  document.body.appendChild(screen);
});
