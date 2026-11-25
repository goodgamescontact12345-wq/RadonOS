import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { APPS } from '../../shared/registry.js';
import { SHORTCUT_ACTIONS, SHORTCUT_GROUPS, describe, getKeys } from '../../shared/shortcuts.js';
import { paintIcons, escapeHtml } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const TIPS = [
  {
    title: 'Edit the desktop',
    body: 'Right-click the desktop for New shortcut, New note and Sort icons. Right-click a desktop icon to rename or remove a shortcut; app icons can be hidden from Settings → Desktop.',
  },
  {
    title: 'Change any shortcut',
    body: 'Settings → Keyboard lists every binding. Click one, press the new combination, and it applies immediately — no reload.',
  },
  {
    title: 'Drag windows around',
    body: 'Drag a titlebar to move a window, drag its edges to resize, or drag to a screen edge to snap it. The layout shortcuts do the same from the keyboard.',
  },
  {
    title: 'Files live on this device',
    body: 'Files, notes and settings are stored in this browser profile. Settings → Storage exports everything as JSON.',
  },
  {
    title: 'The dock',
    body: 'Click a dock icon to open or focus an app, click again to minimize it. Right-click to pin, unpin or close its windows.',
  },
];

function shortcutRows() {
  const keys = getKeys();
  return SHORTCUT_GROUPS.map((group) => {
    const rows = SHORTCUT_ACTIONS.filter((action) => action.group === group.id && keys[action.id]);
    if (!rows.length) return '';
    return `
      <div class="help-entry" style="border:0;padding-bottom:0"><h4>${escapeHtml(group.label)}</h4><p>${escapeHtml(group.note)}</p></div>
      ${rows.map((action) => `
        <div class="help-keys">
          <span>${escapeHtml(action.label)}</span>
          <code>${escapeHtml(describe(keys[action.id]))}</code>
        </div>`).join('')}`;
  }).join('');
}

function appRows() {
  return APPS.map((app) => `
    <div class="help-entry">
      <h4>${escapeHtml(app.name)}</h4>
      <p>${escapeHtml(app.description)} · <span class="muted">${escapeHtml(app.category)}</span></p>
    </div>`).join('');
}

function tipRows() {
  return TIPS.map((tip) => `
    <div class="help-entry">
      <h4>${escapeHtml(tip.title)}</h4>
      <p>${escapeHtml(tip.body)}</p>
    </div>`).join('');
}

function filter() {
  const query = $('#help-search').value.trim().toLowerCase();
  const matches = (text) => !query || text.toLowerCase().includes(query);

  const sections = [
    { id: 'shortcuts', title: 'Keyboard shortcuts', html: shortcutRows(), text: SHORTCUT_ACTIONS.map((action) => `${action.label} ${getKeys()[action.id] || ''}`).join(' ') },
    { id: 'apps', title: 'Applications', html: appRows(), text: APPS.map((app) => `${app.name} ${app.description} ${app.category}`).join(' ') },
    { id: 'tips', title: 'Tips', html: tipRows(), text: TIPS.map((tip) => `${tip.title} ${tip.body}`).join(' ') },
  ].filter((section) => matches(section.text) || !query);

  $('#help-body').innerHTML = sections.length
    ? sections.map((section) => `<h3 class="section-label">${escapeHtml(section.title)}</h3>${section.html}`).join('')
    : '<div class="empty-hint">Nothing matches that search. Try “shortcut”, “window”, “files” or an app name.</div>';
  $('#help-count').textContent = `${SHORTCUT_ACTIONS.length} shortcuts · ${APPS.length} apps`;
  paintIcons();
}

$('#help-search').addEventListener('input', filter);

await loadSettings();
await initTheme();
filter();
