import { icon, radonMark } from './icons.js';

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE[char]);
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10485760 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(timestamp, { withTime = false } = {}) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const text = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  return withTime ? `${text}, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : text;
}

export function relativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return formatDate(timestamp);
}

export function debounce(fn, wait = 250) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Simple icon+label toast inside the current document. */
export function toast(message, { type = 'info', title = '', iconName = null, timeout = 3200 } = {}) {
  let stack = document.querySelector('.ros-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ros-toast-stack';
    document.body.appendChild(stack);
  }
  const node = document.createElement('div');
  node.className = `ros-toast ${type}`;
  const glyph = iconName || (type === 'error' ? 'alert' : type === 'success' ? 'check-circle' : 'info');
  node.innerHTML = `
    ${icon(glyph, { size: 17 })}
    <div class="ros-toast-body">
      ${title ? `<div class="ros-toast-title">${escapeHtml(title)}</div>` : ''}
      <div class="ros-toast-text">${escapeHtml(message)}</div>
    </div>`;
  stack.appendChild(node);
  const remove = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 190);
  };
  node.addEventListener('click', remove);
  setTimeout(remove, timeout);
  return remove;
}

/**
 * Promise-based modal.
 * actions: [{ label, value, variant, iconName }] - clicking resolves with value.
 */
export function showModal({
  title = '',
  subtitle = '',
  body = '',
  actions = [{ label: 'Close', value: null, variant: 'primary' }],
  iconName = null,
  width = 480,
  dismissible = true,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ros-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'ros-modal';
    modal.style.width = `min(${width}px, 100%)`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'ros-modal-head';
    head.innerHTML = `
      ${iconName ? `<span class="ros-modal-icon">${icon(iconName, { size: 19 })}</span>` : ''}
      <div style="min-width:0">
        <div class="ros-modal-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="ros-modal-sub">${escapeHtml(subtitle)}</div>` : ''}
      </div>`;
    modal.appendChild(head);

    const content = document.createElement('div');
    content.className = 'ros-modal-body';
    if (body instanceof Node) content.appendChild(body);
    else content.innerHTML = body;
    modal.appendChild(content);

    const foot = document.createElement('div');
    foot.className = 'ros-modal-foot';
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = `ros-btn ${action.variant || 'ghost'}`;
      button.type = 'button';
      if (action.iconName) button.innerHTML = icon(action.iconName, { size: 15 });
      button.appendChild(document.createTextNode(action.label));
      button.addEventListener('click', () => close(action.value));
      foot.appendChild(button);
    }
    modal.appendChild(foot);
    backdrop.appendChild(modal);

    let closed = false;
    function close(value = null) {
      if (closed) return;
      closed = true;
      backdrop.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => backdrop.remove(), 150);
      resolve(value);
    }

    function onKey(event) {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        close(null);
      }
    }

    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop && dismissible) close(null);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    setTimeout(() => {
      const focusable = modal.querySelector('input, textarea, select, button.primary, button');
      focusable?.focus?.();
      if (focusable?.select) focusable.select();
    }, 30);
  });
}

export function promptDialog({
  title = 'Rename',
  label = 'Name',
  value = '',
  placeholder = '',
  confirmText = 'Save',
  validate = null,
  iconName = 'edit',
} = {}) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="ros-field" style="margin-top:4px">
      <label for="ros-prompt-input">${escapeHtml(label)}</label>
      <input id="ros-prompt-input" class="ros-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false">
      <div class="ros-hint ros-prompt-error" style="color:var(--danger);display:none"></div>
    </div>`;
  const input = form.querySelector('input');
  const error = form.querySelector('.ros-prompt-error');

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ros-modal-backdrop';
    backdrop.innerHTML = `
      <div class="ros-modal" style="width:min(420px,100%)" role="dialog" aria-modal="true">
        <div class="ros-modal-head">
          <span class="ros-modal-icon">${icon(iconName, { size: 19 })}</span>
          <div><div class="ros-modal-title">${escapeHtml(title)}</div></div>
        </div>
        <div class="ros-modal-body"></div>
        <div class="ros-modal-foot">
          <button class="ros-btn ghost" data-action="cancel" type="button">Cancel</button>
          <button class="ros-btn primary" data-action="ok" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    backdrop.querySelector('.ros-modal-body').appendChild(form);

    const finish = (result) => {
      backdrop.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => backdrop.remove(), 140);
      resolve(result);
    };
    const submit = () => {
      const next = input.value.trim();
      const problem = validate ? validate(next) : (!next ? 'Please enter a value' : null);
      if (problem) {
        error.textContent = problem;
        error.style.display = 'block';
        input.focus();
        return;
      }
      finish(next);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(null);
      }
    };

    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
    backdrop.querySelector('[data-action="ok"]').addEventListener('click', submit);
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) finish(null);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export async function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  iconName = 'alert',
} = {}) {
  const result = await showModal({
    title,
    body: `<p>${escapeHtml(message)}</p>`,
    iconName,
    width: 420,
    actions: [
      { label: cancelText, value: false, variant: 'ghost' },
      { label: confirmText, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}

/**
 * items: [{ label, iconName, shortcut, danger, disabled, action }, { separator: true }]
 */
export function showContextMenu(items, x, y) {
  document.querySelector('.ros-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'ros-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      const line = document.createElement('div');
      line.className = 'ros-menu-sep';
      menu.appendChild(line);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ros-menu-item${item.danger ? ' danger' : ''}`;
    button.disabled = !!item.disabled;
    button.innerHTML = `
      ${item.iconName ? icon(item.iconName, { size: 16 }) : '<span style="width:16px"></span>'}
      <span>${escapeHtml(item.label)}</span>
      ${item.shortcut ? `<span class="shortcut">${escapeHtml(item.shortcut)}</span>` : ''}`;
    button.addEventListener('click', () => {
      close();
      item.action?.();
    });
    menu.appendChild(button);
  }

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.visibility = '';

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
  };
  const onOutside = (event) => {
    if (!menu.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
  }, 0);

  return close;
}

export function emptyState(iconName, text) {
  return `<div class="ros-empty">${icon(iconName, { size: 28 })}<span>${escapeHtml(text)}</span></div>`;
}

/** Fill every [data-icon] placeholder inside `root` (idempotent). */
export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (node.dataset.painted === '1') return;
    const name = node.dataset.icon;
    const size = Number(node.dataset.size) || 18;
    node.innerHTML = name === 'mark' ? radonMark(size) : icon(name, { size });
    node.dataset.painted = '1';
  });
}

/**
 * Launch another RadonOS app. Uses the desktop API when running inside a
 * RadonOS window and falls back to a plain tab during development.
 */
export function openApp(appId, args = {}) {
  const host = window.parent && window.parent !== window ? window.parent : null;
  const api = host?.RadonOS;
  if (api?.openApp) return api.openApp(appId, args);
  const url = new URL(`../${appId}/index.html`, document.baseURI);
  for (const [key, value] of Object.entries(args)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  window.open(url.toString(), '_blank');
  return null;
}

/** Notify through the desktop taskbar when available, otherwise toast locally. */
export function notifyOwner(payload) {
  const host = window.parent && window.parent !== window ? window.parent : null;
  if (host?.RadonOS?.notify) {
    host.RadonOS.notify(payload);
    return;
  }
  toast(payload.body || '', { title: payload.title, type: payload.type, iconName: payload.iconName });
}

/** Window id of this app instance, when launched by the desktop. */
export function windowId() {
  return new URLSearchParams(location.search).get('wid');
}

/** Ask the desktop to close this window (terminal `exit`, etc). */
export function closeSelf() {
  const host = window.parent && window.parent !== window ? window.parent : null;
  const id = windowId();
  if (host?.RadonOS?.windows && id) {
    host.RadonOS.windows.close(id);
    return true;
  }
  return false;
}
