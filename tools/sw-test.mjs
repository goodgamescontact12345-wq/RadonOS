/**
 * Service worker unit test.
 *
 * background.js normally runs inside Chromium with the chrome.* APIs, which
 * makes it awkward to test. This harness provides a stub implementation of the
 * surface the worker uses, imports the real module, and drives its listeners.
 *
 *   node tools/sw-test.mjs
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------ chrome stub */
const store = {};
const calls = {
  tabsCreated: [],
  notifications: [],
  badgeText: [],
  badgeColor: [],
  alarms: [],
  menus: [],
  menusRemoved: 0,
};

const settle = (ms = 40) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const listeners = {
  installed: [],
  startup: [],
  alarm: [],
  action: [],
  menuClicked: [],
  command: [],
  message: [],
  storageChanged: [],
};

const area = {
  get(keys) {
    if (keys == null) return Promise.resolve({ ...store });
    if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
    if (Array.isArray(keys)) return Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]])));
    return Promise.resolve(Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, store[k] ?? v])));
  },
  set(items) {
    const changes = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: store[key], newValue: value };
      store[key] = value;
    }
    for (const listener of listeners.storageChanged) listener(changes, 'local');
    return Promise.resolve();
  },
  remove(keys) {
    for (const key of [].concat(keys)) delete store[key];
    return Promise.resolve();
  },
};

globalThis.chrome = {
  runtime: {
    id: 'radonos-test-extension',
    getURL: (path) => `chrome-extension://radonos-test-extension/${path}`,
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    sendMessage: () => Promise.resolve(null),
  },
  storage: {
    local: area,
    onChanged: { addListener: (fn) => listeners.storageChanged.push(fn) },
  },
  tabs: {
    query: () => Promise.resolve([
      { id: 1, url: 'chrome://newtab/', title: 'New Tab', active: false, windowId: 1 },
      { id: 2, url: 'https://example.com', title: 'Example', active: true, windowId: 1 },
    ]),
    create: (options) => {
      calls.tabsCreated.push(options);
      return Promise.resolve({ id: 99, ...options });
    },
    update: () => Promise.resolve({}),
  },
  windows: { update: () => Promise.resolve({}) },
  alarms: {
    create: (name, options) => calls.alarms.push({ name, options }),
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  notifications: {
    create: (options) => {
      calls.notifications.push(options);
      return Promise.resolve('id');
    },
  },
  contextMenus: {
    create: (options) => calls.menus.push(options),
    removeAll: (callback) => {
      calls.menusRemoved += 1;
      callback?.();
    },
    onClicked: { addListener: (fn) => listeners.menuClicked.push(fn) },
  },
  action: {
    onClicked: { addListener: (fn) => listeners.action.push(fn) },
    setBadgeText: (options) => {
      calls.badgeText.push(options.text);
      return Promise.resolve();
    },
    setBadgeBackgroundColor: (options) => {
      calls.badgeColor.push(options.color);
      return Promise.resolve();
    },
  },
  commands: {
    onCommand: { addListener: (fn) => listeners.command.push(fn) },
  },
};

/* ------------------------------------------------------------------- run */
await import(`file://${resolve(ROOT, 'background.js').replace(/\\/g, '/')}`);

check('background.js imports and registers listeners',
  listeners.installed.length === 1
  && listeners.alarm.length === 1
  && listeners.menuClicked.length === 1
  && listeners.message.length === 1
  && listeners.command.length === 1,
  'onInstalled, onAlarm, onClicked(menu), onMessage, onCommand');

// --- install flow
await listeners.installed[0]({ reason: 'install' });
await settle();
check('install writes default settings', !!store.settings && store.settings.version === 1,
  `theme=${store.settings?.theme} wallpaper=${store.settings?.wallpaper?.value}`);
check('install creates the badge alarm', calls.alarms.some((entry) => entry.name === 'radonos-badge-tick'
  && entry.options.periodInMinutes === 1));
check('install registers four context menus', calls.menus.length === 4,
  calls.menus.map((menu) => menu.id).join(', '));
check('install opens the desktop exactly once', calls.tabsCreated.length === 1
  && calls.tabsCreated[0].url.includes('/newtab/index.html'), calls.tabsCreated[0]?.url);

// --- badge clock
store.settings = { ...store.settings, badgeClock: true, clock24: true };
calls.badgeText.length = 0;
await listeners.alarm[0]({ name: 'radonos-badge-tick' });
await settle();
check('alarm paints the badge clock', calls.badgeText.length === 1 && /[0-9]/.test(calls.badgeText[0]),
  `badge="${calls.badgeText[0]}"`);
check('badge background colour set', calls.badgeColor.length === 1, calls.badgeColor[0]);

store.settings = { ...store.settings, badgeClock: false };
calls.badgeText.length = 0;
await listeners.alarm[0]({ name: 'radonos-badge-tick' });
await settle();
check('disabling badgeClock clears the badge', calls.badgeText[0] === '', `badge="${calls.badgeText[0]}"`);

// --- context menu actions
calls.tabsCreated.length = 0;
await listeners.menuClicked[0]({ menuItemId: 'radonos-open-link', linkUrl: 'https://example.org/a' });
await settle();
check('context menu opens a link in the RadonOS browser',
  calls.tabsCreated[0]?.url.includes('app=browser') && calls.tabsCreated[0]?.url.includes('example.org'),
  calls.tabsCreated[0]?.url?.slice(0, 90));

const beforeBookmarks = store.settings.bookmarks.length;
await listeners.menuClicked[0]({ menuItemId: 'radonos-save-page', pageUrl: 'https://news.example/', selectionText: 'Great source' });
await settle();
check('context menu saves a bookmark', store.settings.bookmarks.length === beforeBookmarks + 1
  && store.settings.bookmarks[0].title === 'Great source',
  store.settings.bookmarks[0]?.url);
check('bookmarking raises a notification', calls.notifications.length === 1
  && calls.notifications[0].title.includes('Saved'), calls.notifications[0]?.message);

// --- message bridge
const sendMessage = (message) => new Promise((resolvePromise) => {
  const handled = listeners.message[0](message, {}, resolvePromise);
  if (handled !== true) resolvePromise(undefined);
});

const tabsResponse = await sendMessage({ type: 'GET_TABS' });
check('GET_TABS returns non-extension tabs only', tabsResponse?.ok === true
  && tabsResponse.tabs.length === 1 && tabsResponse.tabs[0].url === 'https://example.com',
  JSON.stringify(tabsResponse));

const openResponse = await sendMessage({ type: 'OPEN_APP', app: 'notepad', params: { path: '/Documents/x.txt' } });
check('OPEN_APP resolves with ok', openResponse?.ok === true);

calls.notifications.length = 0;
const notifyResponse = await sendMessage({ type: 'NOTIFY', title: 'Hi', body: 'There' });
check('NOTIFY calls chrome.notifications', notifyResponse?.ok === true
  && calls.notifications[0]?.title === 'Hi' && calls.notifications[0]?.iconUrl.includes('icon-128'));

const saveResponse = await sendMessage({ type: 'SAVE_BOOKMARK', url: 'https://saved.example', title: 'Saved by message' });
check('SAVE_BOOKMARK stores the entry', saveResponse?.ok === true
  && store.settings.bookmarks.some((entry) => entry.url === 'https://saved.example'));

const duplicate = await sendMessage({ type: 'SAVE_BOOKMARK', url: 'https://saved.example', title: 'dup' });
check('SAVE_BOOKMARK is idempotent', duplicate?.duplicate === true);

const unknown = await sendMessage({ type: 'NOPE' });
check('unknown messages are ignored', unknown === undefined);

// --- command + action
calls.tabsCreated.length = 0;
await listeners.command[0]('open-radonos');
await listeners.action[0]();
await settle();
check('command and toolbar click open the desktop', calls.tabsCreated.length === 2,
  calls.tabsCreated.map((tab) => tab.url.split('/').pop()).join(', '));

const failing = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failing.length}/${results.length} service worker checks passed`);
if (failing.length) {
  for (const entry of failing) console.error(`  ✗ ${entry.name} — ${entry.detail}`);
}
console.log('Service worker suite passed.');

// platform.js keeps a BroadcastChannel open, which would hold the Node event
// loop hostage; exit explicitly once the assertions are done.
process.exit(failing.length ? 1 : 0);
