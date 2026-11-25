import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { icon } from '../../shared/icons.js';
import { paintIcons, formatBytes, escapeHtml, openApp, toast } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

function shell() {
  return window.parent?.RadonOS || null;
}

function uptime(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function paint() {
  const os = shell();
  const windows = os?.wm?.list?.() || [];
  const filter = $('#monitor-filter').value.trim().toLowerCase();
  const shown = filter ? windows.filter((win) => (win.title || '').toLowerCase().includes(filter)) : windows;

  const memory = performance.memory;
  const storage = $('#mon-stats');
  const stats = [
    { label: 'Open windows', value: String(windows.length) },
    { label: 'JS heap', value: memory ? formatBytes(memory.usedJSHeapSize) : '—' },
    { label: 'Heap limit', value: memory ? formatBytes(memory.jsHeapSizeLimit) : '—' },
    { label: 'Session', value: uptime(performance.now()) },
  ];
  storage.innerHTML = stats.map((stat) => `
    <div class="stat-card">
      <div class="stat-label">${stat.label}</div>
      <div class="stat-value">${stat.value}</div>
    </div>`).join('');

  $('#mon-procs').innerHTML = shown.length ? shown.map((win) => `
    <div class="proc-row" data-window="${win.id}">
      <span style="color:${win.color}">${icon(win.icon, { size: 15 })}</span>
      <span class="proc-name">${escapeHtml(win.title)}</span>
      <span class="muted">${escapeHtml(win.appId)}</span>
      <span class="muted">${win.minimized ? 'minimized' : win.active ? 'focused' : 'idle'}</span>
      <button class="ros-btn sm ghost icon" data-close="${win.id}" data-icon="close" data-size="13" title="Close window"></button>
    </div>`).join('') : '<div class="empty-hint">No windows match that filter.</div>';

  paintIcons();
  $('#mon-status').textContent = `${shown.length} of ${windows.length} windows`;
  $('#mon-engine').textContent = `${navigator.userAgent.includes('Chrome') ? 'Chromium' : 'Browser'} engine`;
}

$('#monitor-filter').addEventListener('input', paint);
$('#monitor-refresh').addEventListener('click', paint);
$('#mon-procs').addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) {
    shell()?.wm?.close?.(close.dataset.close);
    setTimeout(paint, 120);
    return;
  }
  const row = event.target.closest('[data-window]');
  if (row) shell()?.wm?.focus?.(row.dataset.window);
});

if (navigator.storage?.estimate) {
  navigator.storage.estimate().then((estimate) => {
    const used = document.createElement('div');
    used.className = 'empty-hint';
    used.style.marginTop = '10px';
    used.textContent = `Virtual disk: ${formatBytes(estimate.usage || 0)} used of ${formatBytes(estimate.quota || 0)} available.`;
    $('.pane').appendChild(used);
  }).catch(() => {});
}

setInterval(paint, 2000);

await loadSettings();
await initTheme();
paint();
