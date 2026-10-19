import { storage } from './platform.js';

/**
 * Settings are the single source of truth for the OS shell and every app.
 * They live in chrome.storage.local so the service worker, the desktop and
 * every app iframe read and write the same values.
 */
export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  version: 1,
  installedAt: null,
  theme: 'dark', // dark | light | auto
  palette: 'midnight', // midnight | lavender | sage | peach
  accent: '#5b9dff',
  glass: {
    enabled: true,
    blur: 26, // px, applied to every translucent surface
    saturation: 1.35, // backdrop saturation multiplier
  },
  dock: 'bottom', // bottom | top
  dockAlign: 'center', // start | center | end (running-app strip)
  brightness: 1, // 0.35 - 1, rendered as an overlay on the desktop
  packages: [], // ids installed through `radonpkg`
  wallpaper: {
    type: 'preset', // preset | url | image | color
    value: 'aurora',
    dim: 0.22,
    blur: 0,
  },
  widgets: {
    weather: true,
    notes: true,
    bookmarks: true,
    monitor: true,
  },
  iconLabels: true,
  iconSize: 84,
  iconOrder: ['explorer', 'notepad', 'terminal', 'browser', 'media', 'settings'],
  shortcuts: [],
  clock24: true,
  showSeconds: false,
  bootAnimation: false,
  reduceMotion: false,
  badgeClock: false,
  sounds: true,
  volume: 0.45,
  userName: 'Radon User',
  weatherCity: 'Amsterdam',
  weatherUnit: 'c',
  stickyNote: 'Double-click a desktop icon to launch an app.\nRight-click the desktop for more options.',
  bookmarks: [
    { id: 'bm-photopea', title: 'Photopea', url: 'https://www.photopea.com' },
    { id: 'bm-excalidraw', title: 'Excalidraw', url: 'https://excalidraw.com' },
    { id: 'bm-wiki', title: 'Wikipedia', url: 'https://wikipedia.org' },
    { id: 'bm-spotify', title: 'Spotify Web', url: 'https://open.spotify.com' },
  ],
};

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}

let cache = null;
let loading = null;
const listeners = new Set();

function emit(next) {
  for (const listener of listeners) listener(next);
}

function normalize(value) {
  return deepMerge(DEFAULT_SETTINGS, value || {});
}

/** Load (once) and return a frozen-in-time snapshot of the settings. */
export async function loadSettings() {
  if (cache) return cache;
  if (!loading) {
    loading = storage.get(SETTINGS_KEY).then((res) => {
      cache = normalize(res?.[SETTINGS_KEY]);
      return cache;
    });
  }
  return loading;
}

export function getSettings() {
  return cache || normalize({});
}

/** Shallow-patch settings and persist them. Nested objects merge deeply. */
export async function updateSettings(patch) {
  const current = await loadSettings();
  const next = deepMerge(current, patch);
  cache = next;
  emit(next);
  try {
    await storage.set({ [SETTINGS_KEY]: next });
  } catch (err) {
    console.warn('[RadonOS] Could not persist settings', err);
  }
  return next;
}

export async function replaceSettings(value) {
  const next = normalize(value);
  cache = next;
  emit(next);
  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings() {
  const next = normalize({ installedAt: getSettings().installedAt });
  cache = next;
  emit(next);
  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Subscribe to local and cross-page changes. Returns an unsubscribe fn. */
export async function onSettingsChange(callback) {
  await loadSettings();
  listeners.add(callback);
  const unsub = storage.onChange((changes) => {
    if (!changes[SETTINGS_KEY]) return;
    cache = normalize(changes[SETTINGS_KEY].newValue);
    emit(cache);
  });
  return () => {
    listeners.delete(callback);
    unsub();
  };
}
