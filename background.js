/**
 * RadonOS service worker.
 *
 * Responsibilities that must outlive a tab:
 *  - installation defaults + context menus + commands
 *  - optional taskbar badge clock (alarm driven)
 *  - OS-level notifications and link hand-off to the desktop tab
 *  - a tiny message bridge for the new tab page
 */
import { DEFAULT_SETTINGS } from './shared/settings.js';

const NEWTAB_PATH = 'newtab/index.html';
const BADGE_ALARM = 'radonos-badge-tick';
const ICON = 'icons/icon-128.png';

const newtabUrl = (params = {}) => {
  const url = new URL(chrome.runtime.getURL(NEWTAB_PATH));
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function openDesktop(params) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.endsWith('/newtab/index.html'));
  if (existing && !Object.keys(params).length) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: newtabUrl(params) });
}

async function updateBadge() {
  const settings = await getSettings();
  if (!settings.badgeClock) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const now = new Date();
  const text = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !settings.clock24,
  });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#5b9dff' });
}

async function saveBookmark(url, title) {
  if (!url) return { ok: false };
  const settings = await getSettings();
  const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
  if (bookmarks.some((b) => b.url === url)) return { ok: true, duplicate: true };
  bookmarks.unshift({
    id: crypto.randomUUID(),
    title: (title || url).slice(0, 80),
    url,
  });
  await chrome.storage.local.set({
    settings: { ...settings, bookmarks: bookmarks.slice(0, 40) },
  });
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, installedAt: Date.now() },
    });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'radonos-open-link',
      title: 'Open link in RadonOS',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'radonos-save-link',
      title: 'Save link to RadonOS bookmarks',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'radonos-save-page',
      title: 'Save page to RadonOS bookmarks',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'radonos-open',
      title: 'Open RadonOS',
      contexts: ['page', 'action'],
    });
  });

  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  if (details.reason === 'install') {
    await openDesktop();
  }
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  void updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void updateBadge();
});

chrome.action.onClicked.addListener(() => {
  void openDesktop();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-radonos') void openDesktop();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'radonos-open-link' && info.linkUrl) {
    await openDesktop({ app: 'browser', url: info.linkUrl });
  }
  if (info.menuItemId === 'radonos-save-link' && info.linkUrl) {
    const res = await saveBookmark(info.linkUrl, info.selectionText);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON,
      title: res.duplicate ? 'Already bookmarked' : 'Saved to RadonOS',
      message: info.linkUrl.slice(0, 120),
      silent: true,
    });
  }
  if (info.menuItemId === 'radonos-save-page' && info.pageUrl) {
    await saveBookmark(info.pageUrl, info.selectionText || 'Saved page');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON,
      title: 'Saved to RadonOS',
      message: (info.pageUrl || '').slice(0, 120),
      silent: true,
    });
  }
  if (info.menuItemId === 'radonos-open') {
    await openDesktop();
  }
});

/* ------------------------------------------------------ linked page windows */
/**
 * Pages RadonOS is not allowed to frame (X-Frame-Options / CSP frame-ancestors)
 * run in a popup window that is linked to the RadonOS window they came from:
 * the new tab page keeps it at the same size and place, and closes it with the
 * window.
 *
 * `linkedWindows` maps the renderer's key (one per RadonOS window) to the chrome
 * window id. It only lives as long as this worker; if Chrome stops the worker
 * the next request relocates the popup by URL instead of opening a second one.
 */
const linkedWindows = new Map();

function linkBounds(message) {
  return {
    width: Math.max(320, Math.round(Number(message.width) || 900)),
    height: Math.max(240, Math.round(Number(message.height) || 640)),
    left: Math.round(Number(message.left) || 0),
    top: Math.round(Number(message.top) || 0),
  };
}

async function findLinkedWindow(url) {
  if (!chrome.windows?.getAll || !url) return null;
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.find((win) => win.type === 'popup'
    && (win.tabs || []).some((tab) => tab.url === url)) || null;
}

async function openLinkedWindow(message) {
  const key = String(message.key || message.url || 'radonos');
  const url = String(message.url || 'about:blank');
  const bounds = linkBounds(message);

  let existing = null;
  const known = linkedWindows.get(key);
  if (known != null && chrome.windows.get) existing = await chrome.windows.get(known).catch(() => null);
  if (!existing) existing = await findLinkedWindow(url);

  if (existing?.id != null) {
    linkedWindows.set(key, existing.id);
    await chrome.windows.update(existing.id, { ...bounds, focused: true });
    const [tab] = await chrome.tabs.query({ windowId: existing.id });
    if (tab && tab.url !== url) await chrome.tabs.update(tab.id, { url });
    return { ok: true, windowId: existing.id, reused: true };
  }

  const created = await chrome.windows.create({ url, type: 'popup', ...bounds, focused: true });
  linkedWindows.set(key, created.id);
  return { ok: true, windowId: created.id, reused: false };
}

async function updateLinkedWindow(message) {
  const key = String(message.key || message.url || 'radonos');
  let id = linkedWindows.get(key);
  if (id == null) {
    const found = await findLinkedWindow(message.url);
    if (!found) return { ok: false, missing: true };
    id = found.id;
    linkedWindows.set(key, id);
  }
  await chrome.windows.update(id, {
    ...linkBounds(message),
    ...(message.focused ? { focused: true } : {}),
  });
  return { ok: true, windowId: id };
}

async function closeLinkedWindow(message) {
  const key = String(message.key || message.url || 'radonos');
  let id = linkedWindows.get(key);
  if (id == null) id = (await findLinkedWindow(message.url))?.id;
  linkedWindows.delete(key);
  if (id == null) return { ok: true, missing: true };
  await chrome.windows.remove(id).catch(() => {});
  return { ok: true };
}

chrome.windows?.onRemoved?.addListener?.((windowId) => {
  for (const [key, id] of linkedWindows) {
    if (id !== windowId) continue;
    linkedWindows.delete(key);
    // The RadonOS window that owns this popup can update its panel immediately.
    chrome.runtime.sendMessage({ type: 'LINKED_WINDOW_REMOVED', key }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type } = message || {};

  if (type === 'OPEN_APP') {
    openDesktop({ app: message.app, ...(message.params || {}) })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'OPEN_URL') {
    chrome.tabs.create({ url: message.url })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'NOTIFY') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON,
      title: message.title || 'RadonOS',
      message: message.body || '',
      silent: !!message.silent,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'SAVE_BOOKMARK') {
    saveBookmark(message.url, message.title)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'GET_TABS') {
    chrome.tabs.query({})
      .then((tabs) => sendResponse({
        ok: true,
        tabs: tabs
          .filter((t) => t.url && !/^(chrome|edge|about|devtools|view-source|chrome-extension):/i.test(t.url))
          .map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
      }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'LINKED_WINDOW_OPEN') {
    openLinkedWindow(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'LINKED_WINDOW_UPDATE') {
    updateLinkedWindow(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'LINKED_WINDOW_CLOSE') {
    closeLinkedWindow(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (type === 'SET_BADGE') {
    chrome.action.setBadgeText({ text: message.text || '' });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
