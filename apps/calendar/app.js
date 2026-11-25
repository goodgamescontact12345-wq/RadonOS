import { loadSettings, getSettings, updateSettings, onSettingsChange } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { paintIcons, toast } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const today = new Date();
let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
let selected = null;
let saveTimer = 0;

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function notes() {
  const stored = getSettings().calendarNotes;
  return stored && typeof stored === 'object' ? stored : {};
}

function paint() {
  const monthName = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#month-label').textContent = monthName;

  const map = notes();
  const firstWeekday = (cursor.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const daysInPrev = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate();

  const cells = [];
  for (let i = firstWeekday - 1; i >= 0; i -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - 1, daysInPrev - i);
    cells.push({ date, out: true });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), day), out: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), out: true });
  }

  $('#cal-grid').innerHTML = [
    ...DAYS.map((day) => `<div class="cal-dow">${day}</div>`),
    ...cells.map(({ date, out }) => {
      const key = iso(date);
      const classes = ['cal-day'];
      if (out) classes.push('out');
      if (key === iso(today)) classes.push('today');
      if (key === selected) classes.push('selected');
      if (map[key]) classes.push('has-note');
      return `<button type="button" class="${classes.join(' ')}" data-date="${key}">${date.getDate()}</button>`;
    }),
  ].join('');

  const count = Object.values(map).filter(Boolean).length;
  $('#cal-count').textContent = count ? `${count} note${count === 1 ? '' : 's'} this month` : 'No notes yet';
  paintEditor();
}

function paintEditor() {
  const textarea = $('#day-note');
  if (!selected) {
    textarea.disabled = true;
    textarea.value = '';
    $('#note-label').textContent = 'Pick a day to add a note';
    return;
  }
  textarea.disabled = false;
  const [year, month, day] = selected.split('-').map(Number);
  $('#note-label').textContent = new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  textarea.value = notes()[selected] || '';
  $('#cal-status').textContent = textarea.value ? 'Saved' : '';
}

function saveNote() {
  if (!selected) return;
  const value = $('#day-note').value;
  const map = { ...notes() };
  if (value.trim()) map[selected] = value;
  else delete map[selected];
  void updateSettings({ calendarNotes: map });
  $('#cal-status').textContent = value.trim() ? 'Saved' : 'Cleared';
  paint();
}

$('#cal-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  selected = button.dataset.date;
  const [year, month] = selected.split('-').map(Number);
  if (month - 1 !== cursor.getMonth() || year !== cursor.getFullYear()) {
    cursor = new Date(year, month - 1, 1);
  }
  paint();
  $('#day-note').focus();
});

$('#prev').addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  paint();
});
$('#next').addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  paint();
});
$('#today').addEventListener('click', () => {
  cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  selected = iso(today);
  paint();
});

$('#day-note').addEventListener('input', () => {
  clearTimeout(saveTimer);
  $('#cal-status').textContent = 'Typing…';
  saveTimer = setTimeout(saveNote, 500);
});
$('#day-note').addEventListener('change', saveNote);

onSettingsChange(() => paint());

await loadSettings();
await initTheme();
paintIcons();
selected = iso(today);
paint();
