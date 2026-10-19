import { getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { icon } from '../shared/icons.js';
import { promptDialog, toast, escapeHtml, debounce, formatBytes } from '../shared/ui.js';
import * as FS from '../shared/fs.js';

const WEATHER_KEY = 'radonos:weather-cache';
const WEATHER_TTL = 30 * 60 * 1000;

const CODES = [
  [[0], 'Clear sky', '☀️'],
  [[1, 2], 'Partly cloudy', '🌤️'],
  [[3], 'Overcast', '☁️'],
  [[45, 48], 'Foggy', '🌫️'],
  [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'],
  [[61, 63, 65, 66, 67], 'Rain', '🌧️'],
  [[71, 73, 75, 77], 'Snow', '❄️'],
  [[80, 81, 82], 'Showers', '🌧️'],
  [[85, 86], 'Snow showers', '🌨️'],
  [[95, 96, 99], 'Thunderstorm', '⛈️'],
];

function describeCode(code) {
  const match = CODES.find(([codes]) => codes.includes(Number(code)));
  return match ? { label: match[1], emoji: match[2] } : { label: 'Unknown', emoji: '🌡️' };
}

function demoWeather(city, unit) {
  const day = new Date().getDate();
  const baseC = 11 + Math.round(6 * Math.sin((day / 30) * Math.PI * 2));
  const toUnit = (c) => (unit === 'f' ? Math.round((c * 9) / 5 + 32) : c);
  const code = [0, 2, 3, 61][day % 4];
  const days = Array.from({ length: 4 }, (_, index) => {
    const offset = index - 1;
    const date = new Date(Date.now() + offset * 86400000);
    const temp = baseC + ((day + index * 3) % 7) - 3;
    return {
      label: index === 0 ? 'Now' : date.toLocaleDateString(undefined, { weekday: 'short' }),
      code: [0, 2, 3, 61, 80][(day + index) % 5],
      min: toUnit(temp - 4),
      max: toUnit(temp + 3),
    };
  });
  return {
    city,
    unit,
    temp: toUnit(baseC),
    code,
    humidity: 58 + (day % 18),
    wind: 6 + (day % 9),
    days,
    demo: true,
  };
}

async function fetchWeather(city, unit) {
  const cache = readCache(city, unit);
  if (cache) return cache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      { signal: controller.signal },
    ).then((res) => res.json());
    const place = geo?.results?.[0];
    if (!place) throw new Error('City not found');

    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      forecast_days: '4',
      timezone: 'auto',
      temperature_unit: unit === 'f' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: 'kmh',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    const data = await res.json();
    const result = {
      city: place.name,
      region: place.country_code || '',
      unit,
      temp: Math.round(data.current.temperature_2m),
      code: data.current.weather_code,
      humidity: Math.round(data.current.relative_humidity_2m),
      wind: Math.round(data.current.wind_speed_10m),
      days: (data.daily?.time || []).slice(0, 4).map((iso, index) => ({
        label: index === 0 ? 'Now' : new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }),
        code: data.daily.weather_code[index],
        min: Math.round(data.daily.temperature_2m_min[index]),
        max: Math.round(data.daily.temperature_2m_max[index]),
      })),
      demo: false,
    };
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ at: Date.now(), city, unit, data: result }));
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(city, unit) {
  try {
    const cache = JSON.parse(localStorage.getItem(WEATHER_KEY) || 'null');
    if (cache && cache.city === city && cache.unit === unit && Date.now() - cache.at < WEATHER_TTL) {
      return cache.data;
    }
  } catch { /* ignore */ }
  return null;
}

export function createWidgets({ wm }) {
  const host = document.getElementById('widgets');
  const docEl = document.documentElement;
  let monitorTimer = null;
  let weatherToken = 0;
  let relevantKey = '';

  const relevantSettings = () => {
    const settings = getSettings();
    return JSON.stringify([settings.widgets, settings.bookmarks, settings.weatherCity, settings.weatherUnit]);
  };

  function syncVisibility(settings) {
    const widgets = settings.widgets || {};
    const any = Object.values(widgets).some(Boolean);
    host.hidden = !any;
    docEl.style.setProperty('--widgets-w', any && window.innerWidth > 900 ? '326px' : '0px');
  }

  /* ------------------------------------------------------------- weather */
  function weatherWidget(settings) {
    const enabled = settings.widgets?.weather;
    if (!enabled) return null;
    const widget = document.createElement('section');
    widget.className = 'widget weather-widget';
    widget.innerHTML = `
      <div class="widget-head">
        <span>Weather</span>
        <button class="widget-link" data-action="weather-settings">Change</button>
      </div>
      <div class="weather-body">
        <div class="weather-main">
          <div class="weather-icon">🌤️</div>
          <div>
            <div class="weather-temp">--<sup>°</sup></div>
            <div class="weather-place">${escapeHtml(settings.weatherCity || 'Unknown')}</div>
          </div>
        </div>
        <div class="ros-hint" style="margin-top:8px">Fetching forecast…</div>
      </div>`;
    widget.querySelector('[data-action="weather-settings"]').addEventListener('click', () => {
      wm.open('settings', { args: { section: 'desktop' } });
    });
    hydrateWeather(widget, settings);
    return widget;
  }

  async function hydrateWeather(widget, settings) {
    const token = ++weatherToken;
    const city = settings.weatherCity || 'Amsterdam';
    const unit = settings.weatherUnit === 'f' ? 'f' : 'c';
    let data;
    try {
      data = await fetchWeather(city, unit);
    } catch (err) {
      console.warn('[RadonOS] Weather unavailable, using demo data', err);
      data = demoWeather(city, unit);
    }
    if (token !== weatherToken || !widget.isConnected) return;
    const body = widget.querySelector('.weather-body');
    if (!body) return;
    const current = describeCode(data.code);
    const symbol = data.unit === 'f' ? '°F' : '°C';
    const days = (data.days || []).slice(0, 4);

    body.innerHTML = `
      <div class="weather-main">
        <div class="weather-icon">${current.emoji}</div>
        <div style="min-width:0">
          <div class="weather-temp">${data.temp}<sup>${symbol}</sup></div>
          <div class="weather-place">${escapeHtml(data.city || city)}${data.region ? `, ${escapeHtml(data.region)}` : ''}</div>
          <div class="weather-desc">${current.label} · ${data.humidity}% · ${data.wind} km/h</div>
        </div>
      </div>
      <div class="weather-forecast">
        ${days.map((day) => `
          <div class="weather-day">
            <span>${escapeHtml(day.label)}</span>
            <span class="wic">${describeCode(day.code).emoji}</span>
            <b>${day.max}°</b>
            <span>${day.min}°</span>
          </div>`).join('')}
      </div>
      ${data.demo ? '<div class="weather-demo" style="margin-top:9px">Offline demo data · add a city in Settings</div>' : ''}`;
  }

  /* --------------------------------------------------------------- notes */
  function notesWidget(settings) {
    if (!settings.widgets?.notes) return null;
    const widget = document.createElement('section');
    widget.className = 'widget';
    const saved = debounce(async (value, state) => {
      await updateSettings({ stickyNote: value });
      state.textContent = 'Saved';
    }, 500);
    widget.innerHTML = `
      <div class="widget-head"><span>Sticky note</span><span class="widget-link" data-role="state">Saved</span></div>
      <textarea class="note-area" maxlength="4000" placeholder="Jot something down…">${escapeHtml(settings.stickyNote || '')}</textarea>
      <div class="note-meta"><span data-role="count">0 chars</span><span>Autosaved locally</span></div>`;
    const area = widget.querySelector('textarea');
    const count = widget.querySelector('[data-role="count"]');
    const state = widget.querySelector('[data-role="state"]');
    const refreshCount = () => { count.textContent = `${area.value.length} / 4000`; };
    refreshCount();
    area.addEventListener('input', () => {
      refreshCount();
      state.textContent = 'Saving…';
      saved(area.value, state);
    });
    return widget;
  }

  /* ----------------------------------------------------------- bookmarks */
  function bookmarksWidget(settings) {
    if (!settings.widgets?.bookmarks) return null;
    const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
    const widget = document.createElement('section');
    widget.className = 'widget';
    widget.innerHTML = `
      <div class="widget-head"><span>Bookmarks</span>
        <button class="widget-link" data-action="add">Add</button>
      </div>
      <div class="bm-list">
        ${bookmarks.slice(0, 6).map((bookmark) => `
          <button class="bm-item" data-url="${escapeHtml(bookmark.url)}" title="${escapeHtml(bookmark.url)}">
            <span class="bm-favicon">${escapeHtml((bookmark.title || '?').slice(0, 1))}</span>
            <span class="bm-text">
              <span class="bm-title">${escapeHtml(bookmark.title)}</span>
              <span class="bm-url">${escapeHtml(bookmark.url.replace(/^https?:\/\//, ''))}</span>
            </span>
            <span class="bm-remove" data-remove="${escapeHtml(bookmark.id)}" role="button" title="Remove">
              ${icon('close', { size: 13 })}
            </span>
          </button>`).join('')}
      </div>
      <button class="bm-add" data-action="add">${icon('plus', { size: 13 })} Add bookmark</button>`;

    widget.querySelectorAll('.bm-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        if (event.target.closest('[data-remove]')) return;
        wm.open('browser', { args: { url: item.dataset.url } });
      });
    });
    widget.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.remove;
        const next = getSettings().bookmarks.filter((bookmark) => bookmark.id !== id);
        await updateSettings({ bookmarks: next });
        toast('Bookmark removed');
      });
    });
    widget.querySelectorAll('[data-action="add"]').forEach((button) => {
      button.addEventListener('click', addBookmark);
    });
    return widget;
  }

  async function addBookmark() {
    const title = await promptDialog({
      title: 'New bookmark',
      label: 'Name',
      placeholder: 'Favourite site',
      confirmText: 'Next',
      iconName: 'star',
    });
    if (!title) return;
    const url = await promptDialog({
      title: 'Bookmark URL',
      label: 'Address',
      value: 'https://',
      placeholder: 'https://example.com',
      confirmText: 'Save bookmark',
      iconName: 'link',
      validate: (value) => (/^https?:\/\/\S+\.\S+/i.test(value) ? null : 'Enter a full http(s) URL'),
    });
    if (!url) return;
    const bookmarks = [...(getSettings().bookmarks || []), {
      id: crypto.randomUUID(),
      title,
      url,
    }];
    await updateSettings({ bookmarks });
    toast('Bookmark added', { type: 'success' });
  }

  /* ------------------------------------------------------------- monitor */
  function monitorWidget() {
    if (!getSettings().widgets?.monitor) return null;
    const widget = document.createElement('section');
    widget.className = 'widget monitor-widget';
    widget.innerHTML = `
      <div class="widget-head"><span>Performance</span><span class="widget-link" data-role="fps">live</span></div>
      <div class="mon-row">
        <div class="mon-label"><span>JS heap</span><b data-role="heap">–</b></div>
        <div class="mon-bar" data-role="heap-bar"><span style="width:0%"></span></div>
      </div>
      <div class="mon-row">
        <div class="mon-label"><span>Local storage</span><b data-role="storage">–</b></div>
        <div class="mon-bar" data-role="storage-bar"><span style="width:0%"></span></div>
      </div>
      <div class="mon-row">
        <div class="mon-label"><span>Windows</span><b data-role="windows">0</b></div>
      </div>
      <div class="mon-foot"><span data-role="cores">${navigator.hardwareConcurrency || '?'} threads</span><span data-role="uptime">0s uptime</span></div>`;
    updateMonitor(widget);
    return widget;
  }

  async function updateMonitor(widget) {
    if (!widget.isConnected) return;
    const memory = performance.memory;
    const heap = widget.querySelector('[data-role="heap"]');
    const heapBar = widget.querySelector('[data-role="heap-bar"] span');
    if (memory && memory.jsHeapSizeLimit) {
      const used = memory.usedJSHeapSize;
      const limit = memory.jsHeapSizeLimit;
      const percent = Math.min(100, (used / limit) * 100);
      if (heap) heap.textContent = `${formatBytes(used)} / ${formatBytes(limit)}`;
      if (heapBar) heapBar.style.width = `${Math.max(percent, 1.5)}%`;
      widget.querySelector('[data-role="heap-bar"]')?.classList.toggle('warn', percent > 72);
    } else if (heap) {
      heap.textContent = 'not exposed';
    }

    const windows = wm.list();
    const openCount = windows.filter((win) => !win.minimized).length;
    const winEl = widget.querySelector('[data-role="windows"]');
    if (winEl) winEl.textContent = `${openCount} open · ${windows.length} total`;

    const uptimeEl = widget.querySelector('[data-role="uptime"]');
    if (uptimeEl) {
      const seconds = Math.floor(performance.now() / 1000);
      uptimeEl.textContent = seconds < 60
        ? `${seconds}s uptime`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s uptime`;
    }

    try {
      const stats = await FS.stats();
      const estimate = await navigator.storage?.estimate?.();
      const quota = estimate?.quota || 0;
      const used = estimate?.usage || stats.bytes;
      const storeText = widget.querySelector('[data-role="storage"]');
      if (storeText) storeText.textContent = `${formatBytes(used)}${quota ? ` / ${formatBytes(quota)}` : ''}`;
      const bar = widget.querySelector('[data-role="storage-bar"] span');
      if (bar) bar.style.width = `${quota ? Math.min(100, Math.max(1.5, (used / quota) * 100)) : 2}%`;
      const footer = widget.querySelector('[data-role="cores"]');
      if (footer && footer.dataset.title !== '1') {
        footer.title = `${stats.files} files · ${stats.folders} folders · ${formatBytes(stats.bytes)} in RadonOS files`;
      }
    } catch { /* storage estimate is optional */ }
  }

  /* -------------------------------------------------------------- render */
  function render() {
    const settings = getSettings();
    clearInterval(monitorTimer);
    monitorTimer = null;
    syncVisibility(settings);
    host.innerHTML = '';
    if (host.hidden) return;

    const nodes = [
      weatherWidget(settings),
      notesWidget(settings),
      bookmarksWidget(settings),
      monitorWidget(),
    ].filter(Boolean);

    nodes.forEach((node) => host.appendChild(node));
    relevantKey = relevantSettings();

    const monitorNode = nodes.find((node) => node.classList.contains('monitor-widget'));
    if (monitorNode) {
      updateMonitor(monitorNode);
      monitorTimer = setInterval(() => updateMonitor(monitorNode), 2500);
    }

    if (!nodes.length) {
      host.hidden = true;
      docEl.style.setProperty('--widgets-w', '0px');
    }
  }

  window.addEventListener('resize', () => syncVisibility(getSettings()));
  const unsubscribe = onSettingsChange((settings) => {
    syncVisibility(settings);
    if (relevantSettings() !== relevantKey) render();
  });

  render();

  return {
    render,
    refresh: render,
    destroy() {
      clearInterval(monitorTimer);
      unsubscribe.then((off) => off?.());
    },
  };
}
