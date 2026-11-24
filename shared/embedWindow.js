/**
 * Linked browser windows for pages that refuse to be framed.
 *
 * RadonOS can only draw a page it is allowed to frame. When a site answers with
 * `X-Frame-Options` or a CSP `frame-ancestors` directive there is nothing the
 * desktop can do about it, so the page runs in its own browser window. Instead
 * of an unrelated tab, that window is *linked* to the RadonOS window it came
 * from: it opens at the same size and position, follows every resize and move,
 * and closes with the window.
 *
 * Two backends, because a popup stopped being measurable or resizable from
 * script as soon as it navigated to another origin:
 *   - extension builds ask background.js for a real popup through
 *     `chrome.windows`, which keeps resizing it at any time;
 *   - the hosted/dev build falls back to `window.open`, which can place and
 *     resize a script-opened popup only while it is still same-origin.
 */
import { isExtension, runtime } from './platform.js';
import { windowId } from './ui.js';

const POLL_MS = 150; // how often the RadonOS window rectangle is re-read
const SEND_MS = 120; // minimum gap between chrome.windows.update calls
const REOPEN_MS = 500; // settle time before re-targeting a cross-origin popup
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

const sameBounds = (a, b) => !!a && !!b
  && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function desktopHost() {
  return window.parent && window.parent !== window ? window.parent : null;
}

/** The RadonOS window that owns this document, or null when opened standalone. */
export function ownerWindow() {
  const host = desktopHost();
  const api = host?.RadonOS;
  const id = windowId();
  if (!api || !id) return null;
  const manager = api.wm || api.windows;
  return typeof manager?.find === 'function' ? manager.find(id) : null;
}

/** Rectangle of the owning RadonOS window, falling back to this document. */
export function ownerBounds() {
  const rect = ownerWindow()?.rect;
  if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
    return {
      x: Math.round(Number(rect.x) || 0),
      y: Math.round(Number(rect.y) || 0),
      width: Math.round(Number(rect.width)),
      height: Math.round(Number(rect.height)),
    };
  }
  return { x: 0, y: 0, width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) };
}

/**
 * Screen rectangle for the linked window: the RadonOS window's size and place.
 * The desktop document starts inside the browser frame, so the surrounding
 * chrome is added before the window-relative rectangle becomes screen pixels.
 */
export function screenBounds(bounds = ownerBounds()) {
  const owner = desktopHost() || window;
  const innerWidth = Number(owner.innerWidth) || window.innerWidth;
  const innerHeight = Number(owner.innerHeight) || window.innerHeight;
  const frameX = Math.max(0, Math.round(((Number(owner.outerWidth) || innerWidth) - innerWidth) / 2));
  const frameY = Math.max(0, Math.round(((Number(owner.outerHeight) || innerHeight) - innerHeight) / 2));
  return {
    left: Math.round((Number(owner.screenX) || 0) + frameX + bounds.x),
    top: Math.round((Number(owner.screenY) || 0) + frameY + bounds.y),
    width: Math.max(MIN_WIDTH, bounds.width),
    height: Math.max(MIN_HEIGHT, bounds.height),
  };
}

/**
 * A browser window that mirrors one RadonOS window.
 * Emits `change` with `{ open, url, mode, bounds }` whenever any of them move.
 */
export class LinkedWindow extends EventTarget {
  constructor({ key = null } = {}) {
    super();
    this.key = key || `radonos-linked:${windowId() || 'standalone'}`;
    this.mode = isExtension && typeof runtime.send === 'function' ? 'native' : 'popup';
    this.url = null;
    this.opened = false;
    this.bounds = screenBounds();
    this.popup = null;
    this.timer = null;
    this.sendTimer = null;
    this.reopenTimer = null;
    this.lastSent = 0;
    this.lastOwner = null;
    this.signature = '';
    this.onUnload = () => this.close();
    // The service worker broadcasts when a chrome popup window disappears, so
    // the RadonOS panel can stop claiming it is open without polling.
    this.unsubscribe = isExtension && typeof runtime.onMessage === 'function'
      ? runtime.onMessage((message) => {
        if (message?.type !== 'LINKED_WINDOW_REMOVED' || message.key !== this.key) return;
        this.opened = false;
        this.emitState();
      })
      : null;
  }

  get isOpen() {
    if (this.mode === 'popup') return !!this.popup && !this.popup.closed;
    return this.opened;
  }

  get state() {
    return { open: this.isOpen, url: this.url, mode: this.mode, bounds: { ...this.bounds } };
  }

  /* --------------------------------------------------------------- actions */
  /** Show `url` in the linked window, creating it (or reusing it) as needed. */
  open(url) {
    if (!url) return false;
    this.url = url;
    this.bounds = screenBounds(ownerBounds());
    clearTimeout(this.reopenTimer);

    if (this.mode === 'native') {
      this.opened = true;
      void this.send({
        type: 'LINKED_WINDOW_OPEN',
        key: this.key,
        url,
        ...this.bounds,
      }).then((result) => {
        if (result?.ok) return;
        // No service worker handler (older install) or chrome.windows refused:
        // fall back to a script-opened popup. That needs a user gesture, so the
        // panel's button remains the reliable way in.
        this.mode = 'popup';
        this.opened = false;
        this.popup = this.openPopup();
        this.emitState();
      });
    } else {
      this.popup = this.openPopup();
    }

    this.watch();
    this.emitState();
    return this.isOpen;
  }

  /** Raise the linked window, reopening it when the user has closed it. */
  focus() {
    if (!this.isOpen) return false;
    if (this.mode === 'native') {
      void this.send({
        type: 'LINKED_WINDOW_UPDATE',
        key: this.key,
        url: this.url,
        focused: true,
        ...this.bounds,
      }).then((result) => {
        if (result?.ok !== false) return;
        // The popup is gone: reopen it instead of raising nothing.
        this.opened = false;
        if (this.url) this.open(this.url);
        else this.emitState();
      });
      return true;
    }
    try {
      this.popup?.focus();
      return true;
    } catch {
      return false;
    }
  }

  /** Close the linked window and stop tracking. */
  close({ keepUrl = false } = {}) {
    clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this.sendTimer);
    this.sendTimer = null;
    clearTimeout(this.reopenTimer);
    this.reopenTimer = null;
    window.removeEventListener('pagehide', this.onUnload);
    window.removeEventListener('unload', this.onUnload);

    if (this.mode === 'native' && (this.opened || this.url)) {
      void this.send({ type: 'LINKED_WINDOW_CLOSE', key: this.key, url: this.url });
    }
    try {
      this.popup?.close();
    } catch {
      /* already gone */
    }
    this.popup = null;
    this.opened = false;
    this.lastOwner = null;
    if (!keepUrl) this.url = null;
    this.emitState();
  }

  /* -------------------------------------------------------------- tracking */
  watch() {
    this.lastOwner = ownerBounds();
    if (!this.timer) this.timer = setInterval(() => this.sync(), POLL_MS);
    window.addEventListener('pagehide', this.onUnload);
    window.addEventListener('unload', this.onUnload);
  }

  /** Follow the RadonOS window. Cheap: the rect is a plain object, not layout. */
  sync() {
    if (!ownerWindow()) {
      // The window this popup belongs to is gone.
      this.close();
      return;
    }
    const owner = ownerBounds();
    if (!sameBounds(owner, this.lastOwner)) {
      this.lastOwner = owner;
      this.bounds = screenBounds(owner);
      this.applyBounds();
    }
    this.emitState();
  }

  applyBounds() {
    if (!this.isOpen) return;
    if (this.mode === 'native') {
      this.throttle({
        type: 'LINKED_WINDOW_UPDATE',
        key: this.key,
        url: this.url,
        ...this.bounds,
      });
      return;
    }
    const popup = this.popup;
    if (!popup || popup.closed) return;
    try {
      popup.moveTo(this.bounds.left, this.bounds.top);
      popup.resizeTo(this.bounds.width, this.bounds.height);
    } catch {
      // Cross-origin: the popup can no longer be resized from script. Re-targeting
      // the same named window with new features is the only way left to make it
      // follow, and it re-navigates, so wait for the desktop to settle first.
      this.scheduleReopen();
    }
  }

  /* ------------------------------------------------------------- internals */
  openPopup() {
    const current = this.popup && !this.popup.closed ? this.popup : null;
    if (current) {
      // Same window, different page: `location` is the one property that stays
      // writable once the popup has crossed origins.
      try {
        current.location.href = this.url;
        current.focus?.();
        return current;
      } catch {
        /* fall through and try a fresh window */
      }
    }
    let popup = null;
    try {
      popup = window.open(this.url, this.key, this.popupFeatures());
    } catch {
      popup = null;
    }
    if (!popup || popup.closed) return null;
    try {
      popup.focus();
    } catch {
      /* focusing is best-effort */
    }
    return popup;
  }

  popupFeatures(bounds = this.bounds) {
    return [
      'popup=yes',
      'resizable=yes',
      'scrollbars=yes',
      `width=${bounds.width}`,
      `height=${bounds.height}`,
      `left=${bounds.left}`,
      `top=${bounds.top}`,
    ].join(',');
  }

  scheduleReopen() {
    clearTimeout(this.reopenTimer);
    this.reopenTimer = setTimeout(() => {
      if (this.mode !== 'popup' || !this.url) return;
      const popup = this.openPopup();
      if (popup) this.popup = popup;
      this.emitState();
    }, REOPEN_MS);
  }

  throttle(message) {
    clearTimeout(this.sendTimer);
    const flush = () => {
      this.lastSent = Date.now();
      void this.send(message).then((result) => {
        // chrome.windows no longer knows the popup (the user closed it, or the
        // worker restarted): say so instead of pretending it is up to date.
        if (result?.ok !== false || !this.opened) return;
        this.opened = false;
        this.emitState();
      });
    };
    const wait = SEND_MS - (Date.now() - this.lastSent);
    if (wait <= 0) flush();
    else this.sendTimer = setTimeout(flush, wait);
  }

  async send(message) {
    if (!isExtension || typeof runtime.send !== 'function') return null;
    return runtime.send(message);
  }

  emitState() {
    const state = this.state;
    const signature = [
      state.open,
      state.mode,
      state.url,
      state.bounds.width,
      state.bounds.height,
      state.bounds.left,
      state.bounds.top,
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.dispatchEvent(new CustomEvent('change', { detail: state }));
  }
}
