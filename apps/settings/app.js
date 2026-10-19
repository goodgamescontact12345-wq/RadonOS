import { icon, radonMark } from '../../shared/icons.js';
import { APPS, OS_VERSION, OS_CODENAME } from '../../shared/registry.js';
import { getSettings, loadSettings, updateSettings, resetSettings, replaceSettings } from '../../shared/settings.js';
import { initTheme, applyWallpaper, WALLPAPERS, ACCENTS, PALETTES, DEFAULT_GLASS, GLASS_LIMITS } from '../../shared/theme.js';
import { idb } from '../../shared/idb.js';
import * as FS from '../../shared/fs.js';
import {
  confirmDialog, toast, paintIcons, escapeHtml, formatBytes, formatDate, openApp,
} from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

/* ------------------------------------------------------------ navigation */

const CATEGORIES = [
  {
    id: 'appearance',
    title: 'Appearance',
    sub: 'Theme, colour and wallpaper',
    icon: 'palette',
    blurb: 'Make RadonOS look like yours. Theme, accent, palette, glass and wallpaper are shared by every window and menu.',
    items: [
      {
        id: 'theme',
        title: 'Theme mode',
        sub: 'Dark, light or follow the system',
        icon: 'sun',
        render: renderThemeMode,
        summary: (settings) => settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1),
      },
      {
        id: 'accent',
        title: 'Accent colour',
        sub: 'Highlights, focus rings and taskbar glow',
        icon: 'palette',
        render: renderAccentColour,
        summary: (settings) => ACCENTS.find((item) => item.value.toLowerCase() === settings.accent.toLowerCase())?.name || 'Custom',
      },
      {
        id: 'palette',
        title: 'Colour palette',
        sub: 'Retint every glass surface',
        icon: 'sliders',
        render: renderColourPalette,
        summary: () => {
          const settings = getSettings();
          return PALETTES.find((item) => item.id === settings.palette)?.name || 'Midnight';
        },
      },
      {
        id: 'glass',
        title: 'Liquid glass',
        sub: 'Blur, saturation and brightness',
        icon: 'eye',
        render: renderLiquidGlass,
        summary: (settings) => ((settings.glass || {}).enabled === false ? 'Off' : `${(settings.glass || {}).blur ?? DEFAULT_GLASS.blur}px blur`),
      },
      {
        id: 'wallpaper',
        title: 'Wallpaper',
        sub: 'Presets, custom images and dimming',
        icon: 'image',
        render: renderWallpaper,
        summary: (settings) => (settings.wallpaper.type === 'preset'
          ? WALLPAPERS.find((item) => item.id === settings.wallpaper.value)?.name || 'Preset'
          : settings.wallpaper.type === 'image' ? 'Custom image' : 'Image URL'),
      },
    ],
  },
  {
    id: 'desktop',
    title: 'Desktop',
    sub: 'Widgets, icons, dock and behaviour',
    icon: 'monitor',
    blurb: 'Tune the desktop itself: which widgets sit on the right edge, how icons behave, where the dock lives and how much motion you want.',
    items: [
      {
        id: 'widgets',
        title: 'Widgets',
        sub: 'Weather, notes, bookmarks and performance',
        icon: 'grid',
        render: renderWidgets,
        summary: (settings) => `${Object.values(settings.widgets).filter(Boolean).length} of 4 visible`,
      },
      {
        id: 'icons',
        title: 'Desktop icons',
        sub: 'Labels, shortcuts and layout',
        icon: 'folder',
        render: renderDesktopIcons,
        summary: (settings) => (settings.iconLabels ? 'Labels shown' : 'Labels hidden'),
      },
      {
        id: 'dock',
        title: 'Dock',
        sub: 'Position and app alignment',
        icon: 'monitor',
        render: renderDock,
        summary: (settings) => `${settings.dock === 'top' ? 'Top' : 'Bottom'} · ${(settings.dockAlign || 'center').replace(/^./, (c) => c.toUpperCase())}`,
      },
      {
        id: 'behaviour',
        title: 'Behaviour',
        sub: 'Startup, motion and clock precision',
        icon: 'zap',
        render: renderBehaviour,
        summary: (settings) => (settings.reduceMotion ? 'Reduced motion' : 'Standard motion'),
      },
    ],
  },
  {
    id: 'system',
    title: 'System',
    sub: 'User, clock, sound and session',
    icon: 'sliders',
    blurb: 'Local identity and how RadonOS feels while you use it: your display name, clock format, system sounds and session controls.',
    items: [
      {
        id: 'user',
        title: 'Local user',
        sub: 'Display name for menus and the lock screen',
        icon: 'user',
        render: renderLocalUser,
        summary: (settings) => settings.userName,
      },
      {
        id: 'clock',
        title: 'Clock',
        sub: '24-hour time, seconds and badge',
        icon: 'clock',
        render: renderClock,
        summary: (settings) => `${settings.clock24 ? '24-hour' : '12-hour'}${settings.showSeconds ? ' · seconds' : ''}`,
      },
      {
        id: 'sound',
        title: 'Sound',
        sub: 'System sounds and master volume',
        icon: 'volume',
        render: renderSound,
        summary: (settings) => `${Math.round((settings.volume ?? 0.45) * 100)}%`,
      },
      {
        id: 'session',
        title: 'Session',
        sub: 'Restart or jump to a tool',
        icon: 'power',
        render: renderSession,
        summary: () => 'Running',
      },
    ],
  },
  {
    id: 'storage',
    title: 'Storage',
    sub: 'Disk usage, backup and cleanup',
    icon: 'database',
    blurb: 'Everything RadonOS keeps lives in this browser profile. Inspect the virtual disk, export a backup or start over.',
    items: [
      {
        id: 'disk',
        title: 'Virtual disk',
        sub: 'Files, folders and quota usage',
        icon: 'database',
        render: renderVirtualDisk,
        summary: () => 'Local IndexedDB',
      },
      {
        id: 'backup',
        title: 'Backup',
        sub: 'Export or import your data',
        icon: 'save',
        render: renderBackup,
        summary: () => 'JSON export',
      },
      {
        id: 'cleanup',
        title: 'Cleanup',
        sub: 'Trash, reset and erase',
        icon: 'trash',
        render: renderCleanup,
        summary: () => 'Destructive actions',
      },
    ],
  },
  {
    id: 'about',
    title: 'About',
    sub: `RadonOS ${OS_VERSION} “${OS_CODENAME}”`,
    icon: 'info',
    blurb: 'Version, runtime details and every keyboard shortcut. RadonOS is offline-first: no account, no telemetry and no remote assets.',
    items: [
      {
        id: 'overview',
        title: 'About RadonOS',
        sub: 'Version, features and live runtime',
        icon: 'info',
        render: renderAboutOverview,
        summary: () => `Version ${OS_VERSION}`,
      },
      {
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        sub: 'Every shortcut in one place',
        icon: 'terminal',
        render: renderShortcuts,
        summary: () => '9 shortcuts',
      },
    ],
  },
];

let activeCategory = 'appearance';
let activeItem = null;

function go(categoryId, itemId = null) {
  activeCategory = categoryId;
  activeItem = itemId;
  renderNav();
  void render();
}

/* ------------------------------------------------------------- utilities */
function group({ title, sub = '', iconName = 'settings', body = '', right = '', danger = false }) {
  return `
    <section class="group${danger ? ' danger-zone' : ''}">
      <div class="group-head">
        ${icon(iconName, { size: 15 })}
        <div>
          <div class="group-title">${escapeHtml(title)}</div>
          ${sub ? `<div class="group-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        <span class="ros-spacer"></span>
        ${right}
      </div>
      <div class="group-body">${body}</div>
    </section>`;
}

function row({ label, hint = '', control = '', wide = false }) {
  return `
    <div class="setting-row">
      <div class="setting-text">
        <span class="setting-label">${escapeHtml(label)}</span>
        ${hint ? `<span class="setting-hint">${hint}</span>` : ''}
      </div>
      <div class="setting-control${wide ? ' wide' : ''}">${control}</div>
    </div>`;
}

const toggle = (key, checked) => `
  <label class="ros-switch">
    <input type="checkbox" data-toggle="${key}" ${checked ? 'checked' : ''}>
    <span class="ros-switch-track"></span>
  </label>`;

function wireToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.toggle;
      const path = key.split('.');
      if (path.length === 1) {
        void updateSettings({ [key]: input.checked });
      } else {
        void updateSettings({ [path[0]]: { [path[1]]: input.checked } });
      }
    });
  });
}

/* ------------------------------------------------------------ appearance */
function renderThemeMode(root) {
  const settings = getSettings();
  const mode = document.documentElement.dataset.theme || 'dark';

  root.innerHTML = group({
    title: 'Theme mode',
    sub: 'Applies instantly to every RadonOS window',
    iconName: 'sun',
    body: `
      <div class="theme-grid">
        ${[
          { id: 'dark', name: 'Dark', note: 'Default low-light palette' },
          { id: 'light', name: 'Light', note: 'Bright, high-contrast' },
          { id: 'auto', name: 'Auto', note: 'Follow the operating system' },
        ].map((option) => `
          <button class="theme-card${settings.theme === option.id ? ' active' : ''}" data-theme-mode="${option.id}">
            <div class="theme-preview ${option.id}"><i></i><i></i><i></i></div>
            <div>
              <div class="theme-name">${option.name}</div>
              <div class="theme-note">${option.note}</div>
            </div>
          </button>`).join('')}
      </div>
      <div class="setting-hint">Currently rendering the <b>${mode}</b> palette${
  settings.theme === 'auto' ? ' (auto-selected)' : ''}.</div>`,
  });

  root.querySelectorAll('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({ theme: button.dataset.themeMode });
      render();
    });
  });

  paintIcons(root);
}

function renderAccentColour(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Accent colour',
    sub: 'Used for highlights, focus rings and the taskbar glow',
    iconName: 'palette',
    body: `
      <div class="swatches">
        ${ACCENTS.map((accent) => `
          <button class="swatch${settings.accent.toLowerCase() === accent.value.toLowerCase() ? ' active' : ''}"
            data-accent="${accent.value}" title="${accent.name}" style="background:${accent.value}"></button>`).join('')}
        <input class="color-input" type="color" id="accent-custom" value="${settings.accent}" title="Custom accent">
        <button class="ros-btn sm ghost" id="accent-reset">Reset to default</button>
      </div>`,
  });

  root.querySelectorAll('[data-accent]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({ accent: button.dataset.accent });
      render();
    });
  });

  $('#accent-custom').addEventListener('input', (event) => {
    void updateSettings({ accent: event.target.value });
    void applyWallpaper();
  });
  $('#accent-reset').addEventListener('click', async () => {
    await updateSettings({ accent: '#5b9dff' });
    render();
  });

  paintIcons(root);
}

function renderColourPalette(root) {
  const settings = getSettings();
  const paletteId = PALETTES.some((item) => item.id === settings.palette) ? settings.palette : 'midnight';
  const palette = PALETTES.find((item) => item.id === paletteId);

  root.innerHTML = group({
    title: 'Colour palette',
    sub: 'Retints every glass surface in both light and dark mode',
    iconName: 'palette',
    body: `
      <div class="swatches">
        ${PALETTES.map((item) => `
          <button class="swatch${paletteId === item.id ? ' active' : ''}"
            data-palette="${item.id}" title="${item.name} — ${item.note}"
            style="background:linear-gradient(145deg, ${item.swatch}, color-mix(in srgb, ${item.swatch} 45%, #000))"></button>`).join('')}
      </div>
      <div class="setting-hint">Active: <b>${palette.name}</b> — ${palette.note}. Every open window repaints immediately.</div>`,
  });

  root.querySelectorAll('[data-palette]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({ palette: button.dataset.palette });
      render();
      toast(`Palette: ${button.dataset.palette}`, { type: 'success', iconName: 'palette', timeout: 1600 });
    });
  });

  paintIcons(root);
}

function renderLiquidGlass(root) {
  const settings = getSettings();
  const glass = { ...DEFAULT_GLASS, ...(settings.glass || {}) };
  const brightness = Math.round((settings.brightness ?? 1) * 100);

  root.innerHTML = group({
    title: 'Liquid glass',
    sub: 'Blur, saturation and brightness for translucent surfaces',
    iconName: 'eye',
    body: `
      ${row({ label: 'Glass effects', hint: 'Turn off for a flat, higher-contrast look', control: toggle('glass.enabled', glass.enabled !== false) })}
      ${row({
    label: 'Blur intensity',
    hint: 'Applies to the taskbar, menus, windows and the command bar',
    wide: true,
    control: `
          <input type="range" class="ros-range" id="glass-blur" min="${GLASS_LIMITS.blur[0]}" max="${GLASS_LIMITS.blur[1]}"
            value="${glass.blur}" style="--fill:${((glass.blur - GLASS_LIMITS.blur[0]) / (GLASS_LIMITS.blur[1] - GLASS_LIMITS.blur[0])) * 100}%">
          <span class="vol-value" id="glass-blur-value">${glass.blur}px</span>`,
  })}
      ${row({
    label: 'Saturation',
    hint: 'Pushes colours behind the glass further from grey',
    wide: true,
    control: `
          <input type="range" class="ros-range" id="glass-sat" min="${Math.round(GLASS_LIMITS.saturation[0] * 100)}" max="${Math.round(GLASS_LIMITS.saturation[1] * 100)}"
            value="${Math.round(glass.saturation * 100)}" style="--fill:${((glass.saturation - GLASS_LIMITS.saturation[0]) / (GLASS_LIMITS.saturation[1] - GLASS_LIMITS.saturation[0])) * 100}%">
          <span class="vol-value" id="glass-sat-value">${Math.round(glass.saturation * 100)}%</span>`,
  })}
      ${row({
    label: 'Brightness',
    hint: 'Dims the whole desktop with an overlay — app colours stay untouched',
    wide: true,
    control: `
          <input type="range" class="ros-range" id="brightness" min="35" max="100" value="${brightness}"
            style="--fill:${((brightness - 35) / 65) * 100}%">
          <span class="vol-value" id="brightness-value">${brightness}%</span>`,
  })}`,
  });

  wireToggles(root);

  // Glass controls preview through CSS variables and persist on release, so
  // dragging a slider writes once instead of once per pixel.
  const glassBlur = $('#glass-blur');
  glassBlur.addEventListener('input', () => {
    const value = Number(glassBlur.value);
    $('#glass-blur-value').textContent = `${value}px`;
    document.documentElement.style.setProperty('--glass-blur', `${value}px`);
  });
  glassBlur.addEventListener('change', () => {
    void updateSettings({ glass: { ...getSettings().glass, blur: Number(glassBlur.value) } });
  });

  const glassSat = $('#glass-sat');
  glassSat.addEventListener('input', () => {
    const value = Number(glassSat.value) / 100;
    $('#glass-sat-value').textContent = `${Math.round(value * 100)}%`;
    document.documentElement.style.setProperty('--glass-sat', String(value));
  });
  glassSat.addEventListener('change', () => {
    void updateSettings({ glass: { ...getSettings().glass, saturation: Number(glassSat.value) / 100 } });
  });

  const brightnessSlider = $('#brightness');
  brightnessSlider.addEventListener('input', () => {
    const value = Number(brightnessSlider.value);
    $('#brightness-value').textContent = `${value}%`;
    document.documentElement.style.setProperty('--display-shade', ((1 - value / 100) * 0.8).toFixed(3));
  });
  brightnessSlider.addEventListener('change', () => {
    void updateSettings({ brightness: Number(brightnessSlider.value) / 100 });
  });

  paintIcons(root);
}

function renderWallpaper(root) {
  const settings = getSettings();
  const isCustomImage = settings.wallpaper.type === 'image';
  const isCustomUrl = settings.wallpaper.type === 'url';

  root.innerHTML = group({
    title: 'Wallpaper',
    sub: 'Gradients ship with RadonOS; images are stored locally',
    iconName: 'image',
    body: `
      <div class="wallpaper-grid">
        ${WALLPAPERS.map((wallpaper) => `
          <button class="wallpaper-card${settings.wallpaper.type === 'preset' && settings.wallpaper.value === wallpaper.id ? ' active' : ''}"
            data-preset="${wallpaper.id}">
            <div class="wallpaper-preview" style="background:${wallpaper.css}"></div>
            <div class="wallpaper-name">${wallpaper.name}</div>
          </button>`).join('')}
      </div>
      ${row({
    label: 'Custom image URL',
    hint: 'Paste a direct link to an image (https://…/wallpaper.jpg)',
    wide: true,
    control: `
          <input class="ros-input" id="wallpaper-url" placeholder="https://example.com/wallpaper.jpg" value="${isCustomUrl ? escapeHtml(settings.wallpaper.value) : ''}">
          <button class="ros-btn sm" id="wallpaper-url-apply">Apply</button>`,
  })}
      ${row({
    label: 'Upload an image',
    hint: 'Resized to 2560px and stored in IndexedDB — never uploaded anywhere',
    control: `
          <button class="ros-btn sm" id="wallpaper-upload"><span data-icon="upload" data-size="15"></span> Choose file</button>
          <input type="file" id="wallpaper-file" accept="image/*" hidden>
          ${isCustomImage ? '<span class="ros-badge" title="Custom image in use">active</span>' : ''}`,
  })}
      ${row({
    label: 'Dim overlay',
    hint: 'Darkens the wallpaper so icons stay readable',
    wide: true,
    control: `
          <input type="range" id="dim" min="0" max="60" value="${Math.round((settings.wallpaper.dim ?? 0.22) * 100)}" style="flex:1;accent-color:var(--accent)">
          <span class="vol-value" id="dim-value">${Math.round((settings.wallpaper.dim ?? 0.22) * 100)}%</span>`,
  })}
      ${row({
    label: 'Wallpaper blur',
    hint: 'Softens busy wallpapers behind windows',
    wide: true,
    control: `
          <input type="range" id="blur" min="0" max="24" value="${settings.wallpaper.blur ?? 0}" style="flex:1;accent-color:var(--accent)">
          <span class="vol-value" id="blur-value">${settings.wallpaper.blur ?? 0}px</span>`,
  })}`,
  });

  root.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({
        wallpaper: { ...getSettings().wallpaper, type: 'preset', value: button.dataset.preset },
      });
      await applyWallpaper();
      render();
    });
  });

  $('#wallpaper-url-apply').addEventListener('click', async () => {
    const value = $('#wallpaper-url').value.trim();
    if (!/^https?:\/\/\S+/i.test(value)) {
      toast('Enter a full http(s) image URL', { type: 'error' });
      return;
    }
    await updateSettings({ wallpaper: { ...getSettings().wallpaper, type: 'url', value } });
    await applyWallpaper();
    toast('Wallpaper updated', { type: 'success', iconName: 'image' });
    render();
  });

  $('#wallpaper-upload').addEventListener('click', () => $('#wallpaper-file').click());
  $('#wallpaper-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const blob = await downscale(file, 2560);
      await idb.put('kv', blob, 'wallpaper:image');
      await updateSettings({ wallpaper: { ...getSettings().wallpaper, type: 'image', value: 'custom' } });
      await applyWallpaper();
      toast(`Wallpaper set (${formatBytes(blob.size)})`, { type: 'success', iconName: 'image' });
      render();
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not read image' });
    }
    event.target.value = '';
  });

  const dim = $('#dim');
  dim.addEventListener('input', () => {
    const value = Number(dim.value);
    $('#dim-value').textContent = `${value}%`;
    document.documentElement.style.setProperty('--wallpaper-dim', String(value / 100));
  });
  dim.addEventListener('change', () => {
    void updateSettings({ wallpaper: { ...getSettings().wallpaper, dim: Number(dim.value) / 100 } });
  });

  const blur = $('#blur');
  blur.addEventListener('input', () => {
    const value = Number(blur.value);
    $('#blur-value').textContent = `${value}px`;
    document.documentElement.style.setProperty('--wallpaper-blur', `${value}px`);
  });
  blur.addEventListener('change', () => {
    void updateSettings({ wallpaper: { ...getSettings().wallpaper, blur: Number(blur.value) } });
  });

  paintIcons(root);
}

async function downscale(file, maxWidth) {
  if (!file.type.startsWith('image/')) throw new Error('Not an image file');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.88);
  });
}

/* --------------------------------------------------------------- desktop */
function renderWidgets(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Widgets',
    sub: 'Cards docked to the right edge of the desktop',
    iconName: 'grid',
    body: [
      row({ label: 'Weather', hint: 'Live forecast from Open-Meteo, cached for 30 minutes', control: toggle('widgets.weather', settings.widgets.weather) }),
      row({ label: 'Sticky note', hint: 'A scratchpad that autosaves to settings', control: toggle('widgets.notes', settings.widgets.notes) }),
      row({ label: 'Bookmarks', hint: 'Quick links that also open in the RadonOS browser', control: toggle('widgets.bookmarks', settings.widgets.bookmarks) }),
      row({ label: 'Performance monitor', hint: 'JS heap, storage quota, window count and uptime', control: toggle('widgets.monitor', settings.widgets.monitor) }),
      row({
        label: 'Weather city',
        hint: 'Any city name Open-Meteo can geocode',
        control: `<input class="ros-input" id="weather-city" value="${escapeHtml(settings.weatherCity)}" style="width:180px">
          <select class="ros-select" id="weather-unit" style="width:92px">
            <option value="c" ${settings.weatherUnit === 'c' ? 'selected' : ''}>°C</option>
            <option value="f" ${settings.weatherUnit === 'f' ? 'selected' : ''}>°F</option>
          </select>
          <button class="ros-btn sm ghost" id="weather-refresh">Refresh</button>`,
      }),
    ].join(''),
  });

  wireToggles(root);
  paintIcons(root);

  $('#weather-city').addEventListener('change', (event) => {
    void updateSettings({ weatherCity: event.target.value.trim() || 'Amsterdam' });
  });
  $('#weather-unit').addEventListener('change', (event) => {
    void updateSettings({ weatherUnit: event.target.value });
  });
  $('#weather-refresh').addEventListener('click', () => {
    try {
      localStorage.removeItem('radonos:weather-cache');
      sessionStorage.removeItem('radonos:weather-cache');
    } catch { /* ignore */ }
    window.parent?.RadonOS?.widgets?.refresh?.();
    toast('Weather cache cleared', { type: 'success', iconName: 'refresh' });
  });
}

function renderDesktopIcons(root) {
  const settings = getSettings();
  const shortcuts = settings.shortcuts || [];

  root.innerHTML = group({
    title: 'Desktop icons',
    sub: 'Shortcuts and their labels',
    iconName: 'folder',
    body: [
      row({ label: 'Show icon labels', hint: 'Hide names to keep the desktop minimal', control: toggle('iconLabels', settings.iconLabels) }),
      row({
        label: 'Shortcuts',
        hint: `${shortcuts.length} custom shortcut${shortcuts.length === 1 ? '' : 's'} on the desktop`,
        control: `
          <button class="ros-btn sm ghost" id="clear-shortcuts" ${shortcuts.length ? '' : 'disabled'}>Remove all</button>`,
      }),
      row({
        label: 'Icon layout',
        hint: 'Reorder by dragging icons. Sorting is also available in the desktop context menu.',
        control: '<button class="ros-btn sm ghost" id="reset-layout">Reset layout</button>',
      }),
    ].join(''),
  });

  wireToggles(root);
  paintIcons(root);

  $('#clear-shortcuts').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Remove all desktop shortcuts?',
      message: 'Only the shortcuts are removed. RadonOS apps and files stay untouched.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await updateSettings({ shortcuts: [] });
    render();
    toast('Shortcuts removed', { type: 'success' });
  });

  $('#reset-layout').addEventListener('click', async () => {
    await updateSettings({ iconOrder: ['app:explorer', 'app:notepad', 'app:terminal', 'app:browser', 'app:media', 'app:settings'] });
    render();
    toast('Icon layout reset', { type: 'success' });
  });
}

function renderDock(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Dock',
    sub: 'Where the taskbar sits and how running apps align',
    iconName: 'monitor',
    body: [
      row({
        label: 'Position',
        hint: 'A top dock moves the window layer, popovers and start menu with it',
        control: `
          <div class="ros-segmented" role="group" aria-label="Dock position">
            ${[['bottom', 'Bottom'], ['top', 'Top']].map(([value, label]) => `
              <button type="button" data-dock-pos="${value}" aria-pressed="${settings.dock === value}">${label}</button>`).join('')}
          </div>`,
      }),
      row({
        label: 'App strip',
        hint: 'Alignment of running-app buttons inside the dock',
        control: `
          <div class="ros-segmented" role="group" aria-label="Dock alignment">
            ${[['start', 'Left'], ['center', 'Center'], ['end', 'Right']].map(([value, label]) => `
              <button type="button" data-dock-align="${value}" aria-pressed="${(settings.dockAlign || 'center') === value}">${label}</button>`).join('')}
          </div>`,
      }),
    ].join(''),
  });

  paintIcons(root);

  root.querySelectorAll('[data-dock-pos]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({ dock: button.dataset.dockPos });
      render();
    });
  });
  root.querySelectorAll('[data-dock-align]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateSettings({ dockAlign: button.dataset.dockAlign });
      render();
    });
  });
}

function renderBehaviour(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Behaviour',
    sub: 'Startup and motion preferences',
    iconName: 'zap',
    body: [
      row({ label: 'Boot animation', hint: 'Show the RadonOS splash when a new tab opens', control: toggle('bootAnimation', settings.bootAnimation) }),
      row({ label: 'Reduce motion', hint: 'Disable window and widget animations', control: toggle('reduceMotion', settings.reduceMotion) }),
      row({ label: 'Show seconds in clock', hint: 'Taskbar clock precision', control: toggle('showSeconds', settings.showSeconds) }),
    ].join(''),
  });

  wireToggles(root);
  paintIcons(root);
}

/* ---------------------------------------------------------------- system */
function renderLocalUser(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Local user',
    sub: 'RadonOS is offline-first: this name never leaves your device',
    iconName: 'user',
    body: row({
      label: 'Display name',
      hint: 'Shown in the start menu and lock screen',
      control: `<input class="ros-input" id="user-name" value="${escapeHtml(settings.userName)}" style="width:200px">`,
    }),
  });

  paintIcons(root);

  $('#user-name').addEventListener('change', (event) => {
    void updateSettings({ userName: event.target.value.trim() || 'Radon User' });
  });
}

function renderClock(root) {
  const settings = getSettings();

  root.innerHTML = group({
    title: 'Clock',
    sub: 'Formatting for the taskbar, calendar and lock screen',
    iconName: 'clock',
    body: [
      row({ label: '24-hour clock', hint: 'Turn off for AM/PM', control: toggle('clock24', settings.clock24) }),
      row({ label: 'Seconds', hint: 'Show seconds in the taskbar clock', control: toggle('showSeconds', settings.showSeconds) }),
      row({ label: 'Badge clock', hint: 'Show the time on the extension toolbar icon (refreshes every minute)', control: toggle('badgeClock', settings.badgeClock) }),
    ].join(''),
  });

  wireToggles(root);
  paintIcons(root);
}

function renderSound(root) {
  const settings = getSettings();
  const volume = Math.round((settings.volume ?? 0.45) * 100);

  root.innerHTML = group({
    title: 'Sound',
    sub: 'Synthesised locally with the Web Audio API',
    iconName: 'volume',
    body: [
      row({ label: 'System sounds', hint: 'Clicks, window opens and notification chimes', control: toggle('sounds', settings.sounds) }),
      row({
        label: 'Master volume',
        hint: 'Shared by every RadonOS window',
        wide: true,
        control: `
          <input type="range" id="volume" min="0" max="100" value="${volume}" style="flex:1;accent-color:var(--accent)">
          <span class="vol-value" id="volume-value">${volume}%</span>`,
      }),
    ].join(''),
  });

  wireToggles(root);
  paintIcons(root);

  const slider = $('#volume');
  slider.addEventListener('input', () => {
    $('#volume-value').textContent = `${slider.value}%`;
  });
  slider.addEventListener('change', () => {
    void updateSettings({ volume: Number(slider.value) / 100 });
  });
}

function renderSession(root) {
  root.innerHTML = group({
    title: 'Session',
    sub: 'Restart RadonOS or jump straight to a tool',
    iconName: 'power',
    body: row({
      label: 'Desktop session',
      hint: 'Restart reloads the desktop and restores your open windows',
      control: `
        <button class="ros-btn sm ghost" id="open-terminal">Open terminal</button>
        <button class="ros-btn sm ghost" id="lock-now">Lock screen</button>
        <button class="ros-btn sm" id="restart">Restart RadonOS</button>`,
    }),
  });

  paintIcons(root);

  $('#open-terminal').addEventListener('click', () => openApp('terminal'));
  $('#lock-now').addEventListener('click', () => window.parent?.RadonOS?.taskbar?.lockScreen?.());
  $('#restart').addEventListener('click', () => window.location.reload());
}

/* --------------------------------------------------------------- storage */
async function renderVirtualDisk(root) {
  const stats = await FS.stats();
  const estimate = await navigator.storage?.estimate?.().catch(() => null) || null;
  const quota = estimate?.quota || 0;
  const used = estimate?.usage || stats.bytes;
  const percent = quota ? Math.min(100, (used / quota) * 100) : 0;

  root.innerHTML = group({
    title: 'Virtual disk',
    sub: 'IndexedDB database “radonos” in this browser profile',
    iconName: 'database',
    body: `
      <div class="stat-grid">
        <div class="stat-card">
          <span class="stat-label">Files stored</span>
          <span class="stat-value">${stats.files}</span>
          <span class="stat-sub">${stats.folders} folders · ${stats.trash} in trash</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Virtual disk size</span>
          <span class="stat-value">${formatBytes(stats.bytes)}</span>
          <span class="stat-sub">sum of stored file contents</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Browser origin usage</span>
          <span class="stat-value">${formatBytes(used)}</span>
          <span class="stat-sub">${quota ? `of ${formatBytes(quota)} quota` : 'quota not reported'}</span>
          ${quota ? `<div class="bar"><span style="width:${percent}%"></span></div>` : ''}
        </div>
        <div class="stat-card">
          <span class="stat-label">Settings size</span>
          <span class="stat-value">${formatBytes(new Blob([JSON.stringify(getSettings())]).size)}</span>
          <span class="stat-sub">chrome.storage.local</span>
        </div>
      </div>
      <p class="setting-hint" style="margin-top:10px">RadonOS only writes to this profile's own origin.
      Clearing browsing data removes everything; use the backup options first.</p>`,
  });

  paintIcons(root);
}

function renderBackup(root) {
  root.innerHTML = group({
    title: 'Backup',
    sub: 'Export or restore settings, text files and folders',
    iconName: 'save',
    body: [
      row({
        label: 'Export data',
        hint: 'Downloads a JSON file with your settings and every text file',
        control: '<button class="ros-btn sm" id="export"><span data-icon="download" data-size="15"></span> Export</button>',
      }),
      row({
        label: 'Import data',
        hint: 'Replaces current settings and merges text files back into the file system',
        control: `
          <button class="ros-btn sm ghost" id="import"><span data-icon="upload" data-size="15"></span> Choose file</button>
          <input type="file" id="import-file" accept="application/json" hidden>`,
      }),
    ].join(''),
  });

  paintIcons(root);

  $('#export').addEventListener('click', async () => {
    const payload = {
      application: 'RadonOS',
      version: OS_VERSION,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      files: [],
      folders: [],
    };
    const nodes = await FS.allNodes();
    for (const node of nodes) {
      if (node.id === FS.ROOT_ID) continue;
      const path = await FS.pathString(node.id);
      if (node.kind === 'folder') {
        payload.folders.push(path);
      } else if (FS.kindForMime(node.mime) === 'text') {
        payload.files.push({
          path,
          mime: node.mime,
          updatedAt: node.updatedAt,
          content: await FS.readText(node.id),
        });
      }
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `radonos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${payload.files.length} text files and settings`, { type: 'success', iconName: 'download' });
  });

  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.application !== 'RadonOS') throw new Error('That file is not a RadonOS backup');
      if (data.settings) await replaceSettings(data.settings);

      const ensureFolder = async (path) => {
        const parts = path.split('/').filter(Boolean);
        let parent = await FS.get(FS.ROOT_ID);
        for (const part of parts) {
          let node = await FS.byName(parent.id, part);
          if (!node) node = await FS.mkdir(parent.id, part);
          parent = node;
        }
        return parent;
      };

      for (const folder of data.folders || []) {
        if (folder === '/Trash') continue;
        await ensureFolder(folder);
      }
      let restored = 0;
      for (const entry of data.files || []) {
        const parentPath = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
        const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
        const parent = parentPath === '/' ? await FS.get(FS.ROOT_ID) : await ensureFolder(parentPath);
        await FS.writeText({ parentId: parent.id, name, content: entry.content });
        restored += 1;
      }
      toast(`Imported settings and ${restored} files`, { type: 'success', iconName: 'upload' });
      render();
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Import failed' });
    }
    event.target.value = '';
  });
}

async function renderCleanup(root) {
  const stats = await FS.stats();

  root.innerHTML = group({
    title: 'Cleanup',
    sub: 'Free space and start over',
    iconName: 'trash',
    danger: true,
    body: [
      row({
        label: 'Empty trash',
        hint: `${stats.trash} item${stats.trash === 1 ? '' : 's'} can be permanently deleted`,
        control: `<button class="ros-btn sm ghost" id="empty-trash" ${stats.trash ? '' : 'disabled'}>Empty trash</button>`,
      }),
      row({
        label: 'Reset settings',
        hint: 'Restore wallpaper, theme, widgets and preferences to defaults',
        control: '<button class="ros-btn sm ghost" id="reset-settings">Reset settings</button>',
      }),
      row({
        label: 'Erase all RadonOS data',
        hint: 'Deletes every file, folder and preference stored by RadonOS',
        control: '<button class="ros-btn sm danger" id="erase">Erase everything</button>',
      }),
    ].join(''),
  });

  paintIcons(root);

  $('#empty-trash').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Empty the trash?',
      message: 'Trashed items are deleted permanently.',
      confirmText: 'Empty trash',
      danger: true,
    });
    if (!ok) return;
    await FS.emptyTrash();
    toast('Trash emptied', { type: 'success' });
    render();
  });

  $('#reset-settings').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset settings?',
      message: 'Your files stay in the virtual file system; only preferences are restored to defaults.',
      confirmText: 'Reset settings',
    });
    if (!ok) return;
    await resetSettings();
    await applyWallpaper();
    toast('Settings restored to defaults', { type: 'success' });
    render();
  });

  $('#erase').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Erase all RadonOS data?',
      message: 'Every file, folder, wallpaper and preference will be deleted. This cannot be undone.',
      confirmText: 'Erase everything',
      danger: true,
    });
    if (!ok) return;
    await idb.clear('nodes');
    await idb.clear('kv');
    await resetSettings();
    toast('RadonOS data erased — reloading…', { type: 'success', iconName: 'trash' });
    setTimeout(() => window.location.reload(), 900);
  });
}

/* ----------------------------------------------------------------- about */
async function renderAboutOverview(root) {
  const stats = await FS.stats();
  const memory = performance.memory;

  root.innerHTML = [
    group({
      title: `RadonOS ${OS_VERSION} “${OS_CODENAME}”`,
      sub: 'An operating-system style workspace for your browser new tab',
      iconName: 'info',
      right: '<button class="ros-btn sm ghost" id="about-modal">Open About dialog</button>',
      body: `
        <div style="display:flex;gap:14px;align-items:center;padding:6px 0 10px">
          ${radonMark(58)}
          <p class="setting-hint" style="flex:1">
            RadonOS turns the new tab page into a desktop: floating app windows, a virtual file
            system in IndexedDB, widgets, a terminal and a mini browser. It is a single Manifest V3
            extension with no remote assets, no accounts and no telemetry.
          </p>
        </div>
        <div class="feature-list">
          ${[
            ['Window manager', 'drag, resize, snap, minimize, maximize, session restore'],
            ['Virtual file system', 'folders, trash, uploads, downloads and cross-app file hand-off'],
            ['Widgets', 'live weather, sticky notes, bookmarks and a performance monitor'],
            ['Terminal', 'twenty commands over the real file system, with tab completion'],
            ['Battery & volume', 'Battery API status plus Web Audio volume for OS sounds'],
          ].map(([title, text]) => `
            <div class="feature">${icon('check-circle', { size: 15 })}<span><b>${title}</b> — ${text}</span></div>`).join('')}
        </div>`,
    }),
    group({
      title: 'Live runtime',
      sub: 'Measured inside this RadonOS window',
      iconName: 'cpu',
      body: `
        <dl class="kv-table">
          <dt>Open windows</dt><dd>${window.parent?.RadonOS?.windows?.list?.().length ?? 1}</dd>
          <dt>Files / folders</dt><dd>${stats.files} / ${stats.folders}</dd>
          <dt>Virtual disk</dt><dd>${formatBytes(stats.bytes)}</dd>
          <dt>In trash</dt><dd>${stats.trash}</dd>
          <dt>JS heap</dt><dd>${memory ? `${formatBytes(memory.usedJSHeapSize)} of ${formatBytes(memory.jsHeapSizeLimit)}` : 'not exposed'}</dd>
          <dt>Hardware threads</dt><dd>${navigator.hardwareConcurrency || 'unknown'}</dd>
          <dt>Runtime</dt><dd>${globalThis.chrome?.runtime?.id ? 'Chromium extension (MV3)' : 'Dev server preview'}</dd>
          <dt>Installed apps</dt><dd>${APPS.map((app) => app.name).join(', ')}</dd>
          <dt>Session started</dt><dd>${formatDate(Date.now() - performance.now(), { withTime: true })}</dd>
        </dl>`,
    }),
  ].join('');

  paintIcons(root);
  $('#about-modal').addEventListener('click', () => window.parent?.RadonOS?.showAbout?.());
}

function renderShortcuts(root) {
  root.innerHTML = group({
    title: 'Keyboard shortcuts',
    sub: 'Available while a RadonOS tab is focused',
    iconName: 'terminal',
    body: `
      <dl class="kv-table">
        <dt>Start menu</dt><dd><span class="ros-kbd">Alt</span> + <span class="ros-kbd">Space</span></dd>
        <dt>Close window</dt><dd><span class="ros-kbd">Alt</span> + <span class="ros-kbd">W</span></dd>
        <dt>Minimize window</dt><dd><span class="ros-kbd">Alt</span> + <span class="ros-kbd">M</span></dd>
        <dt>Cycle windows</dt><dd><span class="ros-kbd">Alt</span> + <span class="ros-kbd">Tab</span></dd>
        <dt>Maximize / restore</dt><dd>Double-click a window title bar</dd>
        <dt>Snap window</dt><dd>Drag a title bar to the left, right or top edge</dd>
        <dt>Save in Notepad</dt><dd><span class="ros-kbd">Ctrl</span> + <span class="ros-kbd">S</span></dd>
        <dt>Terminal clear</dt><dd><span class="ros-kbd">Ctrl</span> + <span class="ros-kbd">L</span></dd>
        <dt>Copy URL in Browser</dt><dd><span class="ros-kbd">Ctrl</span> + <span class="ros-kbd">L</span></dd>
      </dl>`,
  });

  paintIcons(root);
}

/* ---------------------------------------------------------------- render */
function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = `
    <div class="sidebar-title">Settings</div>
    ${CATEGORIES.map((category) => `
      <button class="sidebar-item${category.id === activeCategory ? ' active' : ''}" data-section="${category.id}">
        ${icon(category.icon, { size: 15 })}<span>${category.title}</span>
      </button>`).join('')}
    <div class="sidebar-foot">
      <div class="ros-hint">Version ${OS_VERSION} “${OS_CODENAME}”<br>Manifest V3 · offline-first</div>
    </div>`;

  nav.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.section));
  });
}

function renderCategory(root, category) {
  root.innerHTML = `
    <div class="overview-intro">
      <span class="overview-badge">${icon(category.icon, { size: 20 })}</span>
      <p class="overview-blurb">${escapeHtml(category.blurb)}</p>
    </div>
    <div class="settings-list" aria-label="${escapeHtml(category.title)} settings">
      ${category.items.map((item) => `
        <button class="settings-tile" data-item="${item.id}">
          <span class="settings-tile-icon">${icon(item.icon, { size: 18 })}</span>
          <span class="settings-tile-text">
            <span class="settings-tile-title">${escapeHtml(item.title)}</span>
            <span class="settings-tile-sub">${escapeHtml(item.sub)}</span>
          </span>
          <span class="settings-tile-value">${escapeHtml(item.summary ? item.summary(getSettings()) : '')}</span>
          ${icon('chevron-right', { size: 15, className: 'settings-tile-chevron' })}
        </button>`).join('')}
    </div>`;

  root.querySelectorAll('[data-item]').forEach((button) => {
    button.addEventListener('click', () => go(category.id, button.dataset.item));
  });

  paintIcons(root);
}

function renderCrumb(category, item) {
  const crumb = $('#crumb');
  if (!item) {
    crumb.hidden = true;
    crumb.innerHTML = '';
    return;
  }
  crumb.hidden = false;
  crumb.innerHTML = `
    <button class="crumb-back" data-back title="Back to ${escapeHtml(category.title)}" aria-label="Back to ${escapeHtml(category.title)}">
      ${icon('chevron-left', { size: 17 })}
    </button>
    <button class="crumb-link" data-crumb="${category.id}">${escapeHtml(category.title)}</button>
    <span class="crumb-sep">${icon('chevron-right', { size: 13 })}</span>
    <span class="crumb-current">${escapeHtml(item.title)}</span>`;

  crumb.querySelector('[data-back]').addEventListener('click', () => go(category.id));
  crumb.querySelector('[data-crumb]').addEventListener('click', () => go(category.id));
  paintIcons(crumb);
}

async function render() {
  const category = CATEGORIES.find((entry) => entry.id === activeCategory) || CATEGORIES[0];
  const item = category.items.find((entry) => entry.id === activeItem) || null;
  if (activeItem && !item) activeItem = null;

  $('#section-title').textContent = item ? item.title : category.title;
  $('#section-sub').textContent = item ? item.sub : category.sub;
  $('#status-version').textContent = `RadonOS ${OS_VERSION} · ${OS_CODENAME}`;

  renderCrumb(category, item);

  const pane = $('#pane');
  pane.scrollTop = 0;
  if (!item) {
    renderCategory(pane, category);
    return;
  }
  pane.innerHTML = '<div class="ros-empty"><span class="ros-spinner"></span></div>';
  await item.render(pane);
}

$('#open-about').addEventListener('click', () => go('about'));

/* ------------------------------------------------------------------ boot */
(async () => {
  await loadSettings();
  await initTheme();
  await FS.ready();
  paintIcons();

  const params = new URLSearchParams(location.search);
  const section = params.get('section');
  if (section && CATEGORIES.some((entry) => entry.id === section)) activeCategory = section;
  const item = params.get('item');
  if (item && CATEGORIES.find((entry) => entry.id === activeCategory)?.items.some((entry) => entry.id === item)) {
    activeItem = item;
  }

  renderNav();
  await render();
})();
