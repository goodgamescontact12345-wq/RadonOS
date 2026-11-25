import { getSettings, updateSettings } from './settings.js';

/**
 * Every RadonOS shortcut is defined here, once, and rebound in
 * Settings → Keyboard. The defaults deliberately avoid chords a browser or an
 * operating system owns: nothing uses Alt+letter, Ctrl+letter, F-keys or the
 * Windows key, so the page actually receives what it is listening for.
 * `Alt+Shift+<key>` reaches the page in Chrome, Edge, Firefox and Safari.
 */
export const SHORTCUT_GROUPS = [
  { id: 'windows', label: 'Windows', note: 'Move between and close windows' },
  { id: 'layout', label: 'Window layout', note: 'Snap the focused window' },
  { id: 'system', label: 'System', note: 'Launcher, command bar and session' },
  { id: 'browser', label: 'Browser app', note: 'Inside Browser these win over the shell' },
];

export const SHORTCUT_ACTIONS = [
  { id: 'window.cycle', label: 'Cycle windows', group: 'windows', default: 'Alt+Shift+`' },
  { id: 'window.minimize', label: 'Minimize window', group: 'windows', default: 'Alt+Shift+M' },
  { id: 'window.close', label: 'Close window', group: 'windows', default: 'Alt+Shift+Q' },

  { id: 'layout.maximize', label: 'Maximize / restore', group: 'layout', default: 'Alt+Shift+Up' },
  { id: 'layout.left', label: 'Snap left half', group: 'layout', default: 'Alt+Shift+Left' },
  { id: 'layout.right', label: 'Snap right half', group: 'layout', default: 'Alt+Shift+Right' },
  { id: 'layout.quadrant', label: 'Snap to quadrant', group: 'layout', default: 'Alt+Shift+1' },
  { id: 'layout.centre', label: 'Centre window', group: 'layout', default: 'Alt+Shift+5' },
  { id: 'layout.cycleTiles', label: 'Cycle tiling layouts', group: 'layout', default: 'Alt+Shift+Y' },

  { id: 'system.launcher', label: 'Applications menu', group: 'system', default: 'Alt+Shift+Space' },
  { id: 'system.command', label: 'Command bar', group: 'system', default: 'Alt+Shift+K' },
  { id: 'system.files', label: 'Open Files', group: 'system', default: 'Alt+Shift+E' },
  { id: 'system.terminal', label: 'Open Terminal', group: 'system', default: 'Alt+Shift+Enter' },
  { id: 'system.settings', label: 'Open Settings', group: 'system', default: 'Alt+Shift+S' },
  { id: 'system.lock', label: 'Lock the session', group: 'system', default: 'Alt+Shift+L' },

  { id: 'browser.newTab', label: 'New tab', group: 'browser', default: 'Alt+Shift+T' },
  { id: 'browser.closeTab', label: 'Close tab', group: 'browser', default: 'Alt+Shift+W' },
  { id: 'browser.address', label: 'Focus address bar', group: 'browser', default: 'Alt+Shift+A' },
  { id: 'browser.reload', label: 'Reload page', group: 'browser', default: 'Alt+Shift+R' },
  { id: 'browser.back', label: 'Back', group: 'browser', default: 'Alt+Shift+ArrowLeft' },
  { id: 'browser.forward', label: 'Forward', group: 'browser', default: 'Alt+Shift+ArrowRight' },
  { id: 'browser.tab', label: 'Switch to tab 1-9', group: 'browser', default: 'Alt+Shift+Digit' },
];

export const ACTION_MAP = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export function defaultKeys() {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action.default]));
}

/** Active bindings: every default overridden by settings.keys. */
export function getKeys() {
  const stored = getSettings().keys;
  return { ...defaultKeys(), ...(stored && typeof stored === 'object' ? stored : {}) };
}

export function keysFor(actionId) {
  return getKeys()[actionId] || '';
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'OS', 'AltGraph']);

/** Turn a keystroke into a stable "Alt+Shift+K" string, or null for modifiers. */
export function comboFromEvent(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');

  const code = event.code || '';
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = `Numpad${code.slice(6)}`;
  else if (/^F[0-9]{1,2}$/.test(code)) key = code;
  else if (code === 'Backquote') key = '`';
  else if (code === 'ArrowLeft') key = 'ArrowLeft';
  else if (code === 'ArrowRight') key = 'ArrowRight';
  else if (code === 'ArrowUp') key = 'ArrowUp';
  else if (code === 'ArrowDown') key = 'ArrowDown';
  else if (code === 'Space') key = 'Space';
  else if (code === 'Enter') key = 'Enter';
  else if (code === 'Tab') key = 'Tab';
  else if (code === 'Minus') key = '-';
  else if (code === 'Equal') key = '=';
  else if (code === 'Slash') key = '/';
  else if (code === 'Comma') key = ',';
  else if (code === 'Period') key = '.';
  else if (code === 'Semicolon') key = ';';
  else if (code === 'Quote') key = "'";
  else if (code === 'BracketLeft') key = '[';
  else if (code === 'BracketRight') key = ']';
  else if (code === 'Backslash') key = '\\';
  else key = event.key && event.key.length === 1 ? event.key.toUpperCase() : (event.key || '');

  if (!key) return null;
  // A bare letter is not a shortcut: it has to carry a modifier.
  if (!parts.length) return null;
  return [...parts, key].join('+');
}

function normalisePart(part) {
  return part.trim();
}

/** Split a combo string into its parts. */
export function parseCombo(combo) {
  return String(combo || '').split('+').filter(Boolean).map(normalisePart);
}

/** Does this keyboard event match the binding? */
export function matches(combo, event) {
  if (!combo) return false;
  if (MODIFIER_KEYS.has(event.key)) return false;
  const parts = parseCombo(combo);
  const wanted = new Set(parts);
  if (wanted.has('Ctrl') !== !!event.ctrlKey) return false;
  if (wanted.has('Alt') !== !!event.altKey) return false;
  if (wanted.has('Shift') !== !!event.shiftKey) return false;
  if (wanted.has('Meta') !== !!event.metaKey) return false;

  const key = parts.find((part) => !MODIFIERS.includes(part));
  if (!key) return false;
  if (key === 'Digit') {
    return /^Digit[1-9]$/.test(event.code || '');
  }
  const code = event.code || '';
  const byCode = {
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=',
    Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  };
  if (byCode[code] === key) return true;
  if (/^Key[A-Z]$/.test(code) && code.slice(3) === key) return true;
  if (/^Digit[0-9]$/.test(code) && code.slice(5) === key) return true;
  if (/^Numpad[0-9]$/.test(code) && `Numpad${code.slice(6)}` === key) return true;
  if (/^F[0-9]{1,2}$/.test(code) && code === key) return true;
  const plain = String(event.key || '').toUpperCase();
  return plain === key.toUpperCase() || plain === key;
}

/** Readable form for tooltips and menus: "Alt+Shift+K". */
export function describe(combo) {
  return parseCombo(combo).join('+');
}

export function comboFor(actionId) {
  return describe(keysFor(actionId));
}

/** Which action does this event trigger? Optional action filter (e.g. only browser.*). */
export function actionForEvent(event, prefix = '') {
  for (const action of SHORTCUT_ACTIONS) {
    if (prefix && !action.id.startsWith(prefix)) continue;
    if (matches(getKeys()[action.id], event)) return action.id;
  }
  return null;
}

/**
 * Settings merges nested objects, so a deleted key would survive the write.
 * Every write therefore stores the full map and a reset writes the default
 * value back instead of removing the entry.
 */
async function writeKeys(next) {
  await updateSettings({ keys: { ...next } });
  return next;
}

export async function setKey(actionId, combo) {
  if (!ACTION_MAP.has(actionId)) return getKeys();
  const keys = { ...getKeys(), [actionId]: combo || '' };
  return writeKeys(keys);
}

export async function resetKeys() {
  return writeKeys(defaultKeys());
}

export async function resetKey(actionId) {
  const action = ACTION_MAP.get(actionId);
  if (!action) return getKeys();
  return writeKeys({ ...getKeys(), [actionId]: action.default });
}

/** Every other action already using this combo (conflict warning in Settings). */
export function conflictingAction(actionId, combo) {
  const target = describe(combo);
  if (!target) return null;
  return SHORTCUT_ACTIONS.find((action) => (
    action.id !== actionId && describe(getKeys()[action.id]) === target
  )) || null;
}

/** "<kbd>Alt</kbd>+<kbd>Shift</kbd>..." markup for hints. */
export function kbdHtml(combo) {
  return parseCombo(combo).map((part) => `<kbd>${part}</kbd>`).join('+');
}
