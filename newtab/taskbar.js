import { APPS, OS_VERSION, OS_CODENAME } from '../shared/registry.js';
import { icon, radonMark } from '../shared/icons.js';
import { getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { showContextMenu, showModal, toast, escapeHtml, formatBytes, relativeTime, clamp } from '../shared/ui.js';
import { setVolume, playChime, playClick } from '../shared/audio.js';
import { tabs, isExtension } from '../shared/platform.js';
import * as FS from '../shared/fs.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const weekdayShort = (date) => date.toLocaleDateString(undefined, { weekday: 'short' });
const initials = (name) => String(name || 'Radon User')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0].toUpperCase())
  .join('') || 'RU';

const THEME_GLYPH = (mode) => (mode === 'dark' ? 'sun' : 'moon');

export function createTaskbar({ wm, desktop, widgets }) {
  const startButton = $('#start-button');
  const startMenu = $('#start-menu');
  const startSearch = $('#start-search');
  const startApps = $('#start-apps');
  const startResults = $('#start-results');
  const taskbarApps = $('#taskbar-apps');
  const trayDot = $('#tray-dot');
  const clockTime = $('#clock-time');
  const clockDate = $('#clock-date');
  const batteryLabel = $('#battery-label');
  const lockScreen = $('#lock-screen');

  let popover = null;
  let notifications = loadNotifications();
  let searchToken = 0;
  let resultItems = [];
  let resultIndex = 0;
  let battery = null;
  let lastVolume = 0.45;
  let currentMonth = new Date();
  let locked = false;

  /* ------------------------------------------------------------- icon fill */
  function paintIcons(root = document) {
    $$('[data-icon]', root).forEach((node) => {
      if (node.dataset.painted === '1') return;
      const name = node.dataset.icon;
      const size = Number(node.dataset.size) || 18;
      node.innerHTML = name === 'mark' ? radonMark(size) : icon(name, { size });
      node.dataset.painted = '1';
    });
  }

  function paintThemeGlyphs() {
    const mode = document.documentElement.dataset.theme || 'dark';
    const glyph = THEME_GLYPH(mode);
    $$('[data-action="theme"]').forEach((button) => {
      const holder = button.querySelector('span');
      if (holder) holder.innerHTML = icon(glyph, { size: 17 });
      else button.innerHTML = icon(glyph, { size: 17 });
    });
    const tray = $('#tray-theme span');
    if (tray) tray.innerHTML = icon(glyph, { size: 17 });
  }

  paintIcons();
  paintThemeGlyphs();

  /* --------------------------------------------------------------- clock */
  function updateClock() {
    const settings = getSettings();
    const now = new Date();
    const time = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: settings.showSeconds ? '2-digit' : undefined,
      hour12: !settings.clock24,
    });
    clockTime.textContent = time;
    clockDate.textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    $('#tray-clock').title = now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' });

    $('#lock-time').textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !settings.clock24,
    });
    $('#lock-date').textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ------------------------------------------------------------- battery */
  async function initBattery() {
    if (!navigator.getBattery) {
      batteryLabel.textContent = 'AC';
      $('#tray-battery').title = 'Battery status unavailable';
      return;
    }
    try {
      battery = await navigator.getBattery();
      const sync = () => {
        const percent = Math.round(battery.level * 100);
        batteryLabel.textContent = battery.charging ? `${percent}%⚡` : `${percent}%`;
        $('#tray-battery').title = `Battery ${percent}%${battery.charging ? ' (charging)' : ''}`;
      };
      sync();
      battery.addEventListener('levelchange', sync);
      battery.addEventListener('chargingchange', sync);
    } catch {
      batteryLabel.textContent = 'AC';
    }
  }
  void initBattery();

  /* ------------------------------------------------------------- windows */
  function syncWindows() {
    const windows = wm.list();
    taskbarApps.innerHTML = '';
    for (const win of windows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `task-app running${win.active ? ' active' : ''}${win.minimized ? ' minimized' : ''}`;
      button.style.setProperty('--task-color', win.color);
      button.dataset.windowId = win.id;
      button.title = `${win.title}${win.minimized ? ' (minimized)' : ''}`;
      button.innerHTML = `${icon(win.icon, { size: 19 })}<span class="task-indicator"></span>`;
      button.addEventListener('click', () => {
        playClick();
        wm.toggleMinimize(win.id);
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showContextMenu([
          {
            label: win.minimized ? 'Restore' : (win.active ? 'Minimize' : 'Focus'),
            iconName: win.minimized ? 'restore' : 'minimize',
            action: () => (win.minimized ? wm.restore(win.id) : (win.active ? wm.minimize(win.id) : wm.focus(win.id))),
          },
          {
            label: win.maximized ? 'Restore size' : 'Maximize',
            iconName: win.maximized ? 'restore' : 'maximize',
            action: () => wm.toggleMaximize(win.id),
          },
          { separator: true },
          { label: 'Close window', iconName: 'close', danger: true, action: () => wm.close(win.id) },
        ], event.clientX, event.clientY - 8);
      });
      taskbarApps.appendChild(button);
    }
  }
  wm.subscribe(syncWindows);
  syncWindows();

  /* ------------------------------------------------------------- toasts */
  function pushNotification(entry) {
    notifications.unshift(entry);
    notifications = notifications.slice(0, 40);
    saveNotifications();
    renderBadge();
  }

  function renderBadge() {
    const unread = notifications.length;
    trayDot.hidden = unread === 0;
    $('#tray-bell').title = unread ? `${unread} notification${unread > 1 ? 's' : ''}` : 'Notifications';
  }

  function notify({ title = 'RadonOS', body = '', iconName = 'bell', type = 'info', silent = false, timeout = 3800 } = {}) {
    toast(body, { title, type, iconName, timeout });
    pushNotification({
      id: crypto.randomUUID(),
      title,
      body,
      iconName,
      type,
      at: Date.now(),
    });
    if (!silent) playChime();
  }

  function loadNotifications() {
    try {
      return JSON.parse(sessionStorage.getItem('radonos:notifications') || '[]');
    } catch {
      return [];
    }
  }

  function saveNotifications() {
    try {
      sessionStorage.setItem('radonos:notifications', JSON.stringify(notifications));
    } catch { /* best effort */ }
  }
  renderBadge();

  /* ------------------------------------------------------------ popovers */
  function closePopover() {
    if (!popover) return;
    popover.el.remove();
    popover.anchor?.classList.remove('open');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onPopReset, true);
    popover = null;
  }

  function onOutside(event) {
    if (!popover) return;
    if (popover.el.contains(event.target) || popover.anchor?.contains(event.target)) return;
    if (event.target.closest('.ros-modal-backdrop, .ros-menu')) return;
    closePopover();
  }

  function onPopReset(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePopover();
    }
  }

  function togglePopover(key, anchor, builder, { width = 318 } = {}) {
    if (popover?.key === key) {
      closePopover();
      return;
    }
    closePopover();
    const el = document.createElement('div');
    el.className = 'popover';
    el.style.width = `${width}px`;
    el.style.maxHeight = 'calc(100vh - var(--taskbar-h) - 24px)';
    el.style.overflowY = 'auto';
    document.body.appendChild(el);
    builder(el);

    const rect = anchor.getBoundingClientRect();
    const measured = el.getBoundingClientRect().width || width;
    el.style.left = `${clamp(rect.right - measured, 8, window.innerWidth - measured - 8)}px`;
    anchor.classList.add('open');
    popover = { key, el, anchor };

    setTimeout(() => {
      if (!popover || popover.key !== key) return;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onPopReset, true);
    }, 0);
  }

  /* ------------------------------------------------------------- calendar */
  function renderCalendar(el) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const cells = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({ day: prevDays - i, other: true });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        day,
        other: false,
        today: year === today.getFullYear() && month === today.getMonth() && day === today.getDate(),
      });
    }
    while (cells.length % 7 !== 0) cells.push({ day: cells.length - startOffset - daysInMonth + 1, other: true });

    el.innerHTML = `
      <div class="popover-title">${icon('calendar', { size: 13 })} Calendar</div>
      <div class="cal-head">
        <span class="cal-month">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <div class="cal-nav">
          <button type="button" data-cal="-1" title="Previous month">${icon('chevron-left', { size: 15 })}</button>
          <button type="button" data-cal="today" title="Today">${icon('clock', { size: 14 })}</button>
          <button type="button" data-cal="1" title="Next month">${icon('chevron-right', { size: 15 })}</button>
        </div>
      </div>
      <div class="cal-grid">
        ${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => `<div class="cal-dow">${day}</div>`).join('')}
        ${cells.map((cell) => `
          <button type="button" class="cal-day${cell.other ? ' other' : ''}${cell.today ? ' today' : ''}" data-day="${cell.day}" data-other="${cell.other ? '1' : '0'}">${cell.day}</button>`).join('')}
      </div>
      <div class="cal-today-row">
        <span>${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span>${notifications.length} notification${notifications.length === 1 ? '' : 's'}</span>
      </div>`;

    el.querySelectorAll('[data-cal]').forEach((button) => {
      button.addEventListener('click', () => {
        const step = button.dataset.cal;
        if (step === 'today') currentMonth = new Date();
        else currentMonth = new Date(year, month + Number(step), 1);
        renderCalendar(el);
      });
    });
    el.querySelectorAll('.cal-day').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.other === '1') return;
        toast(`${first.toLocaleDateString(undefined, { month: 'long' })} ${button.dataset.day}, ${year}`, {
          iconName: 'calendar',
          title: 'Date',
        });
      });
    });
  }

  /* -------------------------------------------------------- notifications */
  function renderNotifications(el) {
    el.innerHTML = `
      <div class="popover-title">${icon('bell', { size: 13 })} Notifications
        <span class="ros-spacer"></span>
        ${notifications.length ? '<button class="ros-btn sm ghost" data-clear>Clear all</button>' : ''}
      </div>
      ${notifications.length ? `<div class="notif-list">${notifications.map((item) => `
        <div class="notif-item">
          <span class="notif-ico">${icon(item.iconName || 'bell', { size: 15 })}</span>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(item.title)}</div>
            <div class="notif-text">${escapeHtml(item.body)}</div>
            <div class="notif-time">${relativeTime(item.at)}</div>
          </div>
        </div>`).join('')}</div>`
    : `<div class="ros-empty" style="padding:26px 8px">${icon('bell', { size: 26 })}<span>You're all caught up.</span></div>`}
      <div class="popover-foot">
        <button class="ros-btn sm ghost" data-demo>Send test notification</button>
      </div>`;

    el.querySelector('[data-clear]')?.addEventListener('click', () => {
      notifications = [];
      saveNotifications();
      renderBadge();
      renderNotifications(el);
    });
    el.querySelector('[data-demo]')?.addEventListener('click', () => {
      notify({
        title: 'RadonOS',
        body: 'Notifications appear here. Background alarms can post them too.',
        iconName: 'check-circle',
        type: 'success',
      });
      renderNotifications(el);
    });
  }

  /* ------------------------------------------------------------- battery */
  function renderBattery(el) {
    const percent = battery ? Math.round(battery.level * 100) : 100;
    const charging = battery ? battery.charging : true;
    el.innerHTML = `
      <div class="popover-title">${icon('battery', { size: 13 })} Battery</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="color:var(--accent)">${icon('battery', { size: 32, stroke: 1.4 })}</span>
        <div>
          <div style="font-size:26px;font-weight:300;letter-spacing:-.03em">${percent}%</div>
          <div class="ros-hint">${charging ? 'Charging' : 'On battery power'}</div>
        </div>
      </div>
      <div class="mon-bar"><span style="width:${percent}%"></span></div>
      <div class="popover-section" style="margin-top:12px">
        <div class="perf-stat"><span>Status</span><b>${battery ? (charging ? 'Charging' : 'Discharging') : 'AC power'}</b></div>
        <div class="perf-stat" style="margin-top:6px"><span>Time remaining</span><b>${battery?.dischargingTime ? `${Math.round(battery.dischargingTime / 60)} min` : '—'}</b></div>
        <div class="perf-stat" style="margin-top:6px"><span>Source</span><b>${battery ? 'Battery API' : 'Unavailable'}</b></div>
      </div>`;
  }

  /* -------------------------------------------------------------- memory */
  function renderMemory(el) {
    const memory = performance.memory;
    const used = memory?.usedJSHeapSize || 0;
    const limit = memory?.jsHeapSizeLimit || 0;
    const windows = wm.list();
    el.innerHTML = `
      <div class="popover-title">${icon('cpu', { size: 13 })} Performance</div>
      <div class="perf-grid">
        <div class="perf-stat"><span>JS heap</span><b>${memory ? `${formatBytes(used)} / ${formatBytes(limit)}` : 'Not exposed'}</b></div>
        <div class="perf-stat"><span>Memory pressure</span><b>${memory ? `${((used / limit) * 100).toFixed(1)}%` : '—'}</b></div>
        <div class="perf-stat"><span>Open windows</span><b>${windows.filter((win) => !win.minimized).length} / ${windows.length}</b></div>
        <div class="perf-stat"><span>CPU threads</span><b>${navigator.hardwareConcurrency || '?'}</b></div>
        <div class="perf-stat"><span>Session uptime</span><b>${Math.floor(performance.now() / 60000)} min</b></div>
      </div>
      <div class="popover-section" style="margin-top:10px">
        <div class="ros-hint">RadonOS <b>${OS_VERSION}</b> runs entirely inside this tab. No background document, no remote assets.</div>
      </div>
      <div class="popover-foot">
        <button class="ros-btn sm" data-open-files>${icon('folder', { size: 14 })} Open Files</button>
        <button class="ros-btn sm ghost" data-open-settings>${icon('settings', { size: 14 })} Settings</button>
      </div>`;
    el.querySelector('[data-open-files]').addEventListener('click', () => {
      closePopover();
      wm.open('explorer');
    });
    el.querySelector('[data-open-settings]').addEventListener('click', () => {
      closePopover();
      wm.open('settings', { args: { section: 'system' } });
    });
  }

  /* -------------------------------------------------------------- volume */
  function volumeGlyph(value) {
    return value <= 0 ? 'volume-off' : 'volume';
  }

  function renderVolume(el) {
    const settings = getSettings();
    const value = Math.round((settings.volume ?? 0.45) * 100);
    el.innerHTML = `
      <div class="popover-title">${icon('volume', { size: 13 })} Sound</div>
      <div class="vol-row">
        <button class="vol-btn" data-mute title="Mute">${icon(volumeGlyph(value), { size: 17 })}</button>
        <input type="range" min="0" max="100" value="${value}" aria-label="Volume">
        <span class="vol-value">${value}%</span>
      </div>
      <div class="popover-section" style="margin-top:12px">
        <div class="ros-row">
          <span class="ros-hint">System sounds</span>
          <span class="ros-spacer"></span>
          <label class="ros-switch"><input type="checkbox" data-sounds ${settings.sounds ? 'checked' : ''}><span class="ros-switch-track"></span></label>
        </div>
      </div>
      <div class="ros-hint">Sounds are synthesized locally with the Web Audio API.</div>`;

    const slider = el.querySelector('input[type="range"]');
    const valueLabel = el.querySelector('.vol-value');
    const muteButton = el.querySelector('[data-mute]');
    slider.addEventListener('input', () => {
      const next = Number(slider.value) / 100;
      valueLabel.textContent = `${slider.value}%`;
      muteButton.innerHTML = icon(volumeGlyph(next), { size: 17 });
      setVolume(next);
      void updateSettings({ volume: next });
    });
    slider.addEventListener('change', () => playChime());
    muteButton.addEventListener('click', () => {
      const current = getSettings().volume ?? 0.45;
      if (current > 0) {
        lastVolume = current;
        setVolume(0);
        void updateSettings({ volume: 0 });
      } else {
        setVolume(lastVolume || 0.45);
        void updateSettings({ volume: lastVolume || 0.45 });
      }
      closePopover();
    });
    el.querySelector('[data-sounds]').addEventListener('change', (event) => {
      void updateSettings({ sounds: event.target.checked });
      if (event.target.checked) playChime();
    });
  }

  /* ------------------------------------------------------------ lock screen */
  function lockScreenNow() {
    closeStartMenu();
    closePopover();
    locked = true;
    lockScreen.hidden = false;
    updateClock();

    const unlock = () => {
      if (!locked) return;
      locked = false;
      lockScreen.hidden = true;
      playChime();
      document.removeEventListener('keydown', onKeyUnlock);
    };
    const onKeyUnlock = () => unlock();
    setTimeout(() => {
      document.addEventListener('pointerdown', unlock, { once: true });
      document.addEventListener('keydown', onKeyUnlock);
    }, 180);
  }

  /* ---------------------------------------------------------------- about */
  async function showAbout() {
    const [stats, estimate] = await Promise.all([
      FS.stats().catch(() => ({ files: 0, folders: 0, bytes: 0 })),
      navigator.storage?.estimate?.().catch(() => null) || Promise.resolve(null),
    ]);
    const windows = wm.list();
    const body = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <span style="filter:drop-shadow(0 0 22px rgba(90,200,255,.35))">${radonMark(54)}</span>
        <div>
          <div style="font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--text)">RadonOS</div>
          <div class="ros-hint">Version ${OS_VERSION} · ${OS_CODENAME}</div>
        </div>
      </div>
      <p>A local-first desktop environment that turns the new tab page into a
      workspace. Every app is sandboxed in its own window, files live in
      IndexedDB, and nothing is uploaded anywhere.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0">
        <div class="perf-stat"><span>Open windows</span><b>${windows.length}</b></div>
        <div class="perf-stat"><span>Files stored</span><b>${stats.files}</b></div>
        <div class="perf-stat"><span>Virtual disk</span><b>${formatBytes(stats.bytes)}</b></div>
        <div class="perf-stat"><span>Browser quota</span><b>${estimate?.quota ? formatBytes(estimate.quota) : 'unlimited'}</b></div>
        <div class="perf-stat"><span>Runtime</span><b>${isExtension ? 'Extension' : 'Dev preview'}</b></div>
        <div class="perf-stat"><span>Engine</span><b>Chromium · MV3</b></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
        ${['Manifest V3', 'IndexedDB VFS', 'ES modules', 'Web Audio', 'Battery API', 'CSS Grid'].map((tag) => `<span class="ros-kbd">${tag}</span>`).join('')}
      </div>
      <p class="ros-hint">Shortcuts: <span class="ros-kbd">Alt+Space</span> start menu · <span class="ros-kbd">Alt+W</span> close · <span class="ros-kbd">Alt+M</span> minimize · <span class="ros-kbd">Alt+Tab</span> cycle.</p>
      <p class="ros-hint">Built as a single Chromium extension. Works in Chrome, Edge, Helium, Brave and other MV3 browsers.</p>`;

    showModal({
      title: 'About RadonOS',
      subtitle: `Halogen ${OS_VERSION} — local session`,
      iconName: 'info',
      width: 520,
      body,
      actions: [
        { label: 'Close', value: null, variant: 'ghost' },
        {
          label: 'Open Settings',
          value: 'settings',
          variant: 'primary',
          iconName: 'settings',
        },
      ],
    }).then((result) => {
      if (result === 'settings') wm.open('settings');
    });
  }

  /* --------------------------------------------------------------- start */
  function paintUser() {
    const settings = getSettings();
    const name = settings.userName || 'Radon User';
    $('#start-username').textContent = name;
    $('#start-avatar').textContent = initials(name);
    $('#lock-username').textContent = name;
    $('#lock-avatar').textContent = initials(name);
  }

  function renderStartApps() {
    startApps.innerHTML = '';
    for (const app of APPS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'start-app';
      button.dataset.app = app.id;
      button.style.setProperty('--tile-color', app.color);
      button.innerHTML = `
        <span class="start-app-tile">${icon(app.icon, { size: 22 })}</span>
        <span class="start-app-name">${escapeHtml(app.name)}</span>`;
      button.title = app.description;
      button.addEventListener('click', () => {
        playClick();
        closeStartMenu();
        wm.open(app.id);
      });
      startApps.appendChild(button);
    }
  }

  function showDefaultResults() {
    startResults.hidden = true;
    startResults.innerHTML = '';
    $('#start-default').hidden = false;
    resultItems = [];
  }

  function openStartMenu({ focus = true } = {}) {
    closePopover();
    renderStartApps();
    startMenu.hidden = false;
    startButton.setAttribute('aria-expanded', 'true');
    $('#taskbar-search').classList.add('open');
    startSearch.value = '';
    showDefaultResults();
    if (focus) setTimeout(() => startSearch.focus(), 20);
  }

  function closeStartMenu() {
    startMenu.hidden = true;
    startButton.setAttribute('aria-expanded', 'false');
    $('#taskbar-search').classList.remove('open');
    startSearch.value = '';
    showDefaultResults();
  }

  function toggleStartMenu() {
    if (startMenu.hidden) openStartMenu();
    else closeStartMenu();
  }

  startButton.addEventListener('click', () => {
    playClick();
    toggleStartMenu();
  });
  $('#taskbar-search').addEventListener('click', () => openStartMenu());

  document.addEventListener('pointerdown', (event) => {
    if (startMenu.hidden) return;
    if (event.target.closest('#start-menu, #start-button, #taskbar-search')) return;
    closeStartMenu();
  });

  /* ------------------------------------------------------- start actions */
  async function toggleTheme() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    await updateSettings({ theme: next });
    paintThemeGlyphs();
    toast(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled`, { iconName: next === 'dark' ? 'moon' : 'sun' });
  }

  function actionHandlers() {
    return {
      theme: toggleTheme,
      settings: () => wm.open('settings'),
      about: showAbout,
      lock: lockScreenNow,
      restart: () => window.location.reload(),
    };
  }

  $$('#start-menu [data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const handler = actionHandlers()[button.dataset.action];
      closeStartMenu();
      handler?.();
    });
  });

  $('#start-user').addEventListener('click', () => {
    closeStartMenu();
    wm.open('settings', { args: { section: 'system' } });
  });

  /* --------------------------------------------------------------- search */
  function searchActions() {
    return [
      { title: 'Open Settings', subtitle: 'System preferences', iconName: 'settings', keywords: 'settings preferences', run: () => wm.open('settings') },
      { title: 'Change wallpaper', subtitle: 'Appearance and accent colours', iconName: 'image', keywords: 'wallpaper background theme', run: () => wm.open('settings', { args: { section: 'appearance' } }) },
      { title: 'Display settings', subtitle: 'Widgets, icon labels, boot animation', iconName: 'monitor', keywords: 'display widgets icons', run: () => wm.open('settings', { args: { section: 'desktop' } }) },
      { title: 'Open Terminal', subtitle: 'Command line', iconName: 'terminal', keywords: 'terminal shell command', run: () => wm.open('terminal') },
      { title: 'About RadonOS', subtitle: `Version ${OS_VERSION}`, iconName: 'info', keywords: 'about version info help', run: showAbout },
      { title: 'Toggle theme', subtitle: 'Switch light / dark', iconName: 'sun', keywords: 'theme dark light', run: toggleTheme },
      { title: 'Lock screen', subtitle: 'Return to the lock screen', iconName: 'lock', keywords: 'lock away', run: lockScreenNow },
      {
        title: 'Empty trash',
        subtitle: 'Permanently delete trashed files',
        iconName: 'trash',
        keywords: 'trash delete empty recycle',
        run: async () => {
          await FS.emptyTrash();
          notify({ title: 'Trash emptied', body: 'Deleted files were permanently removed.', iconName: 'trash', type: 'success', silent: true });
        },
      },
    ];
  }

  function scoreMatch(haystack, needle) {
    const text = haystack.toLowerCase();
    if (text.startsWith(needle)) return 3;
    if (text.includes(needle)) return 2;
    if (needle.split(/\s+/).every((part) => text.includes(part))) return 1;
    return 0;
  }

  async function runSearch(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      showDefaultResults();
      return;
    }
    const token = ++searchToken;
    const appHits = APPS
      .map((app) => ({
        app,
        score: Math.max(
          scoreMatch(app.name, needle),
          scoreMatch(app.keywords || '', needle),
          scoreMatch(app.description, needle),
        ),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score);

    const actionHits = searchActions().filter((action) => (
      scoreMatch(action.title, needle) || scoreMatch(action.keywords || '', needle)
    ));

    let fileHits = [];
    let tabHits = [];
    try {
      const nodes = await FS.search(query);
      fileHits = nodes.slice(0, 6);
    } catch { /* FS not ready */ }
    if (isExtension) {
      try {
        tabHits = await tabs.search(query);
      } catch { /* tabs optional */ }
    }
    if (token !== searchToken) return;

    const entries = [];
    appHits.forEach(({ app }) => entries.push({
      group: 'Applications',
      title: app.name,
      subtitle: app.description,
      iconName: app.icon,
      color: app.color,
      run: () => wm.open(app.id),
    }));
    actionHits.forEach((action) => entries.push({
      group: 'Actions',
      title: action.title,
      subtitle: action.subtitle,
      iconName: action.iconName,
      run: action.run,
    }));
    for (const node of fileHits) {
      const parent = await FS.pathString(node.parentId).catch(() => '/');
      entries.push({
        group: 'Files',
        title: node.name,
        subtitle: `${node.parentId === FS.TRASH_ID ? 'Trash' : parent} · ${node.kind === 'folder' ? 'Folder' : formatBytes(node.size)}`,
        iconName: node.kind === 'folder' ? 'folder' : 'file-text',
        run: () => {
          if (node.kind === 'folder') wm.open('explorer', { args: { path: `${parent === '/' ? '' : parent}/${node.name}` } });
          else if (`${node.mime}`.startsWith('audio/') || `${node.mime}`.startsWith('video/')) wm.open('media', { args: { path: `${parent === '/' ? '' : parent}/${node.name}` } });
          else wm.open('notepad', { args: { path: `${parent === '/' ? '' : parent}/${node.name}` } });
        },
      });
    }
    tabHits.forEach((tab) => entries.push({
      group: 'Open tabs',
      title: tab.title || tab.url,
      subtitle: tab.url,
      iconName: 'globe',
      run: () => tabs.open(tab.url),
    }));

    if (!entries.length) {
      $('#start-default').hidden = true;
      startResults.hidden = false;
      startResults.innerHTML = `<div class="start-empty">No results for “${escapeHtml(query)}”</div>`;
      resultItems = [];
      return;
    }

    $('#start-default').hidden = true;
    startResults.hidden = false;
    resultItems = entries;
    resultIndex = 0;
    renderSearchResults();
  }

  function renderSearchResults() {
    let html = '';
    let currentGroup = '';
    entriesLoop:
    for (const [index, item] of resultItems.entries()) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        html += `<div class="result-group">${currentGroup}</div>`;
      }
      html += `
        <button type="button" class="result-item${index === resultIndex ? ' active' : ''}" data-result="${index}">
          <span class="result-icon" style="${item.color ? `color:${item.color}` : ''}">${icon(item.iconName || 'file', { size: 16 })}</span>
          <span class="result-text">
            <span class="result-title">${escapeHtml(item.title)}</span>
            <span class="result-sub">${escapeHtml(item.subtitle || '')}</span>
          </span>
          <span class="result-shortcut">${index === resultIndex ? '↵' : ''}</span>
        </button>`;
      if (index > 40) break entriesLoop;
    }
    startResults.innerHTML = html;
    $$('.result-item', startResults).forEach((button) => {
      button.addEventListener('pointerenter', () => {
        resultIndex = Number(button.dataset.result);
        $$('.result-item', startResults).forEach((node) => node.classList.toggle('active', node === button));
      });
      button.addEventListener('click', () => executeResult(Number(button.dataset.result)));
    });
    $('.result-item.active', startResults)?.scrollIntoView({ block: 'nearest' });
  }

  function executeResult(index) {
    const item = resultItems[index];
    if (!item) return;
    closeStartMenu();
    item.run();
  }

  startSearch.addEventListener('input', () => {
    resultIndex = 0;
    void runSearch(startSearch.value);
  });

  startSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (startSearch.value) {
        startSearch.value = '';
        showDefaultResults();
      } else {
        closeStartMenu();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!resultItems.length) return;
      resultIndex = (resultIndex + (event.key === 'ArrowDown' ? 1 : -1) + resultItems.length) % resultItems.length;
      renderSearchResults();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (resultItems.length) executeResult(resultIndex);
      else if (startSearch.value.trim()) {
        // No app/file match: search the web in a RadonOS browser window.
        closeStartMenu();
        wm.open('browser', { args: { url: `https://duckduckgo.com/?q=${encodeURIComponent(startSearch.value.trim())}` } });
      }
    }
  });

  /* --------------------------------------------------------------- tray */
  $('#tray-clock').addEventListener('click', (event) => {
    togglePopover('calendar', event.currentTarget, renderCalendar, { width: 300 });
  });

  $('#tray-bell').addEventListener('click', (event) => {
    togglePopover('notifications', event.currentTarget, renderNotifications, { width: 336 });
    notifications = notifications.map((item) => ({ ...item, read: true }));
  });

  $('#tray-volume').addEventListener('click', (event) => {
    togglePopover('volume', event.currentTarget, renderVolume, { width: 300 });
  });

  $('#tray-battery').addEventListener('click', (event) => {
    togglePopover('battery', event.currentTarget, renderBattery, { width: 300 });
  });

  $('#tray-memory').addEventListener('click', (event) => {
    togglePopover('memory', event.currentTarget, renderMemory, { width: 320 });
  });

  $('#tray-theme').addEventListener('click', () => {
    void toggleTheme();
  });

  $('#show-desktop').addEventListener('click', () => {
    wm.toggleShowDesktop();
  });

  /* ------------------------------------------------------------ shortcuts */
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.code === 'Space') {
      event.preventDefault();
      toggleStartMenu();
      return;
    }
    if (event.key === 'Escape') {
      if (!startMenu.hidden) closeStartMenu();
      closePopover();
    }
  });

  /* ------------------------------------------------------------- settings */
  const unsubscribe = onSettingsChange((settings) => {
    paintUser();
    updateClock();
    paintThemeGlyphs();
    const volume = settings.volume ?? 0.45;
    if (volume > 0) lastVolume = volume;
    setVolume(volume);
  });
  paintUser();
  setVolume(getSettings().volume ?? 0.45);

  return {
    notify,
    showAbout,
    lockScreen: lockScreenNow,
    openStartMenu,
    closeStartMenu,
    closePopover,
    refresh() {
      syncWindows();
      paintUser();
      updateClock();
    },
    destroy() {
      unsubscribe.then((off) => off?.());
      closePopover();
    },
  };
}
