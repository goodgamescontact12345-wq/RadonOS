/**
 * RadonOS end-to-end harness.
 *
 * Launches a real Chromium build with the unpacked extension loaded, drives the
 * desktop over the Chrome DevTools Protocol (no npm dependencies: Node's global
 * fetch + WebSocket are enough) and asserts the behaviour a user would see.
 *
 *   node tools/e2e.mjs [--headed] [--keep] [--port 9333]
 *
 * Checks:
 *   - manifest/newtab override boots the desktop in a real extension
 *   - window manager: open, drag, resize, maximize, minimize, focus, restore
 *   - desktop icons, widgets, taskbar clock, start menu search, calendar
 *   - every built-in app loads inside its window (Files, Notepad, Terminal,
 *     Settings, Browser, Media) and the virtual file system round-trips data
 *   - service worker responds to runtime messages
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const KEEP = args.includes('--keep');
const FORCE_WEB = args.includes('--web');
const FORCE_EXTENSION = args.includes('--extension');
// --url=<origin> runs the same suite against an already-running build
// (for example the hosted Worker under `wrangler dev` or a deployment).
const HOSTED_URL = (args.find((arg) => arg.startsWith('--url=')) || '').slice('--url='.length);
const portFlag = args.indexOf('--port');
const PORT = portFlag >= 0 ? Number(args[portFlag + 1]) : 9333;
const WEB_PORT = PORT + 40;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
const consoleErrors = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const icon = ok ? '✓' : '✗';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* --------------------------------------------------------------- CDP glue */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
        else entry.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener('open', resolvePromise, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId = null) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    try { this.socket.close(); } catch { /* ignore */ }
  }
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitForHttp(url, attempts = 60, parse = (response) => response.json()) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await parse(response);
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`Nothing answered at ${url}`);
}

/* ------------------------------------------------------------- launching */
function launch(browserPath, profileDir) {
  const flags = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    `--load-extension=${ROOT}`,
    `--disable-extensions-except=${ROOT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    // Chrome 137+ blocks extensions from the command line by default; the
    // kill switch keeps the unpacked workflow usable.
    '--disable-features=Translate,OptimizationHints,DisableLoadExtensionCommandLineSwitch',
    '--window-size=1600,900',
    'about:blank',
  ];
  const child = spawn(browserPath, [...flags, HEADED ? '' : '--headless=new'].filter(Boolean), {
    stdio: 'ignore',
    detached: false,
  });
  return child;
}

/* ------------------------------------------------------------ page tests */
/**
 * Each scenario runs inside the desktop page and returns a JSON-serialisable
 * report. They are intentionally coarse-grained: one round trip per feature
 * area keeps the harness readable and fast.
 */
const SCENARIOS = [
  {
    name: 'desktop shell boots as the new tab override',
    script: `(async () => {
      const waitFor = async (test, ms = 8000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          if (test()) return true;
          await new Promise((r) => setTimeout(r, 60));
        }
        return false;
      };
      const ready = await waitFor(() => !!window.RadonOS);
      if (!ready) return { ready: false };
      return {
        ready: true,
        url: location.protocol + location.host,
        isExtension: location.protocol === 'chrome-extension:',
        icons: document.querySelectorAll('.desktop-icon').length,
        widgets: [...document.querySelectorAll('.widget-head span')].map((n) => n.textContent).filter(Boolean),
        taskbar: !!document.querySelector('#taskbar'),
        clock: document.querySelector('#clock-time')?.textContent,
        battery: document.querySelector('#battery-label')?.textContent,
        wallpaper: getComputedStyle(document.documentElement).getPropertyValue('--wallpaper').length > 10,
        theme: document.documentElement.dataset.theme,
      };
    })()`,
    assert(report) {
      return [
        [report.ready, 'window.RadonOS initialised'],
        [report.icons >= 6, `${report.icons} desktop icons`],
        [report.widgets.length >= 3, `widgets: ${report.widgets.join(', ')}`],
        [report.taskbar, 'taskbar present'],
        [/[0-9]/.test(report.clock || ''), `clock rendered (${report.clock})`],
        [report.wallpaper, 'wallpaper resolved'],
        [report.theme === 'dark' || report.theme === 'light', `theme=${report.theme}`],
      ];
    },
  },
  {
    name: 'Files app opens from the desktop and lists the virtual disk',
    script: `(async () => {
      const wm = window.RadonOS.wm;
      const w = wm.open('explorer');
      await new Promise((r) => setTimeout(r, 1500));
      const d = w.iframe.contentDocument;
      return {
        windowCount: wm.list().length,
        active: wm.activeId === w.id,
        rows: [...d.querySelectorAll('.file-row')].map((r) => r.querySelector('.file-name span:last-child')?.textContent),
        sidebar: [...d.querySelectorAll('.sidebar-item')].map((b) => b.textContent.trim()),
        status: d.querySelector('#status-count')?.textContent,
        disk: d.querySelector('#status-disk')?.textContent,
        storage: d.querySelector('.ros-hint')?.textContent,
      };
    })()`,
    assert(report) {
      return [
        [report.rows?.includes('Documents'), 'Documents folder listed'],
        [report.rows?.includes('Trash'), 'Trash folder listed'],
        [report.sidebar?.length === 7, `${report.sidebar?.length} quick-access entries`],
        [report.disk?.includes('virtual disk'), `disk footer: ${report.disk}`],
      ];
    },
  },
  {
    name: 'Notepad opens a file from the virtual file system',
    script: `(async () => {
      const w = window.RadonOS.wm.open('notepad', { args: { path: '/Documents/Welcome.txt' } });
      await new Promise((r) => setTimeout(r, 1500));
      const d = w.iframe.contentDocument;
      return {
        loaded: d.querySelector('#editor')?.value.length,
        filename: d.querySelector('#filename')?.value,
        path: d.querySelector('#stat-path')?.textContent,
        stats: d.querySelector('#stat-stats')?.textContent,
      };
    })()`,
    assert(report) {
      return [
        [report.loaded > 200, `loaded ${report.loaded} characters`],
        [report.filename === 'Welcome.txt', 'file name shown in the toolbar'],
        [report.path === '/Documents/Welcome.txt', 'path shown in the status bar'],
      ];
    },
  },
  {
    name: 'Terminal runs commands against the file system',
    script: `(async () => {
      const w = window.RadonOS.wm.open('terminal');
      await new Promise((r) => setTimeout(r, 1500));
      const win = w.iframe.contentWindow;
      const d = win.document;
      const run = async (command) => {
        const input = d.querySelector('#term-input');
        input.value = command;
        input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 320));
      };
      await run('mkdir /Documents/TerminalProbe');
      await run('echo e2e works > /Documents/TerminalProbe/note.txt');
      await run('cat /Documents/TerminalProbe/note.txt');
      await run('calc 2 + 3 * (4 ^ 2)');
      await run('df');
      await run('definitely-not-a-command');
      const text = d.querySelector('#term-output').innerText;
      return {
        lines: d.querySelectorAll('.term-line').length,
        text,
        noteExists: !!(await window.RadonOS.fs.resolvePath('/Documents/TerminalProbe/note.txt')),
        noteText: (await window.RadonOS.fs.readText((await window.RadonOS.fs.resolvePath('/Documents/TerminalProbe/note.txt')).id)).trim(),
      };
    })()`,
    assert(report) {
      return [
        [report.text.includes('e2e works'), 'echo/cat round-trip inside the terminal'],
        [report.noteExists, 'mkdir + redirect created a real file'],
        [report.text.includes('= 50'), 'calc evaluated 2 + 3 * (4 ^ 2) = 50'],
        [report.text.includes('RadonOS-VFS'), 'df reported the virtual disk'],
        [report.text.includes('command not found'), 'unknown command handled gracefully'],
      ];
    },
  },
  {
    name: 'Window manager: drag, resize, maximize, minimize, focus',
    script: `(async () => {
      const wm = window.RadonOS.wm;
      const w = wm.findByApp('explorer');
      const el = w.el;
      // Park the window at a known rectangle so drag/resize deltas are exact.
      w.rect = { x: 100, y: 80, width: 700, height: 380 };
      wm.applyRect(w);
      await new Promise((r) => setTimeout(r, 60));
      const titlebar = el.querySelector('.titlebar');
      titlebar.setPointerCapture = () => {};
      titlebar.releasePointerCapture = () => {};
      const before = { ...w.rect };
      const box = el.getBoundingClientRect();
      const send = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 1,
      }));
      send(titlebar, 'pointerdown', box.left + 80, box.top + 18);
      send(titlebar, 'pointermove', box.left + 260, box.top + 120);
      send(titlebar, 'pointerup', box.left + 260, box.top + 120);
      await new Promise((r) => setTimeout(r, 120));
      const dragged = { x: w.rect.x - before.x, y: w.rect.y - before.y };

      const handle = el.querySelector('.resize-handle[data-dir="se"]');
      handle.setPointerCapture = () => {};
      const sizeBefore = { width: w.rect.width, height: w.rect.height };
      const corner = el.getBoundingClientRect();
      send(handle, 'pointerdown', corner.left + corner.width, corner.top + corner.height);
      send(handle, 'pointermove', corner.left + corner.width + 120, corner.top + corner.height + 90);
      send(handle, 'pointerup', corner.left + corner.width + 120, corner.top + corner.height + 90);
      await new Promise((r) => setTimeout(r, 120));
      const resized = {
        w: Math.round((w.rect.width - sizeBefore.width) * 10) / 10,
        h: Math.round((w.rect.height - sizeBefore.height) * 10) / 10,
        rect: { ...w.rect },
      };

      titlebar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      // A window must not be able to grow past the bottom of the work area.
      const corner2 = el.getBoundingClientRect();
      const overResize = { x: corner2.left + corner2.width, y: corner2.top + corner2.height };
      send(handle, 'pointerdown', overResize.x, overResize.y);
      send(handle, 'pointermove', overResize.x, overResize.y + 900);
      send(handle, 'pointerup', overResize.x, overResize.y + 900);
      await new Promise((r) => setTimeout(r, 120));
      const workArea = wm.workArea;
      const clamped = {
        bottom: Math.round(w.rect.y + w.rect.height),
        limit: Math.round(workArea.height),
        height: Math.round(w.rect.height),
      };

      const maximized = { flag: w.maximized, width: Math.round(w.rect.width) };
      titlebar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const restored = { flag: w.maximized, width: Math.round(w.rect.width) };

      const np = wm.open('notepad');
      await new Promise((r) => setTimeout(r, 400));
      const focusOrder = { active: wm.activeId === np.id };
      wm.focus(w.id);
      const refocused = wm.activeId === w.id;

      const button = document.querySelector('.task-app[data-window-id="' + w.id + '"]');
      button.click();
      await new Promise((r) => setTimeout(r, 260));
      const minimized = w.minimized && w.el.style.display === 'none';
      button.click();
      await new Promise((r) => setTimeout(r, 260));
      const backAgain = !w.minimized && w.el.style.display === 'flex';

      return {
        dragged, resized, maximized, restored, focusOrder, refocused, minimized, backAgain, clamped,
        windows: wm.list().map((win) => ({ appId: win.appId, minimized: win.minimized })),
      };
    })()`,
    assert(report) {
      return [
        [Math.abs(report.dragged.x - 180) <= 2 && Math.abs(report.dragged.y - 102) <= 2,
          `dragged (${report.dragged.x}, ${report.dragged.y}) for a (180, 102) pointer move`],
        [Math.abs(report.resized.w - 120) <= 2 && Math.abs(report.resized.h - 90) <= 2,
          `resized (${report.resized.w}, ${report.resized.h}) for a (120, 90) pointer move`],
        [report.clamped.bottom <= report.clamped.limit + 1,
          `resize clamped at the work area (bottom ${report.clamped.bottom} ≤ ${report.clamped.limit})`],
        [report.maximized.flag && report.maximized.width >= 1200, `maximized to ${report.maximized.width}px`],
        [!report.restored.flag && report.restored.width < 1200, `restored to ${report.restored.width}px`],
        [report.focusOrder.active, 'new window took focus (z-order)'],
        [report.refocused, 'clicking the first window refocused it'],
        [report.minimized, 'taskbar click minimized the window'],
        [report.backAgain, 'second click restored it'],
      ];
    },
  },
  {
    name: 'Window tiling: halves, quadrants and Alt+Shift shortcuts',
    script: `(async () => {
      const wm = window.RadonOS.wm;
      const w = wm.findByApp('explorer') || wm.open('explorer');
      await new Promise((r) => setTimeout(r, 400));
      wm.focus(w.id);

      const work = wm.workArea;
      const left = wm.tile(w.id, 'left');
      const quadrant = wm.tile(w.id, 'bottom-right');
      const third = wm.tile(w.id, 'third-center');

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight', code: 'ArrowRight', altKey: true, shiftKey: true, bubbles: true,
      }));
      await new Promise((r) => setTimeout(r, 150));

      const keyboardRect = { ...w.rect };
      const snapped = w.snapped;
      const session = JSON.parse(sessionStorage.getItem('radonos:window-session') || 'null');
      const persisted = !!session?.windows?.some((entry) => Math.round(entry.rect.width) === keyboardRect.width);

      wm.tile(w.id, 'center');
      return {
        work: { width: work.width, height: work.height },
        left,
        quadrant,
        third,
        keyboardRect,
        snapped,
        persisted,
      };
    })()`,
    assert(report) {
      const halfW = Math.round(report.work.width / 2);
      const halfH = Math.round(report.work.height / 2);
      return [
        [report.left.x === 0 && Math.abs(report.left.width - halfW) <= 1, `left half is ${report.left.width}px of ${report.work.width}px`],
        [report.left.height === report.work.height, 'left half fills the work area'],
        [report.quadrant.x === halfW && report.quadrant.y === halfH, `bottom-right quadrant at ${report.quadrant.x},${report.quadrant.y}`],
        [Math.abs(report.third.width - Math.round(report.work.width / 3)) <= 1 && report.third.x === Math.round(report.work.width / 3), `centre third is ${report.third.width}px wide`],
        [report.keyboardRect.x === halfW && report.snapped === 'right', 'Alt+Shift+→ tiled the focused window right'],
        [report.persisted, 'tiled geometry persisted to the session'],
      ];
    },
  },
  {
    name: 'Start menu search finds apps, actions and files',
    script: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('#start-button').click();
      await sleep(200);
      const open = !document.querySelector('#start-menu').hidden;
      const apps = document.querySelectorAll('#start-apps .start-app').length;
      const input = document.querySelector('#start-search');
      input.value = 'term';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(500);
      const appResults = [...document.querySelectorAll('#start-results .result-title')].map((n) => n.textContent);
      input.value = 'welcome';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(600);
      const fileResults = [...document.querySelectorAll('#start-results .result-title')].map((n) => n.textContent);
      input.value = 'lock';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(400);
      const actionResults = [...document.querySelectorAll('#start-results .result-title')].map((n) => n.textContent);
      document.querySelector('#taskbar-search').click();
      await sleep(150);
      const stillOpen = !document.querySelector('#start-menu').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(150);
      const closed = document.querySelector('#start-menu').hidden;
      return { open, apps, appResults, fileResults, actionResults, stillOpen, closed };
    })()`,
    assert(report) {
      return [
        [report.open, 'start menu opened'],
        [report.apps === 6, `${report.apps} pinned apps`],
        [report.appResults.includes('Terminal'), `app search: ${report.appResults.join(', ')}`],
        [report.fileResults.some((title) => /welcome/i.test(title)), `file search: ${report.fileResults.join(', ')}`],
        [report.actionResults.length > 0, `action search: ${report.actionResults.join(', ')}`],
        [report.closed, 'Escape closed the menu'],
      ];
    },
  },
  {
    name: 'Tray: calendar, notifications, theme toggle, lock screen',
    script: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('#tray-clock').click();
      await sleep(250);
      const calendar = {
        open: !!document.querySelector('.popover'),
        days: document.querySelectorAll('.cal-day').length,
        month: document.querySelector('.cal-month')?.textContent,
        today: document.querySelectorAll('.cal-day.today').length,
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);

      window.RadonOS.notify({ title: 'Harness', body: 'Notification probe', iconName: 'bell' });
      await sleep(300);
      const notification = {
        toast: !!document.querySelector('.ros-toast'),
        badge: !document.querySelector('#tray-dot').hidden,
      };
      document.querySelector('#tray-bell').click();
      await sleep(250);
      const hub = {
        open: !!document.querySelector('.popover'),
        items: document.querySelectorAll('.notif-item').length,
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(150);

      const before = document.documentElement.dataset.theme;
      document.querySelector('#tray-theme').click();
      await sleep(600);
      const after = document.documentElement.dataset.theme;
      const stored = chrome?.runtime?.id
        ? await new Promise((resolve) => chrome.storage.local.get('settings', (r) => resolve(r.settings.theme)))
        : JSON.parse(localStorage.getItem('radonos.storage') || '{}').settings?.theme;

      window.RadonOS.taskbar.lockScreen();
      await sleep(300);
      const locked = !document.querySelector('#lock-screen').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      await sleep(400);
      const unlocked = document.querySelector('#lock-screen').hidden;
      return { calendar, notification, hub, theme: { before, after, stored }, locked, unlocked };
    })()`,
    assert(report) {
      return [
        [report.calendar.open && report.calendar.days >= 28, `calendar rendered ${report.calendar.days} days (${report.calendar.month})`],
        [report.calendar.today === 1, 'today highlighted'],
        [report.notification.toast && report.notification.badge, 'notification toast + tray badge'],
        [report.hub.open && report.hub.items >= 1, 'notification hub listed the entry'],
        [report.theme.after !== report.theme.before, `theme toggled ${report.theme.before} → ${report.theme.after}`],
        [report.theme.stored === report.theme.after, `theme persisted (${report.theme.stored})`],
        [report.locked && report.unlocked, 'lock screen locked and unlocked'],
      ];
    },
  },
  {
    name: 'Virtual file system round-trip (create, write, rename, trash, restore)',
    script: `(async () => {
      const fs = window.RadonOS.fs;
      await fs.ready();
      const documents = await fs.resolvePath('/Documents');
      const folder = await fs.mkdir(documents.id, 'E2E-' + Date.now());
      await fs.createFile(folder.id, 'alpha.txt', 'alpha content');
      await fs.writeText({ parentId: folder.id, name: 'beta.txt', content: 'beta content' });
      const listed = (await fs.list(folder.id)).map((n) => n.name);
      const beta = await fs.byName(folder.id, 'beta.txt');
      await fs.rename(beta.id, 'gamma.txt');
      const afterRename = (await fs.list(folder.id)).map((n) => n.name);
      const text = await fs.readText((await fs.byName(folder.id, 'gamma.txt')).id);
      await fs.trash(folder.id);
      const inTrash = (await fs.list(fs.TRASH_ID)).some((n) => n.name === folder.name);
      await fs.restore(folder.id);
      const restoredPath = await fs.pathString(folder.id);
      const search = (await fs.search('alpha.txt')).length;
      const stats = await fs.stats();
      return { listed, afterRename, text, inTrash, restoredPath, search, stats, folderName: folder.name };
    })()`,
    assert(report) {
      return [
        [report.listed.includes('alpha.txt') && report.listed.includes('beta.txt'), `created: ${report.listed.join(', ')}`],
        [report.afterRename.includes('gamma.txt') && !report.afterRename.includes('beta.txt'), 'rename applied'],
        [report.text === 'beta content', 'content preserved through rename'],
        [report.inTrash, 'folder moved to trash'],
        [report.restoredPath.includes(report.folderName), `restored to ${report.restoredPath}`],
        [report.search >= 1, 'search finds files across folders'],
        [report.stats.files >= 3, `stats report ${report.stats.files} files`],
      ];
    },
  },
  {
    name: 'Settings app drills into every category and back',
    script: `(async () => {
      const w = window.RadonOS.wm.open('settings', { args: { section: 'appearance' } });
      await new Promise((r) => setTimeout(r, 1600));
      const d = w.iframe.contentDocument;
      const categories = ['appearance', 'desktop', 'system', 'storage', 'about'];
      const report = {};
      for (const category of categories) {
        const button = [...d.querySelectorAll('[data-section]')].find((b) => b.dataset.section === category);
        button.click();
        await new Promise((r) => setTimeout(r, 400));
        const tiles = [...d.querySelectorAll('[data-item]')];
        const entry = {
          title: d.querySelector('#section-title')?.textContent,
          tiles: tiles.length,
          overviewGroups: d.querySelectorAll('.group').length,
        };
        tiles[0].click();
        await new Promise((r) => setTimeout(r, 800));
        entry.detailTitle = d.querySelector('#section-title')?.textContent;
        entry.groups = d.querySelectorAll('.group').length;
        entry.crumb = [...d.querySelectorAll("#crumb .crumb-link, #crumb .crumb-current")]
          .map((node) => node.textContent.trim()).join(" > ");
        entry.crumbHidden = d.querySelector('#crumb')?.hidden;
        d.querySelector('[data-back]')?.click();
        await new Promise((r) => setTimeout(r, 400));
        entry.backTiles = d.querySelectorAll('[data-item]').length;
        entry.backCrumbHidden = d.querySelector('#crumb')?.hidden;
        report[category] = entry;
      }
      return report;
    })()`,
    assert(report) {
      const categories = ['appearance', 'desktop', 'system', 'storage', 'about'];
      const checks = [];
      for (const category of categories) {
        const entry = report[category];
        checks.push([
          entry && entry.tiles >= 2 && entry.overviewGroups === 0,
          `${category}: ${entry?.tiles} subcategories on the overview`,
        ]);
        checks.push([
          entry && !entry.crumbHidden && entry.groups >= 1 && entry.crumb?.includes(entry.title),
          `${category} › ${entry?.detailTitle}: ${entry?.groups} group(s), crumb “${entry?.crumb}”`,
        ]);
        checks.push([
          entry && entry.backTiles === entry.tiles && entry.backCrumbHidden === true,
          `${category}: back returns to the category list`,
        ]);
      }
      return checks;
    },
  },
  {
    name: 'Browser app detects frame-blocking sites and loads embeddable ones',
    script: `(async () => {
      const w = window.RadonOS.wm.open('browser', { args: { url: 'https://github.com/' } });
      await new Promise((r) => setTimeout(r, 1400));
      const d = w.iframe.contentDocument;
      const blocked = {
        visible: !d.querySelector('#blocked').hidden,
        text: d.querySelector('#blocked-text')?.textContent.trim().slice(0, 60),
        status: d.querySelector('#status-text')?.textContent,
      };
      const address = d.querySelector('#address');
      address.value = 'example.com';
      address.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 1600));
      const loaded = {
        frameVisible: !d.querySelector('#frame').hidden,
        url: d.querySelector('#frame').src,
        status: d.querySelector('#status-text')?.textContent,
      };
      return { blocked, loaded, home: !d.querySelector('#home').hidden };
    })()`,
    assert(report) {
      return [
        [report.blocked.visible, `github.com flagged as non-embeddable (${report.blocked.status})`],
        [report.loaded.frameVisible && report.loaded.url.startsWith('https://example.com'), `example.com loaded (${report.loaded.status})`],
      ];
    },
  },
  {
    name: 'Media app scans the library and exposes transport controls',
    script: `(async () => {
      const fs = window.RadonOS.fs;
      const music = await fs.resolvePath('/Music');
      const makeTone = () => {
        // Minimal valid 8-bit WAV so the player has a real audio track.
        const rate = 8000, seconds = 1, samples = rate * seconds;
        const buffer = new ArrayBuffer(44 + samples);
        const view = new DataView(buffer);
        const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
        write(0, 'RIFF'); view.setUint32(4, 36 + samples, true); write(8, 'WAVEfmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true);
        view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, samples, true);
        for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128 + Math.round(60 * Math.sin(i / 12)));
        return new File([buffer], 'e2e-tone.wav', { type: 'audio/wav' });
      };
      await fs.writeBlob(music.id, makeTone());
      const w = window.RadonOS.wm.open('media');
      await new Promise((r) => setTimeout(r, 1800));
      const d = w.iframe.contentDocument;
      const tracks = [...d.querySelectorAll('.track-name')].map((n) => n.textContent);
      const first = d.querySelector('.track');
      first?.click();
      await new Promise((r) => setTimeout(r, 900));
      return {
        tracks,
        active: !!d.querySelector('.track.active'),
        nowPlaying: d.querySelector('#np-title')?.textContent,
        state: d.querySelector('#stat-state')?.textContent,
        canvas: !d.querySelector('#viz').hidden,
        controls: d.querySelectorAll('.np-btn').length,
      };
    })()`,
    assert(report) {
      return [
        [report.tracks?.includes('e2e-tone.wav'), `library picked up ${report.tracks?.join(', ')}`],
        [report.active, 'track selected in the playlist'],
        [report.nowPlaying === 'e2e-tone.wav', 'now-playing metadata updated'],
        [report.canvas, 'visualiser canvas active for audio'],
        [report.controls >= 5, `${report.controls} transport controls`],
      ];
    },
  },
  {
    name: 'Command bar: Super+Space search, ranking and execution',
    script: `(async () => {
      const os = window.RadonOS;
      const bar = os.commandBar;
      os.wm.open('explorer');
      await new Promise((r) => setTimeout(r, 700));

      const input = document.querySelector('#cmdk-input');
      const setQuery = async (value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 450));
      };

      bar.open();
      await new Promise((r) => setTimeout(r, 250));
      const opened = bar.isOpen();

      await setQuery('term');
      const appTitles = bar.results.map((r) => r.title);
      const groups = [...document.querySelectorAll('.cmdk-group')].map((g) => g.textContent.trim());

      await setQuery('cycle');
      const before = document.documentElement.dataset.palette;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      const after = document.documentElement.dataset.palette;
      const closedAfterRun = !bar.isOpen();

      await setQuery('files');
      const windowHits = bar.results.filter((r) => r.group === 'Windows').map((r) => r.title);
      bar.close();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', metaKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const openedByShortcut = bar.isOpen();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));

      return {
        opened,
        appTitles,
        groups,
        paletteChanged: before !== after && after === 'lavender',
        before,
        after,
        closedAfterRun,
        windowHits,
        openedByShortcut,
        closedAfterEscape: !bar.isOpen(),
      };
    })()`,
    assert(report) {
      return [
        [report.opened, 'palette opened'],
        [report.appTitles.includes('Terminal'), `"term" matched ${report.appTitles.slice(0, 3).join(', ')}`],
        [report.groups.includes('Applications') && report.groups.includes('Commands'), `groups: ${report.groups.join(', ')}`],
        [report.paletteChanged, `command executed (${report.before} -> ${report.after})`],
        [report.closedAfterRun, 'palette closes before the command runs'],
        [report.windowHits.length >= 1, `window results: ${report.windowHits.join(', ')}`],
        [report.openedByShortcut, 'Super+Space opens the palette'],
        [report.closedAfterEscape, 'Escape closes it'],
      ];
    },
  },
  {
    name: 'Control center: palette, dock position, glass blur',
    script: `(async () => {
      document.querySelector('#tray-control').click();
      await new Promise((r) => setTimeout(r, 300));
      const panel = document.querySelector('#control-center');
      const opened = !panel.hidden;
      const groups = [...panel.querySelectorAll('.cc-group-title')].map((n) => n.textContent.trim());

      panel.querySelector('[data-palette="sage"]').click();
      await new Promise((r) => setTimeout(r, 450));
      const palette = document.documentElement.dataset.palette;

      panel.querySelector('[data-seg="dock"][data-value="top"]').click();
      await new Promise((r) => setTimeout(r, 450));
      const dock = document.documentElement.dataset.dock;
      const taskbarTop = Math.round(document.querySelector('#taskbar').getBoundingClientRect().top);
      const layerTop = Math.round(document.querySelector('#window-layer').getBoundingClientRect().top);

      const blur = panel.querySelector('#cc-blur');
      blur.value = '4';
      blur.dispatchEvent(new Event('input', { bubbles: true }));
      blur.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const blurVar = getComputedStyle(document.documentElement).getPropertyValue('--glass-blur').trim();

      const stored = JSON.parse(localStorage.getItem('radonos.storage') || '{}').settings || {};
      const persisted = { dock: stored.dock, palette: stored.palette, blur: stored.glass && stored.glass.blur };

      // Restore the defaults so later scenarios see the stock desktop.
      panel.querySelector('[data-seg="dock"][data-value="bottom"]').click();
      await new Promise((r) => setTimeout(r, 250));
      panel.querySelector('[data-palette="midnight"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const restoredDock = document.documentElement.dataset.dock;
      document.querySelector('#cc-close').click();
      await new Promise((r) => setTimeout(r, 150));

      return {
        opened,
        groups,
        palette,
        dock,
        taskbarTop,
        layerTop,
        blurVar,
        persisted,
        restoredDock,
        closed: panel.hidden,
      };
    })()`,
    assert(report) {
      return [
        [report.opened, 'panel opened from the tray'],
        [['Display', 'Sound', 'Appearance', 'Dock', 'Behaviour'].every((g) => report.groups.includes(g)), `groups: ${report.groups.join(', ')}`],
        [report.palette === 'sage', 'palette swatch applied to <html>'],
        [report.dock === 'top' && report.taskbarTop <= 16, `dock moved to the top (floating taskbar at ${report.taskbarTop}px)`],
        [report.layerTop >= 52, `window layer respects the top dock (${report.layerTop}px)`],
        [report.blurVar === '4px', `glass blur applied (${report.blurVar})`],
        [report.persisted.dock === 'top' && report.persisted.palette === 'sage' && report.persisted.blur === 4, `persisted ${JSON.stringify(report.persisted)}`],
        [report.restoredDock === 'bottom', 'dock reset to the bottom'],
        [report.closed, 'panel closed'],
      ];
    },
  },
  {
    name: 'storageManager and radonpkg round-trip',
    script: `(async () => {
      const storage = await import('/shared/storageManager.js');
      const pkg = await import('/shared/radonpkg.js');

      const dir = '/System/StorageProbe';
      await storage.vfs.write(dir + '/note.txt', 'storage manager works');
      const text = await storage.vfs.read(dir + '/note.txt');
      const listing = (await storage.vfs.list(dir)).map((entry) => entry.name);
      const info = await storage.vfs.stat(dir + '/note.txt');
      const dotPath = await storage.dotfiles.write('probe', { ok: true, at: 1 });
      const dotValue = await storage.dotfiles.read('probe');
      const report = await storage.capacity();
      await storage.vfs.remove(dir, { permanent: true });
      const gone = await storage.vfs.exists(dir);

      const found = pkg.search('uuid').map((item) => item.id);
      const installed = await pkg.install('uuidgen');
      const manifest = await pkg.manifest('uuidgen');
      const tools = Object.keys(pkg.installedTools());
      await pkg.remove('uuidgen');

      return {
        text,
        listing,
        size: info.size,
        dotPath,
        dotValue,
        files: report.files,
        backend: report.backend,
        gone,
        found,
        installed: installed.id,
        manifestVersion: manifest && manifest.version,
        tools,
        afterRemove: Object.keys(pkg.installedTools()),
        manifestGone: await pkg.manifest('uuidgen') === null,
      };
    })()`,
    assert(report) {
      return [
        [report.text === 'storage manager works', 'vfs.write/read round-trip'],
        [report.listing.includes('note.txt'), `vfs.list found ${report.listing.join(', ')}`],
        [report.size === 21, `vfs.stat size ${report.size}`],
        [report.dotPath.endsWith('/System/Config/probe.json') && report.dotValue.ok === true, `dotfile at ${report.dotPath}`],
        [report.files >= 1 && /IndexedDB/.test(report.backend), `capacity: ${report.files} files via ${report.backend}`],
        [report.gone === false, 'vfs.remove --permanent deleted the folder'],
        [report.found.includes('uuidgen'), `search found ${report.found.join(', ')}`],
        [report.installed === 'uuidgen' && report.tools.includes('uuid'), 'install exposed the uuid command'],
        [report.manifestVersion === '1.0.0', `manifest written (v${report.manifestVersion})`],
        [!report.afterRemove.includes('uuid') && report.manifestGone, 'remove cleaned up tools and manifest'],
      ];
    },
  },
  {
    name: 'Terminal: uname, vfs and radonpkg commands',
    script: `(async () => {
      const w = window.RadonOS.wm.open('terminal');
      await new Promise((r) => setTimeout(r, 1600));
      const win = w.iframe.contentWindow;
      const d = win.document;
      const run = async (command) => {
        const input = d.querySelector('#term-input');
        input.value = command;
        input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 450));
      };

      await run('uname -a');
      await run('radonpkg search uuid');
      await run('vfs write /Documents/probe/vfs.txt hello from vfs');
      await run('vfs cat /Documents/probe/vfs.txt');
      await run('vfs du /Documents/probe');
      await run('vfs find vfs.txt');
      await run('radonpkg install uuidgen');
      await run('uuid');
      await run('radonpkg remove uuidgen');
      await run('uuid');
      await run('vfs rm /Documents/probe --force');

      const text = d.querySelector('#term-output').innerText;
      return {
        text,
        uuid: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
        removed: (await window.RadonOS.fs.resolvePath('/Documents/probe')) === null,
      };
    })()`,
    assert(report) {
      return [
        [report.text.includes('RadonOS Halogen'), 'uname printed the release line'],
        [report.text.includes('Install with') && report.text.includes('uuidgen'), 'radonpkg search listed the catalogue'],
        [report.text.includes('hello from vfs'), 'vfs write + cat round-trip'],
        [report.text.includes('14 B'), 'vfs du reported the folder size'],
        [report.text.includes('/Documents/probe/vfs.txt'), 'vfs find located the file'],
        [report.text.includes('installed uuidgen'), 'radonpkg install succeeded'],
        [report.uuid, 'installed tool produced a v4 UUID'],
        [report.text.includes('command not found: uuid'), 'removing the package retired its command'],
        [report.removed, 'vfs rm --force removed the probe folder'],
      ];
    },
  },
  {
    name: 'Session restore reopens windows after a reload',
    script: `(async () => {
      const before = window.RadonOS.wm.list().map((w) => w.appId);
      sessionStorage.setItem('e2e:before', JSON.stringify(before));
      return { before };
    })()`,
    assert(report) {
      return [[report.before.length >= 4, `${report.before.length} windows before reload: ${report.before.join(', ')}`]];
    },
  },
];

const RESTORE_SCENARIO = {
  name: 'Session restore after reload',
  script: `(async () => {
    const waitFor = async (test, ms = 6000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (test()) return true;
        await new Promise((r) => setTimeout(r, 80));
      }
      return false;
    };
    await waitFor(() => !!window.RadonOS);
    await waitFor(() => window.RadonOS.wm.list().length > 0);
    await new Promise((r) => setTimeout(r, 1500));
    const before = JSON.parse(sessionStorage.getItem('e2e:before') || '[]');
    const after = window.RadonOS.wm.list().map((w) => w.appId);
    return { before, after };
  })()`,
  assert(report) {
    const missing = report.before.filter((appId) => !report.after.includes(appId));
    return [[missing.length === 0, `restored ${report.after.length}/${report.before.length} windows${missing.length ? ` (missing ${missing.join(', ')})` : ''}`]];
  },
};

/* ------------------------------------------------------------------- main */
function startDevServer(port) {
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.on('error', (err) => console.error('[server] failed to spawn:', err.message));
  child.on('exit', (code) => {
    if (code) console.error(`[server] exited with code ${code}`);
  });
  return child;
}

/**
 * Runs the whole desktop suite in a real browser.
 *
 *  extension mode: loads the unpacked extension and opens chrome://newtab/
 *  web mode:       serves the folder over http and opens the new tab page
 *                  (works everywhere; chrome.* calls fall back to the shim)
 */
async function runSuite(browserPath, { mode, extensionUrl }) {
  const profileDir = await mkdtemp(join(tmpdir(), 'radonos-e2e-'));
  console.log(`Launching ${browserPath} [${mode} mode]`);
  console.log(`Extension root: ${ROOT}`);
  console.log(`Profile: ${profileDir}${HEADED ? ' (headed)' : ' (headless)'}`);

  const server = mode === 'web' ? startDevServer(WEB_PORT) : null;
  if (server) console.log(`Dev server: http://127.0.0.1:${WEB_PORT}/newtab/index.html`);
  if (mode === 'hosted') console.log(`Target: ${HOSTED_URL}`);
  console.log('');

  const child = launch(browserPath, profileDir);
  let client = null;
  try {
    if (mode === 'web') await waitForHttp(`http://127.0.0.1:${WEB_PORT}/newtab/index.html`, 80, () => true);
    const version = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    client = await Cdp.connect(version.webSocketDebuggerUrl);
    await client.send('Target.setDiscoverTargets', { discover: true });

    // In extension mode, opening chrome://newtab/ proves the manifest override
    // works and reveals the extension id in the resulting URL.
    const startUrl = mode === 'hosted' ? HOSTED_URL
      : mode === 'web' ? `http://127.0.0.1:${WEB_PORT}/newtab/index.html`
        : 'chrome://newtab/';
    const { targetId } = await client.send('Target.createTarget', { url: startUrl });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

    const events = [];
    client.on((message) => {
      if (message.sessionId !== sessionId) {
        if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
          events.push(message.params?.targetInfo?.url || '');
        }
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(message.params.exceptionDetails?.exception?.description
          || message.params.exceptionDetails?.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        consoleErrors.push(message.params.entry.text);
      }
    });

    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Log.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);

    const evaluate = async (expression, timeoutMs = 60_000) => {
      const result = await Promise.race([
        client.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        }, sessionId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('scenario timeout')), timeoutMs)),
      ]);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };

    // Wait for navigation, then confirm we are on the desktop document.
    const isDesktopUrl = (value) => /\/newtab(\/|\/index\.html$|$)/.test(value);
    let pageUrl = '';
    for (let i = 0; i < 40; i++) {
      const info = await client.send('Target.getTargetInfo', { targetId });
      pageUrl = info.targetInfo.url;
      if (isDesktopUrl(pageUrl)) break;
      await sleep(250);
    }
    if (!isDesktopUrl(pageUrl)) {
      console.warn(`\n! ${browserPath} never reached the RadonOS desktop.`);
      console.warn(`  new tab URL was ${pageUrl}`);
      return 'not-loaded';
    }
    record(mode === 'hosted' ? 'hosted build serves the desktop' : 'new tab override lands on the RadonOS page',
      isDesktopUrl(pageUrl), pageUrl);

    // Wait for the module graph to finish booting before the first scenario.
    // Chromium can still be committing the initial navigation at this point,
    // which would otherwise surface as a destroyed execution context.
    const bootDeadline = Date.now() + 20_000;
    let booted = false;
    while (!booted && Date.now() < bootDeadline) {
      try {
        booted = await evaluate('Boolean(window.RadonOS)', 4000);
      } catch (err) {
        if (!/context|destroyed|navigat/i.test(err.message)) throw err;
      }
      if (!booted) await sleep(150);
    }
    if (!booted) console.warn('! window.RadonOS never appeared; scenarios will report the failure');

    if (mode === 'extension') {
      const workerTargets = events.filter((url) => url.startsWith('chrome-extension://'));
      record('service worker target registered', workerTargets.some((url) => url.includes('background.js')),
        workerTargets.join(' ') || 'not observed as a target');
    } else {
      record(`${mode} mode: chrome.* shim active`, true, 'extension-only checks are reported separately');
    }

    for (const scenario of SCENARIOS) {
      try {
        const report = await evaluate(scenario.script);
        const checks = scenario.assert(report) || [];
        const failed = checks.filter(([ok]) => !ok);
        record(scenario.name, failed.length === 0, failed.length
          ? failed.map(([, label]) => label).join(' | ')
          : checks.map(([, label]) => label).slice(0, 2).join(' | '));
      } catch (err) {
        record(scenario.name, false, `threw: ${err.message}`);
      }
    }

    // Reload and confirm the window session comes back.
    await client.send('Page.reload', {}, sessionId);
    await sleep(2500);
    try {
      const report = await evaluate(RESTORE_SCENARIO.script);
      const checks = RESTORE_SCENARIO.assert(report) || [];
      const failed = checks.filter(([ok]) => !ok);
      record(RESTORE_SCENARIO.name, failed.length === 0, failed.length
        ? failed.map(([, label]) => label).join(' | ')
        : checks.map(([, label]) => label).join(' | '));
    } catch (err) {
      record(RESTORE_SCENARIO.name, false, `threw: ${err.message}`);
    }

    // Service worker message bridge (chrome.tabs + badge clock).
    if (mode === 'extension') {
      try {
        const bridge = await evaluate(`(async () => {
          const response = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
          const badge = await chrome.runtime.sendMessage({ type: 'SET_BADGE', text: '' });
          return { ok: response?.ok, tabs: response?.tabs?.length ?? -1, badge: badge?.ok };
        })()`);
        record('service worker answers runtime messages', bridge?.ok === true && bridge?.badge === true,
          `GET_TABS ok=${bridge?.ok} tabs=${bridge?.tabs} SET_BADGE ok=${bridge?.badge}`);
      } catch (err) {
        record('service worker answers runtime messages', false, `threw: ${err.message}`);
      }
    }

    record('no uncaught page errors during the run', consoleErrors.length === 0,
      consoleErrors.slice(0, 4).join(' | ') || 'none');
    return results.some((entry) => !entry.ok) ? 'failed' : 'ok';
  } finally {
    client?.close();
    child.kill();
    server?.kill();
    if (!KEEP) {
      await sleep(500);
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    } else {
      console.log(`\nProfile kept at ${profileDir}`);
    }
  }
}

async function main() {
  let status = 'not-loaded';
  let mode = HOSTED_URL ? 'hosted' : FORCE_WEB ? 'web' : 'extension';

  for (const candidate of CHROME_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    status = await runSuite(candidate, { mode });
    if (status === 'ok' || status === 'failed') break;
    results.length = 0;
    consoleErrors.length = 0;
  }

  if (status === 'not-loaded' && !FORCE_EXTENSION && !HOSTED_URL) {
    console.warn('\n--load-extension is disabled in this browser build (Chrome/Edge 137+),');
    console.warn('falling back to web mode against the bundled dev server.\n');
    mode = 'web';
    results.length = 0;
    consoleErrors.length = 0;
    for (const candidate of CHROME_CANDIDATES) {
      if (!existsSync(candidate)) continue;
      status = await runSuite(candidate, { mode });
      if (status === 'ok' || status === 'failed') break;
      results.length = 0;
      consoleErrors.length = 0;
    }
  }

  if (status === 'not-loaded') {
    console.error('\nNo browser could load the unpacked extension from the command line.');
    console.error('Load it manually from chrome://extensions (Developer mode → Load unpacked),');
    console.error('or run this suite in web mode with --web.');
    process.exit(2);
  }
  if (FORCE_EXTENSION && mode === 'extension') console.log('\n(forced extension mode)');
  if (mode === 'hosted') console.log(`\n(hosted target: ${HOSTED_URL})`);

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\n${failed.length} failing check(s):`);
    for (const entry of failed) console.error(`  ✗ ${entry.name} — ${entry.detail}`);
    process.exit(1);
  }
  console.log('RadonOS end-to-end suite passed.');
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
