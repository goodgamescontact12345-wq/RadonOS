/**
 * Platform abstraction test.
 *
 * platform.js has two branches: real chrome.* APIs inside the extension, and a
 * localStorage + BroadcastChannel shim for the http dev server. Both are
 * exercised here with stubs, because a regression in either silently breaks
 * settings, tabs or notifications.
 *
 *   node tools/platform-test.mjs
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_URL = pathToFileURL(resolve(ROOT, 'shared', 'platform.js')).href;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const settle = (ms = 30) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/* =========================================================== extension path */
const chromeStore = {};
const storageListeners = [];
const sentMessages = [];
const openedTabs = [];

globalThis.chrome = {
  runtime: {
    id: 'radonos-platform-test',
    getURL: (path) => `chrome-extension://radonos-platform-test/${path}`,
    sendMessage: (message) => {
      sentMessages.push(message);
      return Promise.resolve({ ok: true, echo: message.type });
    },
  },
  storage: {
    local: {
      get: (keys) => Promise.resolve(
        typeof keys === 'string' ? { [keys]: chromeStore[keys] } : { ...chromeStore },
      ),
      set: (items) => {
        Object.assign(chromeStore, items);
        for (const listener of storageListeners) {
          listener(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])), 'local');
        }
        return Promise.resolve();
      },
      remove: (keys) => {
        for (const key of [].concat(keys)) delete chromeStore[key];
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: (fn) => storageListeners.push(fn),
      removeListener: (fn) => {
        const index = storageListeners.indexOf(fn);
        if (index >= 0) storageListeners.splice(index, 1);
      },
    },
  },
  tabs: {
    query: () => Promise.resolve([
      { id: 1, url: 'chrome-extension://radonos-platform-test/newtab/index.html', title: 'RadonOS' },
      { id: 2, url: 'https://example.com/docs', title: 'Example Docs' },
      { id: 3, url: 'chrome://settings', title: 'Settings' },
    ]),
    create: (options) => {
      openedTabs.push(options);
      return Promise.resolve({ id: 4, ...options });
    },
  },
};

globalThis.window = { open: () => { throw new Error('window.open should not be used in extension mode'); } };
globalThis.document = { baseURI: 'chrome-extension://radonos-platform-test/newtab/index.html' };

const platform = await import(MODULE_URL);

check('detects the extension runtime', platform.isExtension === true);
check('runtime.getURL delegates to chrome', platform.runtime.getURL('newtab/index.html')
  === 'chrome-extension://radonos-platform-test/newtab/index.html');

await platform.storage.set({ settings: { theme: 'dark' } });
const readBack = await platform.storage.get('settings');
check('storage.set/get round-trips through chrome.storage.local',
  readBack.settings.theme === 'dark', JSON.stringify(readBack));

let observed = null;
const unsubscribe = platform.storage.onChange((changes) => { observed = changes; });
await platform.storage.set({ accent: '#ff0000' });
await settle();
check('storage.onChange fires for chrome.storage.onChanged', !!observed?.accent,
  JSON.stringify(observed));
unsubscribe();
observed = null;
await platform.storage.set({ accent: '#00ff00' });
check('unsubscribing stops change notifications', observed === null);

const tabs = await platform.tabs.query();
check('tabs.query returns what Chrome reports', tabs.length === 3);
const pathTabs = await platform.tabs.query();
const extensionTabs = pathTabs.filter((tab) => tab.url.startsWith('chrome-extension://'));
check('tabs.query passes through raw tab records', extensionTabs.length === 1);
const search = await platform.tabs.search('example');
check('tabs.search matches titles and URLs', search.length === 1 && search[0].title === 'Example Docs',
  search.map((tab) => tab.title).join(', '));

await platform.tabs.open('https://radon.example/');
check('tabs.open creates a tab via chrome.tabs', openedTabs.length === 1
  && openedTabs[0].url === 'https://radon.example/');

await platform.notifySystem('Title', 'Body');
check('notifySystem sends a NOTIFY runtime message',
  sentMessages.at(-1)?.type === 'NOTIFY' && sentMessages.at(-1)?.body === 'Body');

const opened = await platform.runtime.openApp('notepad', { path: '/Documents/a.txt' });
check('runtime.openApp asks the service worker to open a window',
  sentMessages.at(-1)?.type === 'OPEN_APP' && sentMessages.at(-1)?.app === 'notepad'
  && opened?.ok === true);

/* ============================================================ fallback path */
delete globalThis.chrome;

const backing = new Map();
globalThis.localStorage = {
  getItem: (key) => (backing.has(key) ? backing.get(key) : null),
  setItem: (key, value) => backing.set(key, String(value)),
  removeItem: (key) => backing.delete(key),
};
const windowOpens = [];
globalThis.window = { open: (url) => { windowOpens.push(url); return null; } };
globalThis.document = { baseURI: 'http://127.0.0.1:4173/newtab/index.html' };

const fallback = await import(`${MODULE_URL}?fallback`);

check('detects the dev fallback when chrome is absent', fallback.isExtension === false);
check('fallback getURL resolves relative to the page',
  fallback.runtime.getURL('shared/base.css') === 'http://127.0.0.1:4173/shared/base.css',
  fallback.runtime.getURL('shared/base.css'));

await fallback.storage.set({ settings: { theme: 'light' } });
const fallbackRead = await fallback.storage.get('settings');
check('fallback storage writes to localStorage', fallbackRead.settings.theme === 'light'
  && backing.has('radonos.storage'));

await fallback.storage.set({ settings: { theme: 'auto' } });
const merged = await fallback.storage.get('settings');
check('fallback storage merges subsequent writes', merged.settings.theme === 'auto');

let fallbackObserved = null;
const stop = fallback.storage.onChange((changes) => { fallbackObserved = changes; });
await fallback.storage.set({ other: 1 });
await settle(80);
check('fallback onChange notifies local subscribers', !!fallbackObserved?.other,
  JSON.stringify(fallbackObserved));
stop();

const fallbackTabs = await fallback.tabs.query();
check('fallback tabs.query reports no tabs instead of throwing', fallbackTabs.length === 0);
await fallback.tabs.open('https://dev.example/');
check('fallback tabs.open uses window.open', windowOpens.length === 1
  && windowOpens[0] === 'https://dev.example/');

const fallbackSend = await fallback.runtime.send({ type: 'PING' });
check('fallback runtime.send resolves to null (no service worker)', fallbackSend === null);

fallback.runtime.openApp('terminal', {});
check('fallback openApp opens the dev-server URL', windowOpens.at(-1)?.includes('newtab/index.html?app=terminal'),
  windowOpens.at(-1));

const failing = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failing.length}/${results.length} platform checks passed`);
if (failing.length) {
  for (const entry of failing) console.error(`  ✗ ${entry.name} — ${entry.detail}`);
}
process.exit(failing.length ? 1 : 0);
