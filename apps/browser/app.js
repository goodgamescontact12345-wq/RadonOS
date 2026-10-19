import { icon } from '../../shared/icons.js';
import { QUICK_LINKS } from '../../shared/registry.js';
import { loadSettings, getSettings, updateSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { paintIcons, toast, escapeHtml, openApp } from '../../shared/ui.js';
import { tabs } from '../../shared/platform.js';

const $ = (selector) => document.querySelector(selector);

/** Hosts that are known to send frame-blocking headers. */
const EMBED_BLOCKED = new Set([
  'google.com', 'www.google.com', 'youtube.com', 'www.youtube.com', 'github.com',
  'twitter.com', 'x.com', 'reddit.com', 'www.reddit.com', 'instagram.com',
  'facebook.com', 'www.facebook.com', 'netflix.com', 'linkedin.com', 'amazon.com',
  'stackoverflow.com', 'tiktok.com', 'discord.com', 'whatsapp.com', 'openai.com',
  'chat.openai.com', 'mail.google.com', 'drive.google.com', 'figma.com',
  'open.spotify.com', 'spotify.com', 'notion.so', 'medium.com', 'duckduckgo.com',
]);

const state = {
  history: [],
  index: -1,
  current: null,
  loading: false,
  timeout: null,
};

const frame = $('#frame');
const home = $('#home');
const blocked = $('#blocked');
const address = $('#address');

/* ------------------------------------------------------------- utilities */
function normalize(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  if (value.startsWith('localhost')) return `http://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isBlocked(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (EMBED_BLOCKED.has(host)) return true;
  return [...EMBED_BLOCKED].some((domain) => host.endsWith(`.${domain}`));
}

function setStatus(text, { url = '' } = {}) {
  $('#status-text').textContent = text;
  $('#status-url').textContent = url;
}

function setLoading(loading) {
  state.loading = loading;
  $('#address-loading').hidden = !loading;
  $('#nav-reload').classList.toggle('spinning', loading);
}

/* ------------------------------------------------------------ navigation */
function showHome() {
  state.current = null;
  address.value = '';
  frame.hidden = true;
  frame.src = 'about:blank';
  blocked.hidden = true;
  $('#embed-warning').hidden = true;
  home.hidden = false;
  renderQuickLinks();
  setStatus('Home');
  updateNavButtons();
}

function showBlocked(url) {
  home.hidden = true;
  frame.hidden = true;
  frame.src = 'about:blank';
  blocked.hidden = false;
  $('#embed-warning').hidden = true;
  $('#blocked-text').innerHTML = `
    <code>${escapeHtml(hostOf(url))}</code> sends headers that forbid being displayed inside
    a frame, which is why browsers cannot embed it in a RadonOS window.`;
  setStatus('Blocked from embedding', { url });
  updateNavButtons();
}

function navigate(rawUrl, { push = true, force = false } = {}) {
  const url = normalize(rawUrl);
  if (!url) return;
  clearTimeout(state.timeout);

  if (push) {
    state.history = state.history.slice(0, state.index + 1);
    state.history.push(url);
    state.index = state.history.length - 1;
  }
  state.current = url;
  address.value = url;
  blocked.hidden = true;
  home.hidden = true;

  const shell = $('#address-shell');
  shell.classList.toggle('secure', url.startsWith('https://'));

  if (!force && isBlocked(url)) {
    showBlocked(url);
    return;
  }

  frame.hidden = false;
  frame.src = url;
  $('#embed-warning').hidden = true;
  setLoading(true);
  setStatus('Loading…', { url });

  state.timeout = setTimeout(() => {
    if (!state.loading) return;
    setLoading(false);
    $('#embed-warning').hidden = false;
    setStatus('Taking longer than expected', { url });
  }, 8000);

  updateNavButtons();
}

function goBack() {
  if (state.index <= 0) return;
  state.index -= 1;
  navigate(state.history[state.index], { push: false, force: true });
}

function goForward() {
  if (state.index >= state.history.length - 1) return;
  state.index += 1;
  navigate(state.history[state.index], { push: false, force: true });
}

function reload() {
  if (!state.current) return;
  const url = state.current;
  frame.src = 'about:blank';
  setTimeout(() => navigate(url, { push: false, force: true }), 60);
}

function updateNavButtons() {
  $('#nav-back').disabled = state.index <= 0;
  $('#nav-forward').disabled = state.index >= state.history.length - 1;
}

/* ------------------------------------------------------------------ home */
function renderQuickLinks() {
  const bookmarks = (getSettings().bookmarks || []).slice(0, 4).map((bookmark) => ({
    name: bookmark.title,
    url: bookmark.url,
    icon: 'star',
    color: '#f5b544',
    note: bookmark.url.replace(/^https?:\/\//, ''),
  }));
  const cards = [...QUICK_LINKS, ...bookmarks];

  $('#quick-grid').innerHTML = cards.map((link) => `
    <button class="quick-card" data-url="${escapeHtml(link.url)}" style="--quick-color:${link.color || 'var(--accent)'}">
      <span class="quick-icon">${icon(link.icon || 'globe', { size: 16 })}</span>
      <span class="quick-text">
        <span class="quick-name">${escapeHtml(link.name)}</span>
        <span class="quick-note">${escapeHtml(link.note || link.url)}</span>
      </span>
    </button>`).join('');

  $('#quick-grid').querySelectorAll('[data-url]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.url));
  });
}

/* -------------------------------------------------------------- bookmark */
async function saveBookmark() {
  if (!state.current) {
    toast('Open a page first', { type: 'info' });
    return;
  }
  const url = state.current;
  const bookmarks = getSettings().bookmarks || [];
  if (bookmarks.some((bookmark) => bookmark.url === url)) {
    toast('Already bookmarked', { type: 'info', iconName: 'star' });
    return;
  }
  let title = hostOf(url).replace(/^www\./, '');
  try {
    title = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || title;
  } catch { /* keep host title */ }

  await updateSettings({
    bookmarks: [{ id: crypto.randomUUID(), title, url }, ...bookmarks].slice(0, 40),
  });
  toast(`Bookmarked ${title}`, { type: 'success', iconName: 'star' });
}

/* --------------------------------------------------------------- wiring */
$('#nav-back').addEventListener('click', goBack);
$('#nav-forward').addEventListener('click', goForward);
$('#nav-reload').addEventListener('click', reload);
$('#nav-home').addEventListener('click', showHome);
$('#bookmark').addEventListener('click', saveBookmark);
$('#go').addEventListener('click', () => navigate(address.value));

$('#external').addEventListener('click', async () => {
  if (!state.current) {
    toast('Nothing to open yet', { type: 'info' });
    return;
  }
  await tabs.open(state.current);
  toast('Opened in a real browser tab', { type: 'info', iconName: 'external' });
});

$('#warning-external').addEventListener('click', () => {
  if (state.current) void tabs.open(state.current);
});

$('#blocked-external').addEventListener('click', () => {
  if (state.current) void tabs.open(state.current);
});
$('#blocked-copy').addEventListener('click', async () => {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(state.current);
    toast('URL copied', { type: 'success', iconName: 'copy' });
  } catch {
    toast(state.current, { title: 'URL', iconName: 'link' });
  }
});
$('#blocked-try').addEventListener('click', () => {
  const url = state.current;
  if (url) navigate(url, { push: false, force: true });
});

address.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    navigate(address.value);
  }
  if (event.key === 'Escape') {
    address.value = state.current || '';
    address.blur();
  }
});

frame.addEventListener('load', () => {
  clearTimeout(state.timeout);
  setLoading(false);
  if (frame.hidden) return;
  setStatus('Loaded', { url: state.current || '' });
});

window.addEventListener('online', () => setStatus('Back online'));
window.addEventListener('offline', () => setStatus('Offline — RadonOS apps still work'));

document.addEventListener('keydown', (event) => {
  if (event.altKey && event.code === 'ArrowLeft') goBack();
  if (event.altKey && event.code === 'ArrowRight') goForward();
  if (event.key === 'F5') reload();
});

/* ------------------------------------------------------------------ boot */
(async () => {
  await loadSettings();
  await initTheme();
  paintIcons();
  showHome();

  const target = new URLSearchParams(location.search).get('url');
  if (target) navigate(target, { push: true });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      address.focus();
      address.select();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      void saveBookmark();
    } else if (event.ctrlKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      openApp('browser');
    }
  });
})();
