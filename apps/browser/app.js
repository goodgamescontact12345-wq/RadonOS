import { icon } from '../../shared/icons.js';
import { QUICK_LINKS } from '../../shared/registry.js';
import { loadSettings, getSettings, updateSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { paintIcons, toast, escapeHtml } from '../../shared/ui.js';
import { isExtension, runtime, tabs as browserTabs } from '../../shared/platform.js';
import { LinkedWindow } from '../../shared/embedWindow.js';
import { EMBED_BLOCKED } from '../../shared/framePolicy.js';

const $ = (selector) => document.querySelector(selector);

const home = $('#home');
const blocked = $('#blocked');
const address = $('#address');
const strip = $('#tab-strip');
const frameLayer = $('#frame-layer');
const linked = new LinkedWindow();

/**
 * Tabs own their own frame and history, so switching does not reload the page
 * and every tab keeps its own back/forward stack. One RadonOS window has one
 * linked external window, so a frame-blocked page in any tab drives that.
 */
const tabList = [];
let activeId = null;
let seq = 0;

/**
 * Whether this build can drop frame-blocking headers, which is what lets the
 * known-blocked hosts load in this window instead of a separate one. The
 * extension asks its service worker, which installs the declarativeNetRequest
 * rule; the hosted build has no server to rewrite responses and answers false.
 */
const frameUnlockReady = (async () => {
  if (!isExtension) return false;
  const result = await runtime.send({ type: 'FRAME_UNLOCK' });
  return result?.ok === true;
})().catch(() => false);

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

const activeTab = () => tabList.find((tab) => tab.id === activeId) || null;

function tabTitle(tab) {
  const host = hostOf(tab.blockedUrl || tab.url).replace(/^www\./, '');
  return host || 'New tab';
}

function setStatus(text, { url = '' } = {}) {
  $('#status-text').textContent = text;
  $('#status-url').textContent = url;
}

function setLoading(loading) {
  $('#address-loading').hidden = !loading;
  $('#nav-reload').classList.toggle('spinning', loading);
}

/* ------------------------------------------------------ linked page window */
function renderLinkedWindow(state) {
  const size = $('#linked-size');
  if (!size || !state.bounds) return;
  blocked.dataset.linkedWidth = String(state.bounds.width);
  blocked.dataset.linkedHeight = String(state.bounds.height);
  size.textContent = state.open
    ? `Linked window · ${state.bounds.width} × ${state.bounds.height}`
    : 'Linked window closed';
  size.classList.toggle('closed', !state.open);
  $('#linked-action').textContent = state.open ? 'Focus linked window' : 'Open linked window';
}

linked.addEventListener('change', (event) => renderLinkedWindow(event.detail));

/** Hand the page to a browser window that mirrors this RadonOS window. */
function openLinkedWindow(url) {
  if (!url) return false;
  const opened = linked.open(url);
  renderLinkedWindow(linked.state);
  if (!opened) {
    toast('The browser blocked the linked window — allow pop-ups for RadonOS', {
      type: 'error',
      iconName: 'alert',
      timeout: 5200,
    });
  }
  return opened;
}

function focusLinkedWindow() {
  if (linked.focus()) return;
  // Closed by the user (or never created): bring it back at the current size.
  const tab = activeTab();
  if (tab?.url) openLinkedWindow(tab.url);
}

/* ------------------------------------------------------------------ tabs */
function createTab() {
  const frame = document.createElement('iframe');
  frame.className = 'browser-frame';
  frame.hidden = true;
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads allow-same-origin allow-popups-to-escape-sandbox');
  frameLayer.append(frame);

  const tab = {
    id: `tab-${++seq}`,
    url: null,
    blockedUrl: null,
    blockedOpened: false,
    history: [],
    index: -1,
    loading: false,
    slow: false,
    timeout: null,
    frame,
  };
  frame.addEventListener('load', () => onFrameLoad(tab));
  tabList.push(tab);
  return tab;
}

function newTab(url = '') {
  const tab = createTab();
  activateTab(tab.id);
  if (url) void navigate(url, { tab });
  else showHome(tab);
  return tab;
}

function closeTab(id) {
  const index = tabList.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [tab] = tabList.splice(index, 1);
  clearTimeout(tab.timeout);
  tab.frame.remove();
  // The popup belongs to the window, not the tab: close it once nothing wants it.
  if (linked.isOpen && !tabList.some((entry) => entry.blockedUrl)) linked.close();

  if (activeId !== id) {
    drawTabs();
    return;
  }
  const next = tabList[index] || tabList[index - 1];
  if (next) activateTab(next.id);
  else newTab();
}

function drawTabs() {
  strip.innerHTML = tabList.map((tab) => `
    <div class="tab${tab.id === activeId ? ' active' : ''}" data-tab="${tab.id}" role="tab"
         aria-selected="${tab.id === activeId}" title="${escapeHtml(tab.url || tab.blockedUrl || 'New tab')}">
      <span class="tab-title">${escapeHtml(tabTitle(tab))}</span>
      <button class="tab-close" data-close="${tab.id}" title="Close tab" aria-label="Close tab">${icon('close', { size: 12 })}</button>
    </div>`).join('')
    + `<button class="tab-new" id="tab-new" title="New tab (Alt+T)" aria-label="New tab">${icon('plus', { size: 14 })}</button>`;
}

function renderView(tab) {
  const framed = !!tab.url && !tab.blockedUrl;
  home.hidden = !!tab.url || !!tab.blockedUrl;
  blocked.hidden = !tab.blockedUrl;
  tab.frame.hidden = !framed;
  $('#embed-warning').hidden = !tab.slow;
  if (tab.blockedUrl) renderBlocked(tab);
  if (!tab.url && !tab.blockedUrl) renderQuickLinks();
}

function activateTab(id) {
  const tab = tabList.find((entry) => entry.id === id);
  if (!tab) return;
  activeId = id;
  for (const other of tabList) other.frame.hidden = true;

  address.value = tab.url || tab.blockedUrl || '';
  $('#address-shell').classList.toggle('secure', (tab.url || '').startsWith('https://'));
  renderView(tab);
  drawTabs();
  updateNavButtons();
  setLoading(tab.loading);
  if (tab.blockedUrl) {
    setStatus(tab.blockedOpened ? 'Opened in a linked window' : 'Blocked from embedding', { url: tab.blockedUrl });
  } else if (tab.url) {
    setStatus(tab.loading ? 'Loading…' : 'Loaded', { url: tab.url });
  } else {
    setStatus('Home');
  }
}

/* ------------------------------------------------------------ navigation */
function showHome(tab = activeTab()) {
  if (!tab) return;
  clearTimeout(tab.timeout);
  tab.url = null;
  tab.blockedUrl = null;
  tab.blockedOpened = false;
  tab.loading = false;
  tab.slow = false;
  tab.frame.hidden = true;
  tab.frame.src = 'about:blank';
  linked.close(); // leaving the page closes the window that was showing it

  if (tab.id !== activeId) return;
  address.value = '';
  $('#address-shell').classList.remove('secure');
  renderView(tab);
  drawTabs();
  setLoading(false);
  setStatus('Home');
  updateNavButtons();
}

function renderBlocked(tab) {
  const url = tab.blockedUrl;
  $('#blocked-title').textContent = tab.blockedOpened
    ? 'Opened in a linked window'
    : 'This site needs its own window';
  $('#blocked-text').innerHTML = `
    <code>${escapeHtml(hostOf(url))}</code> sends headers that forbid being displayed inside
    a frame, so RadonOS cannot draw it in this window. ${tab.blockedOpened
      ? 'It is open in a browser window linked to this one: that window keeps this window’s size as you resize or move it, and closes with it.'
      : 'Open it in a linked window and it will keep this window’s size as you resize or move it.'}`;
  renderLinkedWindow(linked.state);
}

function showBlocked(tab, url, { opened = false } = {}) {
  tab.blockedUrl = url;
  tab.blockedOpened = opened;
  tab.loading = false;
  tab.slow = false;
  tab.frame.hidden = true;
  tab.frame.src = 'about:blank';
  clearTimeout(tab.timeout);

  if (tab.id !== activeId) return;
  renderView(tab);
  drawTabs();
  setLoading(false);
  setStatus(opened ? 'Opened in a linked window' : 'Blocked from embedding', { url });
  updateNavButtons();
}

async function navigate(rawUrl, { push = true, force = false, tab = activeTab() } = {}) {
  const url = normalize(rawUrl);
  if (!url || !tab) return;
  clearTimeout(tab.timeout);
  tab.slow = false;

  if (push) {
    tab.history = tab.history.slice(0, tab.index + 1);
    tab.history.push(url);
    tab.index = tab.history.length - 1;
  }
  tab.url = url;
  tab.blockedUrl = null;
  tab.blockedOpened = false;

  const visible = tab.id === activeId;
  if (visible) {
    address.value = url;
    $('#address-shell').classList.toggle('secure', url.startsWith('https://'));
    blocked.hidden = true;
    home.hidden = true;
    $('#embed-warning').hidden = true;
  }

  // A site known to block framing still loads here whenever this build can
  // strip those headers; only a build that cannot needs the external window.
  if (!force && isBlocked(url) && !(await frameUnlockReady)) {
    if (tab.url !== url) return;
    const opened = openLinkedWindow(url);
    showBlocked(tab, url, { opened });
    return;
  }
  // The tab moved on while the capability was being checked.
  if (tab.url !== url) return;

  // RadonOS can frame this page again, so the external window is not needed.
  if (linked.isOpen && !tab.blockedUrl) linked.close();

  tab.frame.hidden = false;
  tab.frame.src = url;
  tab.loading = true;
  if (visible) {
    setLoading(true);
    drawTabs();
    setStatus('Loading…', { url });
  }

  tab.timeout = setTimeout(() => {
    if (!tab.loading) return;
    tab.loading = false;
    tab.slow = true;
    if (tab.id !== activeId) return;
    setLoading(false);
    $('#embed-warning').hidden = false;
    setStatus('Taking longer than expected', { url });
  }, 8000);

  if (visible) updateNavButtons();
}

function onFrameLoad(tab) {
  clearTimeout(tab.timeout);
  tab.loading = false;
  tab.slow = false;
  if (tab.id !== activeId) return;
  setLoading(false);
  $('#embed-warning').hidden = true;
  if (!tab.frame.hidden) setStatus('Loaded', { url: tab.url || '' });
}

function goBack() {
  const tab = activeTab();
  if (!tab || tab.index <= 0) return;
  tab.index -= 1;
  void navigate(tab.history[tab.index], { push: false, force: true, tab });
}

function goForward() {
  const tab = activeTab();
  if (!tab || tab.index >= tab.history.length - 1) return;
  tab.index += 1;
  void navigate(tab.history[tab.index], { push: false, force: true, tab });
}

function reload() {
  const tab = activeTab();
  if (!tab || !tab.url) return;
  const url = tab.url;
  tab.frame.src = 'about:blank';
  setTimeout(() => navigate(url, { push: false, force: true, tab }), 60);
}

function updateNavButtons() {
  const tab = activeTab();
  $('#nav-back').disabled = !tab || tab.index <= 0;
  $('#nav-forward').disabled = !tab || tab.index >= tab.history.length - 1;
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
    button.addEventListener('click', () => void navigate(button.dataset.url));
  });
}

/* -------------------------------------------------------------- bookmark */
async function saveBookmark() {
  const tab = activeTab();
  if (!tab?.url) {
    toast('Open a page first', { type: 'info' });
    return;
  }
  const url = tab.url;
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
strip.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) {
    closeTab(close.dataset.close);
    return;
  }
  if (event.target.closest('#tab-new')) {
    newTab();
    return;
  }
  const tab = event.target.closest('[data-tab]');
  if (tab) activateTab(tab.dataset.tab);
});

$('#nav-back').addEventListener('click', goBack);
$('#nav-forward').addEventListener('click', goForward);
$('#nav-reload').addEventListener('click', reload);
$('#nav-home').addEventListener('click', () => showHome());
$('#bookmark').addEventListener('click', saveBookmark);
$('#go').addEventListener('click', () => void navigate(address.value));

$('#external').addEventListener('click', async () => {
  const tab = activeTab();
  if (!tab?.url) {
    toast('Nothing to open yet', { type: 'info' });
    return;
  }
  await browserTabs.open(tab.url);
  toast('Opened in a real browser tab', { type: 'info', iconName: 'external' });
});

$('#warning-external').addEventListener('click', () => {
  const tab = activeTab();
  if (tab?.url) openLinkedWindow(tab.url);
});

$('#blocked-focus').addEventListener('click', focusLinkedWindow);
$('#blocked-tab').addEventListener('click', () => {
  const tab = activeTab();
  if (tab?.blockedUrl) void browserTabs.open(tab.blockedUrl);
});
$('#blocked-copy').addEventListener('click', async () => {
  const url = activeTab()?.blockedUrl;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('URL copied', { type: 'success', iconName: 'copy' });
  } catch {
    toast(url, { title: 'URL', iconName: 'link' });
  }
});
$('#blocked-try').addEventListener('click', () => {
  const tab = activeTab();
  if (tab?.blockedUrl) void navigate(tab.blockedUrl, { push: false, force: true, tab });
});

address.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void navigate(address.value);
  }
  if (event.key === 'Escape') {
    const tab = activeTab();
    address.value = tab?.url || tab?.blockedUrl || '';
    address.blur();
  }
});

window.addEventListener('online', () => setStatus('Back online'));
window.addEventListener('offline', () => setStatus('Offline — RadonOS apps still work'));

/* ------------------------------------------------------------- shortcuts */
/**
 * Chrome, Edge and Firefox keep `Ctrl`+`W` / `Ctrl`+`T` / `Ctrl`+`Tab` /
 * `Alt`+`←` for themselves — a page never receives them, so no handler here
 * can take them back. Every action therefore also lives on an `Alt` chord,
 * which those browsers do deliver, and the `Ctrl` spellings stay for hosts
 * that pass them through (Electron, some PWA shells, the dev harness).
 */
function onShortcut(event) {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;

  if (event.altKey && !ctrl && !event.shiftKey) {
    if (key === 't') { event.preventDefault(); newTab(); return; }
    if (key === 'w') { event.preventDefault(); if (activeId) closeTab(activeId); return; }
    if (key === 'r') { event.preventDefault(); reload(); return; }
    if (key === 'a') { event.preventDefault(); address.focus(); address.select(); return; }
    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const tab = Number(key) === 9 ? tabList.at(-1) : tabList[Number(key) - 1];
      if (tab) activateTab(tab.id);
      return;
    }
  }

  if (ctrl && event.altKey) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); goForward(); return; }
  }

  if (ctrl && !event.altKey) {
    if (key === 'l') { event.preventDefault(); address.focus(); address.select(); return; }
    if (key === 'd') { event.preventDefault(); void saveBookmark(); return; }
    if (key === 't') { event.preventDefault(); newTab(); return; }
    if (key === 'w') { event.preventDefault(); if (activeId) closeTab(activeId); return; }
  }

  if (event.key === 'F5') reload();
}

document.addEventListener('keydown', onShortcut);

/* ------------------------------------------------------------------ boot */
(async () => {
  await loadSettings();
  await initTheme();
  paintIcons();

  const target = new URLSearchParams(location.search).get('url');
  if (target) {
    const tab = createTab();
    activateTab(tab.id);
    void navigate(target, { tab });
  } else {
    newTab();
  }
})();

