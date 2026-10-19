/**
 * FILE: newtab/controlCenter.js
 *
 * The quick-settings panel that slides up from the taskbar. It is the fast
 * lane for everything a user tweaks while working:
 *
 *   Display      brightness, glass blur / saturation, glass on-off
 *   Sound        master volume, system sounds
 *   Appearance   theme mode, colour palette
 *   Dock         bottom / top placement, running-app alignment
 *   Behaviour    reduce motion, 24-hour clock, seconds
 *
 * Sliders preview live through CSS custom properties and persist on `change`
 * (one write per gesture instead of one per pixel). Segmented controls persist
 * immediately. Every value round-trips through shared/settings.js, so the
 * Settings app and all open windows stay in sync.
 */
import { getSettings, updateSettings } from '../shared/settings.js';
import { PALETTES, DEFAULT_GLASS, GLASS_LIMITS, applyAppearance } from '../shared/theme.js';
import { icon } from '../shared/icons.js';
import { escapeHtml } from '../shared/ui.js';
import { setVolume, playClick } from '../shared/audio.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const percent = (value, min, max) => `${((Number(value) - min) / (max - min)) * 100}%`;

export function createControlCenter({ wm }) {
  const panel = document.querySelector('#control-center');
  const trigger = document.querySelector('#tray-control');
  if (!panel) {
    console.warn('[RadonOS] Control center markup is missing');
    return { open() {}, close() {}, toggle() {}, isOpen: () => false, refresh() {} };
  }

  let outsideBound = false;
  const isOpen = () => !panel.hidden;

  /* ------------------------------------------------------------ templates */
  function slider({ id, label, iconName, min, max, value, suffix = '', hint = '' }) {
    const safe = clamp(Number(value), min, max);
    return `
      <div class="cc-slider">
        <div class="cc-slider-head">
          <span class="cc-slider-label">${icon(iconName, { size: 14 })} ${escapeHtml(label)}</span>
          <span class="cc-value" id="${id}-value">${Math.round(safe)}${suffix}</span>
        </div>
        <input class="ros-range" id="${id}" type="range" min="${min}" max="${max}"
          step="1" value="${Math.round(safe)}" style="--fill:${percent(safe, min, max)}"
          aria-label="${escapeHtml(label)}">
        ${hint ? `<div class="cc-hint">${escapeHtml(hint)}</div>` : ''}
      </div>`;
  }

  function segmented({ id, label, options, value }) {
    return `
      <div class="cc-seg-row">
        <span class="cc-slider-label">${escapeHtml(label)}</span>
        <div class="ros-segmented" role="group" aria-label="${escapeHtml(label)}">
          ${options.map((option) => `
            <button type="button" data-seg="${id}" data-value="${option.value}"
              aria-pressed="${option.value === value}">${escapeHtml(option.label)}</button>`).join('')}
        </div>
      </div>`;
  }

  function toggleRow(id, label, checked) {
    return `
      <label class="cc-toggle">
        <span>${escapeHtml(label)}</span>
        <span class="ros-switch">
          <input type="checkbox" data-cc-toggle="${id}" ${checked ? 'checked' : ''}>
          <span class="ros-switch-track"></span>
        </span>
      </label>`;
  }

  function render() {
    const settings = getSettings();
    const glass = { ...DEFAULT_GLASS, ...(settings.glass || {}) };
    const [minBlur, maxBlur] = GLASS_LIMITS.blur;
    const [minSat, maxSat] = GLASS_LIMITS.saturation;
    const brightness = Math.round(clamp(Number(settings.brightness ?? 1), 0.35, 1) * 100);
    const volume = Math.round(clamp(Number(settings.volume ?? 0.45), 0, 1) * 100);
    const palette = settings.palette || 'midnight';
    const dock = settings.dock === 'top' ? 'top' : 'bottom';
    const align = ['start', 'center', 'end'].includes(settings.dockAlign) ? settings.dockAlign : 'center';

    panel.innerHTML = `
      <header class="cc-head">
        <span class="cc-head-icon">${icon('sliders', { size: 16 })}</span>
        <div class="cc-head-text">
          <strong>Control center</strong>
          <span>${settings.theme === 'auto' ? 'Following system theme' : `${settings.theme[0].toUpperCase()}${settings.theme.slice(1)} theme`} · ${palette}</span>
        </div>
        <button class="tb-btn cc-close" id="cc-close" title="Close" aria-label="Close control center">
          ${icon('close', { size: 15 })}
        </button>
      </header>

      <div class="cc-body">
        <section class="cc-group">
          <div class="cc-group-title">Display</div>
          ${slider({ id: 'cc-brightness', label: 'Brightness', iconName: 'sun', min: 35, max: 100, value: brightness, suffix: '%' })}
          ${slider({ id: 'cc-blur', label: 'Glass blur', iconName: 'eye', min: minBlur, max: maxBlur, value: glass.blur, suffix: 'px' })}
          ${slider({ id: 'cc-sat', label: 'Saturation', iconName: 'palette', min: Math.round(minSat * 100), max: Math.round(maxSat * 100), value: Math.round(glass.saturation * 100), suffix: '%' })}
          ${toggleRow('glass.enabled', 'Glass effects', glass.enabled !== false)}
        </section>

        <section class="cc-group">
          <div class="cc-group-title">Sound</div>
          ${slider({ id: 'cc-volume', label: 'Volume', iconName: volume === 0 ? 'volume-off' : 'volume', min: 0, max: 100, value: volume, suffix: '%' })}
          ${toggleRow('sounds', 'System sounds', settings.sounds !== false)}
        </section>

        <section class="cc-group">
          <div class="cc-group-title">Appearance</div>
          ${segmented({
    id: 'theme',
    label: 'Theme',
    value: settings.theme,
    options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }],
  })}
          <div class="cc-palettes" role="group" aria-label="Colour palette">
            ${PALETTES.map((item) => `
              <button type="button" class="ros-swatch" data-palette="${item.id}"
                style="background:linear-gradient(145deg, ${item.swatch}, color-mix(in srgb, ${item.swatch} 55%, #000))"
                title="${escapeHtml(`${item.name} — ${item.note}`)}"
                aria-pressed="${item.id === palette}" aria-label="${escapeHtml(item.name)}">
                ${item.id === palette ? icon('check', { size: 14 }) : ''}
              </button>`).join('')}
          </div>
        </section>

        <section class="cc-group">
          <div class="cc-group-title">Dock</div>
          ${segmented({
    id: 'dock',
    label: 'Position',
    value: dock,
    options: [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }],
  })}
          ${segmented({
    id: 'dockAlign',
    label: 'App strip',
    value: align,
    options: [{ value: 'start', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'Right' }],
  })}
        </section>

        <section class="cc-group">
          <div class="cc-group-title">Behaviour</div>
          ${toggleRow('reduceMotion', 'Reduce motion', settings.reduceMotion === true)}
          ${toggleRow('clock24', '24-hour clock', settings.clock24 !== false)}
          ${toggleRow('showSeconds', 'Show seconds', settings.showSeconds === true)}
        </section>
      </div>

      <footer class="cc-foot">
        <button class="ros-btn sm" id="cc-settings">${icon('settings', { size: 14 })} All settings</button>
        <span class="ros-spacer"></span>
        <span class="cc-foot-hint">Super + Space for search</span>
      </footer>`;

    wire();
  }

  /* --------------------------------------------------------------- wiring */
  function wire() {
    const brightnessEl = panel.querySelector('#cc-brightness');
    const blurEl = panel.querySelector('#cc-blur');
    const satEl = panel.querySelector('#cc-sat');
    const volumeEl = panel.querySelector('#cc-volume');

    const bindRange = (element, { onPreview, onCommit, suffix = '' }) => {
      if (!element) return;
      element.addEventListener('input', () => {
        const value = Number(element.value);
        element.style.setProperty('--fill', percent(value, Number(element.min), Number(element.max)));
        const label = panel.querySelector(`#${element.id}-value`);
        if (label) label.textContent = `${Math.round(value)}${suffix}`;
        onPreview?.(value);
      });
      element.addEventListener('change', () => {
        playClick();
        void onCommit(Number(element.value));
      });
    };

    bindRange(brightnessEl, {
      suffix: '%',
      onPreview: (value) => {
        document.documentElement.style.setProperty('--display-shade', ((1 - value / 100) * 0.8).toFixed(3));
      },
      onCommit: (value) => updateSettings({ brightness: value / 100 }),
    });

    bindRange(blurEl, {
      suffix: 'px',
      onPreview: (value) => document.documentElement.style.setProperty('--glass-blur', `${value}px`),
      onCommit: (value) => updateSettings({ glass: { ...getSettings().glass, blur: value } }),
    });

    bindRange(satEl, {
      suffix: '%',
      onPreview: (value) => document.documentElement.style.setProperty('--glass-sat', String(value / 100)),
      onCommit: (value) => updateSettings({ glass: { ...getSettings().glass, saturation: value / 100 } }),
    });

    bindRange(volumeEl, {
      suffix: '%',
      onPreview: (value) => setVolume(value / 100),
      onCommit: (value) => updateSettings({ volume: value / 100 }),
    });

    panel.querySelectorAll('[data-cc-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        playClick();
        const key = input.dataset.ccToggle;
        const [head, tail] = key.split('.');
        if (tail) void updateSettings({ [head]: { ...getSettings()[head], [tail]: input.checked } });
        else void updateSettings({ [key]: input.checked });
      });
    });

    panel.querySelectorAll('[data-seg]').forEach((button) => {
      button.addEventListener('click', async () => {
        playClick();
        await updateSettings({ [button.dataset.seg]: button.dataset.value });
        render();
      });
    });

    panel.querySelectorAll('[data-palette]').forEach((button) => {
      button.addEventListener('click', async () => {
        playClick();
        await updateSettings({ palette: button.dataset.palette });
        render();
      });
    });

    panel.querySelector('#cc-close')?.addEventListener('click', close);
    panel.querySelector('#cc-settings')?.addEventListener('click', () => {
      close();
      wm?.open?.('settings', { args: { section: 'appearance' } });
    });
  }

  /* --------------------------------------------------------- open / close */
  function onOutside(event) {
    if (panel.contains(event.target) || trigger?.contains(event.target)) return;
    if (event.target.closest?.('.ros-modal-backdrop, .ros-menu, #command-bar')) return;
    close();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  function open() {
    if (isOpen()) {
      refresh();
      return;
    }
    render();
    panel.hidden = false;
    panel.classList.remove('closing');
    trigger?.setAttribute('aria-expanded', 'true');
    trigger?.classList.add('open');
    setTimeout(() => {
      if (!isOpen()) return;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      outsideBound = true;
    }, 0);
  }

  function close() {
    if (!isOpen()) return;
    panel.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.classList.remove('open');
    if (outsideBound) {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      outsideBound = false;
    }
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function refresh() {
    if (isOpen()) {
      render();
      applyAppearance();
    }
  }

  trigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });

  return { open, close, toggle, isOpen, refresh };
}
