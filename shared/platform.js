/**
 * Platform abstraction.
 *
 * Every chrome.* call in RadonOS funnels through this module. When the pages
 * are opened over http:// (the bundled dev server) or file://, we fall back to
 * localStorage + BroadcastChannel so the whole desktop remains testable and
 * the UI never has to branch on the host environment.
 */
const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export const isExtension = extension;

const STORE_KEY = 'radonos.storage';
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('radonos-storage')
  : null;
const localListeners = new Set();

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function pick(store, keys) {
  if (keys == null) return { ...store };
  if (typeof keys === 'string') return { [keys]: store[keys] };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, store[key]]));
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [key, store[key] ?? fallback]),
  );
}

export const storage = {
  async get(keys) {
    if (extension) return chrome.storage.local.get(keys);
    return pick(readStore(), keys);
  },

  async set(items) {
    if (extension) return chrome.storage.local.set(items);
    const store = { ...readStore(), ...items };
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    const changes = Object.fromEntries(
      Object.entries(items).map(([key, newValue]) => [key, { newValue }]),
    );
    channel?.postMessage({ type: 'storage', changes });
    for (const listener of localListeners) listener(changes, 'local');
    return undefined;
  },

  async remove(keys) {
    if (extension) return chrome.storage.local.remove(keys);
    const store = readStore();
    for (const key of [].concat(keys)) delete store[key];
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return undefined;
  },

  /** Subscribe to changes from this page, other tabs and iframes. */
  onChange(callback) {
    if (extension) {
      const handler = (changes, area) => {
        if (area === 'local') callback(changes, area);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    }
    localListeners.add(callback);
    const handler = (event) => {
      if (event.data?.type === 'storage') callback(event.data.changes, 'local');
    };
    channel?.addEventListener('message', handler);
    return () => {
      localListeners.delete(callback);
      channel?.removeEventListener('message', handler);
    };
  },
};

/**
 * Project root of the dev server, derived from the current page.
 * `/newtab/index.html` and `/apps/notepad/index.html` both resolve to `/`.
 */
function devRoot() {
  try {
    const { origin, pathname } = new URL(document.baseURI);
    const marker = pathname.search(/\/(newtab|apps|shared|icons|assets)\//);
    return `${origin}${marker > 0 ? pathname.slice(0, marker + 1) : '/'}`;
  } catch {
    return '/';
  }
}

export const runtime = {
  id: extension ? chrome.runtime.id : 'radonos-dev',
  getURL(path) {
    if (extension) return chrome.runtime.getURL(path);
    return new URL(String(path).replace(/^\.\//, ''), devRoot()).toString();
  },
  async send(message) {
    if (!extension) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  },
  openApp(app, params = {}) {
    if (extension) return runtime.send({ type: 'OPEN_APP', app, params });
    const url = new URL(runtime.getURL('newtab/index.html'));
    url.searchParams.set('app', app);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, value);
    }
    window.open(url.toString(), '_blank');
    return null;
  },
};

export const tabs = {
  async query() {
    if (!extension) return [];
    try {
      return await chrome.tabs.query({});
    } catch {
      return [];
    }
  },
  async open(url) {
    if (!extension) {
      window.open(url, '_blank', 'noopener');
      return null;
    }
    try {
      return await chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank', 'noopener');
      return null;
    }
  },
  async search(term) {
    const list = await tabs.query();
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return list
      .filter((tab) => (tab.title || '').toLowerCase().includes(needle)
        || (tab.url || '').toLowerCase().includes(needle))
      .slice(0, 6);
  },
};

export async function notifySystem(title, body) {
  if (!extension) return;
  await runtime.send({ type: 'NOTIFY', title, body });
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
