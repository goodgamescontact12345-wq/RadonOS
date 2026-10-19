import { getSettings, loadSettings, onSettingsChange } from './settings.js';
import { idb } from './idb.js';

export const ACCENTS = [
  { name: 'Radon Blue', value: '#5b9dff' },
  { name: 'Mint', value: '#2fd6b3' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Sunset', value: '#fb7185' },
  { name: 'Amber', value: '#f5b544' },
  { name: 'Lime', value: '#a3e635' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Rose', value: '#f472b6' },
];

export const PALETTES = [
  { id: 'midnight', name: 'Midnight', note: 'Deep petrol glass', swatch: '#0f3a46' },
  { id: 'lavender', name: 'Lavender', note: 'Soft violet haze', swatch: '#2e2646' },
  { id: 'sage', name: 'Sage', note: 'Calm green-grey', swatch: '#21332c' },
  { id: 'peach', name: 'Peach', note: 'Warm sunset tint', swatch: '#3f2c23' },
];

export const DEFAULT_GLASS = { blur: 26, saturation: 1.35 };
export const GLASS_LIMITS = { blur: [0, 40], saturation: [1, 2] };

export const WALLPAPERS = [
  {
    id: 'aurora',
    name: 'Aurora',
    css: 'radial-gradient(1100px 900px at 6% -12%, #12626c 0px, transparent 58%), radial-gradient(900px 760px at 102% 104%, #1b3f74 0px, transparent 52%), linear-gradient(155deg, #083039 0%, #081a2c 46%, #071224 100%)',
  },
  {
    id: 'nebula',
    name: 'Nebula',
    css: 'radial-gradient(at 20% 20%, #5b21b6 0px, transparent 48%), radial-gradient(at 80% 10%, #9d174d 0px, transparent 42%), radial-gradient(at 55% 90%, #1e3a8a 0px, transparent 55%), linear-gradient(150deg, #08060f, #120a22 60%, #0a0714)',
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    css: 'radial-gradient(at 30% 0%, #0e7490 0px, transparent 50%), radial-gradient(at 90% 80%, #1e3a8a 0px, transparent 55%), linear-gradient(170deg, #04121c, #071a26 60%, #030b12)',
  },
  {
    id: 'dune',
    name: 'Dune',
    css: 'radial-gradient(at 78% 18%, #7c2d12 0px, transparent 46%), radial-gradient(at 18% 82%, #713f12 0px, transparent 50%), linear-gradient(160deg, #140d09, #1d1410 60%, #0d0907)',
  },
  {
    id: 'forest',
    name: 'Forest',
    css: 'radial-gradient(at 15% 15%, #14532d 0px, transparent 50%), radial-gradient(at 85% 85%, #064e3b 0px, transparent 48%), linear-gradient(155deg, #060d0a, #0a1712 60%, #050b08)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    css: 'radial-gradient(at 50% -10%, #334155 0px, transparent 55%), linear-gradient(160deg, #0a0d13, #121821 60%, #080a0f)',
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    css: 'radial-gradient(at 80% 10%, #f97316 0px, transparent 42%), radial-gradient(at 10% 90%, #be185d 0px, transparent 48%), linear-gradient(160deg, #1a0f1f, #241324 55%, #120a12)',
  },
  {
    id: 'dawn',
    name: 'Soft Dawn',
    css: 'radial-gradient(at 15% 10%, #fde68a 0px, transparent 45%), radial-gradient(at 85% 20%, #bfdbfe 0px, transparent 48%), radial-gradient(at 50% 100%, #fbcfe8 0px, transparent 52%), linear-gradient(160deg, #f6f7fb, #eef2fb)',
  },
];

const DEFAULT_ACCENT = '#5b9dff';
let wallpaperUrl = null;
let cleanup = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function hexToRgb(hex) {
  let value = String(hex || '').replace('#', '').trim();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(value)) return [91, 157, 255];
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function resolveMode(settings) {
  if (settings.theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return settings.theme === 'light' ? 'light' : 'dark';
}

export function accentColor(settings = getSettings()) {
  const rgb = hexToRgb(settings.accent || DEFAULT_ACCENT);
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Paint tokens on <html>. Safe to call before the wallpaper resolves. */
export function applyAppearance(settings = getSettings()) {
  const root = document.documentElement;
  const mode = resolveMode(settings);
  const rgb = hexToRgb(settings.accent);
  const accent = `rgb(${rgb.join(', ')})`;

  root.dataset.theme = mode;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', rgb.join(', '));
  root.style.setProperty('--accent-contrast', luminance(rgb) > 0.55 ? '#08111f' : '#ffffff');
  root.style.setProperty('--accent-soft', `rgba(${rgb.join(', ')}, 0.16)`);
  root.style.setProperty('--accent-line', `rgba(${rgb.join(', ')}, 0.42)`);
  root.style.setProperty('--wallpaper-dim', String(settings.wallpaper?.dim ?? 0.2));
  root.style.setProperty('--wallpaper-blur', `${settings.wallpaper?.blur ?? 0}px`);

  // Palette, glass and dock are pure data attributes: the CSS in
  // themeEngine.css owns the actual colours and blur maths.
  const glass = { ...DEFAULT_GLASS, ...(settings.glass || {}) };
  const [minBlur, maxBlur] = GLASS_LIMITS.blur;
  const [minSat, maxSat] = GLASS_LIMITS.saturation;
  root.dataset.palette = PALETTES.some((item) => item.id === settings.palette)
    ? settings.palette
    : 'midnight';
  const glassOn = glass.enabled !== false;
  root.dataset.glass = glassOn ? 'on' : 'flat';
  root.dataset.dock = settings.dock === 'top' ? 'top' : 'bottom';
  root.dataset.dockAlign = ['start', 'center', 'end'].includes(settings.dockAlign)
    ? settings.dockAlign
    : 'center';
  root.style.setProperty('--glass-blur', `${glassOn ? clamp(Number(glass.blur) || 0, minBlur, maxBlur) : 0}px`);
  root.style.setProperty('--glass-sat', String(glassOn ? clamp(Number(glass.saturation) || 1, minSat, maxSat) : 1));

  // Brightness is an overlay, not a CSS filter: filtering <body> would
  // create a containing block and break every fixed-position window.
  const brightness = clamp(Number(settings.brightness ?? 1), 0.35, 1);
  root.style.setProperty('--display-shade', ((1 - brightness) * 0.8).toFixed(3));

  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
  root.dataset.labels = settings.iconLabels === false ? 'hidden' : 'shown';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#071522' : '#eef3f7');
  return mode;
}

function presetCss(id) {
  return (WALLPAPERS.find((wallpaper) => wallpaper.id === id) || WALLPAPERS[0]).css;
}

export function presetName(id) {
  return (WALLPAPERS.find((wallpaper) => wallpaper.id === id) || WALLPAPERS[0]).name;
}

async function resolveWallpaper(wallpaper = getSettings().wallpaper) {
  if (!wallpaper) return presetCss('aurora');
  if (wallpaper.type === 'url' && wallpaper.value) {
    return `url("${String(wallpaper.value).replace(/["\\]/g, '')}") center / cover no-repeat`;
  }
  if (wallpaper.type === 'image') {
    try {
      const blob = await idb.get('kv', 'wallpaper:image');
      if (blob instanceof Blob) {
        if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
        wallpaperUrl = URL.createObjectURL(blob);
        return `url("${wallpaperUrl}") center / cover no-repeat`;
      }
    } catch (err) {
      console.warn('[RadonOS] wallpaper blob unavailable', err);
    }
    return presetCss('aurora');
  }
  if (wallpaper.type === 'color' && wallpaper.value) {
    return wallpaper.value;
  }
  return presetCss(wallpaper.value || 'aurora');
}

/** Resolve and apply the wallpaper. Returns the CSS background value. */
export async function applyWallpaper(wallpaper = getSettings().wallpaper) {
  const css = await resolveWallpaper(wallpaper);
  document.documentElement.style.setProperty('--wallpaper', css);
  return css;
}

/**
 * Boot the theme engine: paint immediately from defaults, then refine once
 * settings load, and keep every page in sync on changes.
 */
export async function initTheme({ watch = true } = {}) {
  applyAppearance(getSettings());
  await loadSettings();
  applyAppearance(getSettings());
  await applyWallpaper();

  if (watch && !cleanup) {
    const unsub = await onSettingsChange((settings) => {
      applyAppearance(settings);
      void applyWallpaper(settings.wallpaper);
    });
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onMedia = () => {
      applyAppearance(getSettings());
    };
    media.addEventListener('change', onMedia);
    cleanup = () => {
      unsub();
      media.removeEventListener('change', onMedia);
      cleanup = null;
    };
  }
  return getSettings();
}
