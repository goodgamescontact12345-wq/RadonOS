import { loadSettings, getSettings, updateSettings, onSettingsChange } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { promptDialog, paintIcons, escapeHtml, toast } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const DEFAULT_CITIES = [
  { label: 'Local', zone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  { label: 'London', zone: 'Europe/London' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
];

const knownZones = [
  ['Amsterdam', 'Europe/Amsterdam'], ['Berlin', 'Europe/Berlin'], ['Cairo', 'Africa/Cairo'],
  ['Dubai', 'Asia/Dubai'], ['Los Angeles', 'America/Los_Angeles'], ['Mumbai', 'Asia/Kolkata'],
  ['Paris', 'Europe/Paris'], ['São Paulo', 'America/Sao_Paulo'], ['Shanghai', 'Asia/Shanghai'],
  ['Sydney', 'Australia/Sydney'], ['Toronto', 'America/Toronto'], ['Moscow', 'Europe/Moscow'],
];

function cities() {
  const stored = getSettings().clockCities;
  return Array.isArray(stored) && stored.length ? stored : DEFAULT_CITIES;
}

function paint() {
  const use12 = getSettings().clock24 === false;
  $('#clock-format').textContent = use12 ? '12-hour' : '24-hour';
  const grid = $('#clock-grid');
  grid.innerHTML = cities().map((city) => {
    const time = new Intl.DateTimeFormat(undefined, {
      timeZone: city.zone, hour: '2-digit', minute: '2-digit', hour12: use12,
    }).format(new Date());
    const day = new Intl.DateTimeFormat(undefined, {
      timeZone: city.zone, weekday: 'short', day: 'numeric', month: 'short',
    }).format(new Date());
    return `
      <div class="clock-card">
        <div class="clock-city">${escapeHtml(city.label)}</div>
        <div class="clock-time-big">${escapeHtml(time)}</div>
        <div class="clock-zone">${escapeHtml(day)} · ${escapeHtml(city.zone.split('/').pop().replace(/_/g, ' '))}</div>
      </div>`;
  }).join('');
}

/* ------------------------------------------------------------- stopwatch */
let running = false;
let startedAt = 0;
let elapsed = 0;
let laps = [];
let frame = 0;

function formatStopwatch(ms) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function paintStopwatch() {
  const ms = elapsed + (running ? performance.now() - startedAt : 0);
  $('#sw-time').textContent = formatStopwatch(ms);
  if (running) frame = requestAnimationFrame(paintStopwatch);
}

function toggleStopwatch() {
  if (running) {
    elapsed += performance.now() - startedAt;
    running = false;
    cancelAnimationFrame(frame);
    $('#sw-toggle').textContent = 'Start';
  } else {
    startedAt = performance.now();
    running = true;
    $('#sw-toggle').textContent = 'Pause';
    frame = requestAnimationFrame(paintStopwatch);
  }
  paintStopwatch();
}

function resetStopwatch() {
  running = false;
  elapsed = 0;
  laps = [];
  cancelAnimationFrame(frame);
  $('#sw-toggle').textContent = 'Start';
  $('#sw-laps').textContent = '';
  paintStopwatch();
}

function addLap() {
  const ms = elapsed + (running ? performance.now() - startedAt : 0);
  laps.unshift(formatStopwatch(ms));
  laps = laps.slice(0, 8);
  $('#sw-laps').innerHTML = laps.map((lap, index) => `<div>Lap ${laps.length - index} · ${lap}</div>`).join('');
}

/* ----------------------------------------------------------------- wiring */
$('#sw-toggle').addEventListener('click', toggleStopwatch);
$('#sw-reset').addEventListener('click', resetStopwatch);
$('#sw-lap').addEventListener('click', addLap);

$('#add-city').addEventListener('click', async () => {
  const label = await promptDialog({
    title: 'Add a city',
    label: 'City name (Amsterdam, Tokyo, Sydney…)',
    placeholder: 'Amsterdam',
    confirmText: 'Add',
    iconName: 'clock',
    validate: (value) => (knownZones.some(([name]) => name.toLowerCase() === value.trim().toLowerCase())
      ? null : 'Use one of the cities RadonOS knows'),
  });
  if (!label) return;
  const match = knownZones.find(([name]) => name.toLowerCase() === label.trim().toLowerCase());
  const next = [...cities(), { label: match[0], zone: match[1] }];
  await updateSettings({ clockCities: next });
  paint();
  toast(`${match[0]} added`, { type: 'success', iconName: 'clock' });
});

$('#remove-city').addEventListener('click', async () => {
  const list = cities();
  if (list.length <= 1) {
    toast('Keep at least one clock', { type: 'error' });
    return;
  }
  await updateSettings({ clockCities: list.slice(0, -1) });
  paint();
});

onSettingsChange(() => paint());
setInterval(paint, 15000);

await loadSettings();
await initTheme();
paintIcons();
paint();
paintStopwatch();
