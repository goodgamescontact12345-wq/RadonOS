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

  if (type === 'SET_BADGE') {
    chrome.action.setBadgeText({ text: message.text || '' });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
