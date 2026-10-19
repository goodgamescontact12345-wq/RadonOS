import { getApp } from '../shared/registry.js';
import { icon } from '../shared/icons.js';
import { playClose, playOpen } from '../shared/audio.js';
import { getSettings } from '../shared/settings.js';

const SESSION_KEY = 'radonos:window-session';
const MIN_VISIBLE = 140;
const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * Tiling layouts, expressed as fractions of the work area.
 * `x`/`y` are the top-left corner, `w`/`h` the size.
 */
export const TILE_LAYOUTS = {
  left: { x: 0, y: 0, w: 1 / 2, h: 1 },
  right: { x: 1 / 2, y: 0, w: 1 / 2, h: 1 },
  'top-left': { x: 0, y: 0, w: 1 / 2, h: 1 / 2 },
  'top-right': { x: 1 / 2, y: 0, w: 1 / 2, h: 1 / 2 },
  'bottom-left': { x: 0, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
  'bottom-right': { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
  'third-left': { x: 0, y: 0, w: 1 / 3, h: 1 },
  'third-center': { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
  'third-right': { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  center: { x: 0.1, y: 0.08, w: 0.8, h: 0.84 },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Floating, resizable, snapping windows inside the new tab page.
 * Emits a `change` event whenever the window list or focus changes.
 */
export class WindowManager extends EventTarget {
  constructor({ layer, snapPreview }) {
    super();
    this.layer = layer;
    this.snapPreview = snapPreview;
    this.windows = new Map();
    this.zCounter = 100;
    this.activeId = null;
    this.counter = 0;
    this.cascade = 0;

    document.addEventListener('keydown', (event) => this.onKey(event));
    window.addEventListener('resize', () => this.onResize());
  }

  /* --------------------------------------------------------------- helpers */
  get workArea() {
    const rect = this.layer.getBoundingClientRect();
    return { x: 0, y: 0, width: rect.width, height: rect.height };
  }

  subscribe(callback) {
    this.addEventListener('change', callback);
    return () => this.removeEventListener('change', callback);
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.list() }));
  }

  list() {
    return [...this.windows.values()].map((win) => ({
      id: win.id,
      appId: win.appId,
      title: win.title,
      icon: win.app.icon,
      color: win.app.color,
      minimized: win.minimized,
      maximized: win.maximized,
      active: win.id === this.activeId,
      z: win.z,
      rect: { ...win.rect },
    }));
  }

  get active() {
    return this.activeId ? this.windows.get(this.activeId) : null;
  }

  find(windowId) {
    return this.windows.get(windowId) || null;
  }

  findByApp(appId) {
    return [...this.windows.values()].find((win) => win.appId === appId) || null;
  }

  findByFrame(frameWindow) {
    return [...this.windows.values()].find((win) => win.iframe?.contentWindow === frameWindow) || null;
  }

  defaultRect(app, offset = 0) {
    const work = this.workArea;
    const width = Math.min(app.width || 860, Math.max(360, work.width - 48));
    const height = Math.min(app.height || 580, Math.max(260, work.height - 48));
    const baseX = (work.width - width) / 2;
    const baseY = (work.height - height) / 2;
    const shift = (offset % 6) * 26;
    return {
      x: clamp(baseX + shift, 8, Math.max(8, work.width - width - 8)),
      y: clamp(baseY + shift * 0.7, 8, Math.max(8, work.height - height - 8)),
      width,
      height,
    };
  }

  buildSrc(app, args, windowId) {
    const url = new URL(app.src, document.baseURI);
    const params = { ...args, wid: windowId };
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /* ------------------------------------------------------------------ open */
  open(appId, options = {}) {
    const app = getApp(appId);
    if (!app) {
      console.warn(`[RadonOS] Unknown app "${appId}"`);
      return null;
    }

    const singleton = options.singleton ?? app.singleton;
    if (singleton) {
      const existing = this.findByApp(appId);
      if (existing) {
        if (options.args && Object.keys(options.args).length) {
          existing.args = { ...existing.args, ...options.args };
          existing.iframe.src = this.buildSrc(app, existing.args, existing.id);
          this.showLoading(existing);
        }
        if (existing.minimized) this.restore(existing.id);
        else this.focus(existing.id);
        return existing;
      }
    }

    const id = `${appId}-${++this.counter}`;
    const rect = options.rect
      ? this.normalizeRect(options.rect, app)
      : this.defaultRect(app, this.cascade++);
    const win = {
      id,
      appId,
      app,
      title: options.title || app.name,
      args: options.args || {},
      rect,
      prevRect: null,
      minimized: false,
      maximized: false,
      snapped: null,
      z: ++this.zCounter,
      el: null,
      iframe: null,
    };

    const element = document.createElement('section');
    element.className = 'window';
    element.dataset.windowId = id;
    element.dataset.appId = appId;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', `${app.name} window`);
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.zIndex = String(win.z);
    element.style.setProperty('--app-color', app.color);

    element.innerHTML = `
      <header class="titlebar">
        <span class="win-app-icon">${icon(app.icon, { size: 15 })}</span>
        <span class="window-title"></span>
        <div class="window-controls">
          <button class="window-btn" data-cmd="minimize" title="Minimize" aria-label="Minimize">${icon('minimize', { size: 15 })}</button>
          <button class="window-btn" data-cmd="maximize" title="Maximize" aria-label="Maximize">${icon('maximize', { size: 13 })}</button>
          <button class="window-btn close" data-cmd="close" title="Close" aria-label="Close">${icon('close', { size: 15 })}</button>
        </div>
      </header>
      <div class="window-body">
        <div class="window-loading"><span class="ros-spinner"></span></div>
        <iframe title="${app.name}"></iframe>
      </div>
      ${RESIZE_DIRS.map((dir) => `<div class="resize-handle" data-dir="${dir}"></div>`).join('')}`;

    element.querySelector('.window-title').textContent = win.title;
    win.el = element;
    win.iframe = element.querySelector('iframe');

    if (options.minimized) {
      win.minimized = true;
      element.style.display = 'none';
    }
    if (options.maximized) {
      win.prevRect = { ...rect };
      win.maximized = true;
      win.rect = { ...this.workArea };
      this.applyRect(win);
      element.classList.add('maximized');
      element.querySelector('[data-cmd="maximize"]').innerHTML = icon('restore', { size: 14 });
    }

    this.attachEvents(win);
    this.layer.appendChild(element);
    this.windows.set(id, win);

    this.showLoading(win);
    win.iframe.src = this.buildSrc(app, win.args, id);
    win.iframe.addEventListener('load', () => this.hideLoading(win), { once: false });

    this.focus(id);
    if (!options.minimized) playOpen();
    this.persist();
    this.emit();
    return win;
  }

  showLoading(win) {
    const loader = win.el?.querySelector('.window-loading');
    if (!loader) return;
    loader.classList.remove('hidden');
    clearTimeout(win.loaderTimer);
    win.loaderTimer = setTimeout(() => this.hideLoading(win), 8000);
  }

  hideLoading(win) {
    clearTimeout(win.loaderTimer);
    const loader = win.el?.querySelector('.window-loading');
    if (!loader) return;
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 260);
  }

  /* ----------------------------------------------------------------- focus */
  focus(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (win.minimized) {
      this.restore(id);
      return;
    }
    for (const other of this.windows.values()) other.el.classList.remove('active');
    win.el.classList.add('active');
    win.z = ++this.zCounter;
    win.el.style.zIndex = String(win.z);
    this.activeId = id;
    this.emit();
  }

  setTitle(id, title) {
    const win = this.windows.get(id);
    if (!win) return;
    win.title = title;
    win.el.querySelector('.window-title').textContent = title;
    this.persist();
    this.emit();
  }

  /* ------------------------------------------------------- state changes */
  minimize(id) {
    const win = this.windows.get(id);
    if (!win || win.minimized) return;
    win.minimized = true;
    win.el.classList.remove('active');
    win.el.classList.add('minimizing');
    const target = win.el;
    setTimeout(() => {
      target.style.display = 'none';
      target.classList.remove('minimizing');
    }, 150);
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.topVisible();
      if (next) this.focus(next.id);
    }
    playClose();
    this.persist();
    this.emit();
  }

  restore(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.minimized = false;
    win.el.style.display = 'flex';
    win.el.classList.remove('minimized');
    if (!getSettings().reduceMotion) {
      win.el.animate(
        [
          { opacity: 0, transform: 'scale(.94) translateY(20px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 190, easing: 'cubic-bezier(.2,.9,.25,1)' },
      );
    }
    this.focus(id);
    playOpen();
    this.persist();
  }

  toggleMinimize(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (win.minimized) this.restore(id);
    else if (this.activeId === id) this.minimize(id);
    else this.focus(id);
  }

  maximize(id) {
    const win = this.windows.get(id);
    if (!win || win.maximized) return;
    win.prevRect = { ...win.rect };
    win.maximized = true;
    win.snapped = null;
    win.rect = { ...this.workArea };
    win.el.classList.add('maximized');
    this.applyRect(win);
    win.el.querySelector('[data-cmd="maximize"]').innerHTML = icon('restore', { size: 14 });
    this.focus(id);
    this.persist();
  }

  restoreSize(id) {
    const win = this.windows.get(id);
    if (!win || !win.maximized) return;
    win.maximized = false;
    win.el.classList.remove('maximized');
    win.rect = { ...(win.prevRect || this.defaultRect(win.app)) };
    this.applyRect(win);
    win.el.querySelector('[data-cmd="maximize"]').innerHTML = icon('maximize', { size: 13 });
    this.persist();
  }

  toggleMaximize(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (win.maximized) this.restoreSize(id);
    else this.maximize(id);
    this.focus(id);
  }

  /**
   * Tile a window to a named layout (`left`, `top-right`, `third-center`, …).
   * Tiling intentionally ignores an app's minimum size: a third of a small
   * screen is still a third, and the app scrolls inside it. Returns the new
   * rectangle so callers (and tests) can read the result.
   */
  tile(id = this.activeId, layout = 'center') {
    const win = this.windows.get(id);
    const spec = TILE_LAYOUTS[layout];
    if (!win || !spec) return null;

    if (win.maximized) {
      win.maximized = false;
      win.el.classList.remove('maximized');
      const glyph = win.el.querySelector('[data-cmd="maximize"]');
      if (glyph) glyph.innerHTML = icon('maximize', { size: 13 });
    }

    const work = this.workArea;
    const rect = {
      x: Math.round(work.x + work.width * spec.x),
      y: Math.round(work.y + work.height * spec.y),
      width: Math.max(240, Math.round(work.width * spec.w)),
      height: Math.max(160, Math.round(work.height * spec.h)),
    };
    win.rect = rect;
    win.snapped = layout;
    this.applyRect(win);
    this.hideSnap();
    this.focus(win.id);
    this.persist();
    return { ...rect };
  }

  /** Cycle through the layouts that make sense for a bounded screen. */
  cycleTile(id = this.activeId) {
    const order = ['left', 'right', 'top-left', 'top-right', 'bottom-right', 'bottom-left', 'center'];
    const win = this.windows.get(id);
    if (!win) return null;
    const index = order.indexOf(win.snapped);
    return this.tile(id, order[(index + 1) % order.length]);
  }

  close(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.el.classList.add('closing');
    win.el.style.pointerEvents = 'none';
    this.windows.delete(id);
    if (this.activeId === id) this.activeId = null;
    const iframe = win.iframe;
    setTimeout(() => {
      iframe.src = 'about:blank';
      win.el.remove();
    }, 150);
    const next = this.topVisible();
    if (next) this.focus(next.id);
    playClose();
    this.persist();
    this.emit();
  }

  minimizeAll() {
    const visible = [...this.windows.values()].filter((win) => !win.minimized);
    visible.forEach((win) => {
      win.minimized = true;
      win.el.style.display = 'none';
      win.el.classList.remove('active');
    });
    this.activeId = null;
    this.persist();
    this.emit();
    if (visible.length) playClose();
    return visible.length;
  }

  restoreAll() {
    const minimized = [...this.windows.values()].filter((win) => win.minimized);
    minimized.forEach((win) => {
      win.minimized = false;
      win.el.style.display = 'flex';
    });
    if (minimized.length) this.focus(minimized[minimized.length - 1].id);
    this.persist();
    this.emit();
  }

  toggleShowDesktop() {
    const visible = [...this.windows.values()].filter((win) => !win.minimized);
    return visible.length ? this.minimizeAll() : this.restoreAll();
  }

  topVisible() {
    return [...this.windows.values()]
      .filter((win) => !win.minimized)
      .sort((a, b) => b.z - a.z)[0] || null;
  }

  cycle() {
    const ordered = [...this.windows.values()]
      .filter((win) => !win.minimized)
      .sort((a, b) => b.z - a.z);
    if (!ordered.length) {
      this.restoreAll();
      return;
    }
    const index = ordered.findIndex((win) => win.id === this.activeId);
    const next = ordered[(index + 1) % ordered.length];
    this.focus(next.id);
  }

  /* ------------------------------------------------------- drag + resize */
  applyRect(win) {
    win.el.style.left = `${Math.round(win.rect.x)}px`;
    win.el.style.top = `${Math.round(win.rect.y)}px`;
    win.el.style.width = `${Math.round(win.rect.width)}px`;
    win.el.style.height = `${Math.round(win.rect.height)}px`;
  }

  normalizeRect(rect, app) {
    const work = this.workArea;
    const width = clamp(rect.width || rect.w || app.width || 800, app.minWidth || 320, work.width);
    const height = clamp(rect.height || rect.h || app.height || 560, app.minHeight || 220, work.height);
    return {
      x: clamp(rect.x ?? 40, 0, Math.max(0, work.width - MIN_VISIBLE)),
      y: clamp(rect.y ?? 40, 0, Math.max(0, work.height - 48)),
      width,
      height,
    };
  }

  attachEvents(win) {
    const titlebar = win.el.querySelector('.titlebar');
    const controls = win.el.querySelector('.window-controls');

    controls.addEventListener('pointerdown', (event) => event.stopPropagation());
    controls.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cmd]');
      if (!button) return;
      event.stopPropagation();
      const command = button.dataset.cmd;
      if (command === 'minimize') this.minimize(win.id);
      if (command === 'maximize') this.toggleMaximize(win.id);
      if (command === 'close') this.close(win.id);
    });

    titlebar.addEventListener('pointerdown', (event) => this.startDrag(win, event));
    titlebar.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      this.toggleMaximize(win.id);
    });
    win.el.addEventListener('pointerdown', () => {
      if (this.activeId !== win.id) this.focus(win.id);
    }, true);

    win.el.querySelectorAll('.resize-handle').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => this.startResize(win, event, handle.dataset.dir));
    });
  }

  startDrag(win, event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    this.focus(win.id);

    if (win.maximized) {
      const previous = win.prevRect || this.defaultRect(win.app);
      const ratio = clamp((event.clientX - win.rect.x) / win.rect.width, 0.1, 0.9);
      this.restoreSize(win.id);
      win.rect.width = previous.width;
      win.rect.height = previous.height;
      win.rect.x = clamp(event.clientX - previous.width * ratio, 0, this.workArea.width - previous.width);
      win.rect.y = clamp(event.clientY - 18, 0, this.workArea.height - 60);
      this.applyRect(win);
    }

    const titlebar = win.el.querySelector('.titlebar');
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = { ...win.rect };
    let snapping = null;

    win.el.classList.add('dragging');
    document.body.classList.add('dragging-window');
    titlebar.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const work = this.workArea;
      win.rect.x = clamp(startRect.x + dx, -win.rect.width + MIN_VISIBLE, work.width - MIN_VISIBLE);
      win.rect.y = clamp(startRect.y + dy, 0, work.height - 42);
      this.applyRect(win);

      const zone = this.snapZone(moveEvent.clientX, moveEvent.clientY);
      if (zone !== snapping) {
        snapping = zone;
        this.showSnap(zone);
      }
    };

    const onUp = (upEvent) => {
      titlebar.releasePointerCapture?.(upEvent.pointerId);
      titlebar.removeEventListener('pointermove', onMove);
      titlebar.removeEventListener('pointerup', onUp);
      titlebar.removeEventListener('pointercancel', onUp);
      win.el.classList.remove('dragging');
      document.body.classList.remove('dragging-window');
      this.hideSnap();

      if (snapping === 'max') {
        this.maximize(win.id);
      } else if (snapping === 'left' || snapping === 'right') {
        const work = this.workArea;
        const width = Math.round(work.width / 2);
        win.rect = {
          x: snapping === 'left' ? 0 : work.width - width,
          y: 0,
          width,
          height: work.height,
        };
        win.snapped = snapping;
        this.applyRect(win);
        this.persist();
        this.emit();
      } else {
        win.snapped = null;
        this.persist();
        this.emit();
      }
    };

    titlebar.addEventListener('pointermove', onMove);
    titlebar.addEventListener('pointerup', onUp);
    titlebar.addEventListener('pointercancel', onUp);
  }

  startResize(win, event, dir) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (win.maximized) return;
    this.focus(win.id);

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...win.rect };
    const work = this.workArea;
    const minWidth = win.app.minWidth || 320;
    const minHeight = win.app.minHeight || 220;
    const edges = dir.includes('n') ? 'n' : dir.includes('s') ? 's' : '';
    const sides = dir.includes('e') ? 'e' : dir.includes('w') ? 'w' : '';

    win.el.classList.add('resizing');
    document.body.classList.add('dragging-window');
    handle.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let { x, y, width, height } = start;

      if (sides === 'e') width = start.width + dx;
      if (sides === 'w') {
        width = start.width - dx;
        x = start.x + dx;
        if (width < minWidth) { x = start.x + start.width - minWidth; width = minWidth; }
      }
      if (edges === 's') height = start.height + dy;
      if (edges === 'n') {
        height = start.height - dy;
        y = start.y + dy;
        if (height < minHeight) { y = start.y + start.height - minHeight; height = minHeight; }
      }

      width = Math.min(width, work.width - Math.max(0, x));
      height = Math.min(height, work.height - Math.max(0, y));
      x = clamp(x, 0, work.width - minWidth);
      y = clamp(y, 0, work.height - minHeight);

      win.rect = { x, y, width: Math.max(minWidth, width), height: Math.max(minHeight, height) };
      this.applyRect(win);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      win.el.classList.remove('resizing');
      document.body.classList.remove('dragging-window');
      this.persist();
      this.emit();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  snapZone(x, y) {
    const work = this.workArea;
    if (y <= 6) return 'max';
    if (x <= 14) return 'left';
    if (x >= work.width - 14) return 'right';
    return null;
  }

  showSnap(zone) {
    if (!this.snapPreview) return;
    if (!zone) {
      this.hideSnap();
      return;
    }
    const work = this.workArea;
    const rect = zone === 'max'
      ? { x: 0, y: 0, width: work.width, height: work.height }
      : {
        x: zone === 'left' ? 0 : Math.round(work.width / 2),
        y: 0,
        width: Math.round(work.width / 2),
        height: work.height,
      };
    Object.assign(this.snapPreview.style, {
      left: `${rect.x + 5}px`,
      top: `${rect.y + 5}px`,
      width: `${rect.width - 10}px`,
      height: `${rect.height - 10}px`,
    });
    this.snapPreview.hidden = false;
  }

  hideSnap() {
    if (this.snapPreview) this.snapPreview.hidden = true;
  }

  /* ---------------------------------------------------------- window keys */
  onKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const active = this.activeId;

    // Alt+Shift tiles the focused window. Alt+Shift+↑/↓ keep their familiar
    // maximise/restore meaning; digits cover quadrants, 5 centres the window.
    if (event.shiftKey && active) {
      const layouts = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Digit1: 'top-left',
        Digit2: 'top-right',
        Digit3: 'bottom-left',
        Digit4: 'bottom-right',
        Digit5: 'center',
      };
      if (event.code === 'ArrowUp') {
        event.preventDefault();
        this.maximize(active);
        return;
      }
      if (event.code === 'ArrowDown') {
        event.preventDefault();
        this.restoreSize(active);
        return;
      }
      if (event.code === 'KeyT') {
        event.preventDefault();
        this.cycleTile(active);
        return;
      }
      const layout = layouts[event.code];
      if (layout) {
        event.preventDefault();
        this.tile(active, layout);
        return;
      }
    }

    if (event.code === 'KeyW' && active) {
      event.preventDefault();
      this.close(active);
    } else if (event.code === 'KeyM' && active) {
      event.preventDefault();
      this.minimize(active);
    } else if (event.code === 'Tab' && this.windows.size) {
      event.preventDefault();
      this.cycle();
    }
  }

  onResize() {
    const work = this.workArea;
    for (const win of this.windows.values()) {
      if (win.maximized) {
        win.rect = { ...work };
        this.applyRect(win);
        continue;
      }
      win.rect.width = Math.min(win.rect.width, work.width);
      win.rect.height = Math.min(win.rect.height, work.height);
      win.rect.x = clamp(win.rect.x, -win.rect.width + MIN_VISIBLE, Math.max(0, work.width - MIN_VISIBLE));
      win.rect.y = clamp(win.rect.y, 0, Math.max(0, work.height - 42));
      this.applyRect(win);
    }
    this.persist();
  }

  /* ----------------------------------------------------------- persistence */
  snapshot() {
    return [...this.windows.values()]
      .sort((a, b) => a.z - b.z)
      .map((win) => ({
        appId: win.appId,
        title: win.title,
        args: win.args,
        rect: { ...win.rect },
        minimized: win.minimized,
        maximized: win.maximized,
        z: win.z,
      }));
  }

  persist() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now(), windows: this.snapshot() }));
    } catch {
      /* session storage is best-effort */
    }
  }

  restoreSession(maxAge = 12 * 60 * 60 * 1000) {
    let data = null;
    try {
      data = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      data = null;
    }
    if (!data?.windows?.length || Date.now() - data.ts > maxAge) return 0;
    let restored = 0;
    for (const entry of data.windows) {
      if (!getApp(entry.appId)) continue;
      this.open(entry.appId, {
        args: entry.args,
        rect: entry.rect,
        minimized: entry.minimized,
        maximized: entry.maximized,
        title: entry.title,
      });
      restored += 1;
    }
    return restored;
  }

  closeAll() {
    for (const win of [...this.windows.values()]) this.close(win.id);
  }
}

