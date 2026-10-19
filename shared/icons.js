/**
 * Inline SVG icon set (stroke based, 24x24). Keeps the extension fully
 * self-contained: zero fonts, zero network requests.
 */
const PATHS = {
  folder: '<path d="M3 7.4A2.4 2.4 0 0 1 5.4 5h3.5l2 2.5h7.7A2.4 2.4 0 0 1 21 9.9v7.7A2.4 2.4 0 0 1 18.6 20H5.4A2.4 2.4 0 0 1 3 17.6z"/>',
  'folder-plus': '<path d="M3 7.4A2.4 2.4 0 0 1 5.4 5h3.5l2 2.5h7.7A2.4 2.4 0 0 1 21 9.9v7.7A2.4 2.4 0 0 1 18.6 20H5.4A2.4 2.4 0 0 1 3 17.6z"/><path d="M12 11v6M9 14h6"/>',
  file: '<path d="M6 3.5h6.6L18 8.9v11.6H6z"/><path d="M12.5 3.5v5.4H18"/>',
  'file-text': '<path d="M6 3.5h6.6L18 8.9v11.6H6z"/><path d="M12.5 3.5v5.4H18M9 13h6M9 16.5h6"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.4"/><path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8M12 3.4c2.3 2.4 3.5 5.5 3.5 8.6S14.3 18.2 12 20.6C9.7 18.2 8.5 15.1 8.5 12S9.7 5.8 12 3.4z"/>',
  play: '<circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.6 16 12l-5.8 3.4z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1.2"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2"/>',
  'skip-back': '<path d="M18 6.5 9.5 12l8.5 5.5z" fill="currentColor"/><path d="M6.5 6v12"/>',
  'skip-forward': '<path d="M6 6.5 14.5 12 6 17.5z" fill="currentColor"/><path d="M17.5 6v12"/>',
  music: '<path d="M9 18V6.5l10-2v11"/><circle cx="6.6" cy="18" r="2.6"/><circle cx="16.6" cy="15.5" r="2.6"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2.2"/><path d="m15 11 5.5-3v8L15 13z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65h.01A1.7 1.7 0 0 0 10.04 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.35 9v.01a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.03z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.6" cy="6.5" r="1.1" fill="currentColor"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor"/><circle cx="4.6" cy="17.5" r="1.1" fill="currentColor"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'chevron-up': '<path d="m6 14.5 6-6 6 6"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  minimize: '<path d="M5.5 12h13"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  restore: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M8 5.5H6.5A1.5 1.5 0 0 0 5 7v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  upload: '<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v12M7.5 11.5 12 16l4.5-4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2.4 6.3"/><path d="M20 5v6.5h-6.5"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z"/>',
  bell: '<path d="M18 16.5H6l1.2-1.9V10a4.8 4.8 0 0 1 9.6 0v4.6z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>',
  volume: '<path d="M4 9.5h3L12 5.5v13L7 14.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  'volume-off': '<path d="M4 9.5h3L12 5.5v13L7 14.5H4z"/><path d="m16 9.5 4.5 5M20.5 9.5l-4.5 5"/>',
  battery: '<rect x="2.5" y="8" width="16.5" height="9" rx="2.4"/><path d="M21.5 11v3"/>',
  wifi: '<path d="M4 9.5a12 12 0 0 1 16 0M7 12.8a7.6 7.6 0 0 1 10 0M10 16a3.2 3.2 0 0 1 4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.4"/><path d="M3.5 9.5h17M8 3.5V6M16 3.5V6"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3.2 2"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1" fill="currentColor"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.4a8 8 0 1 0 10 0"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.5-2.1-.6-1.4.4-2.7 1.9-2.7h2.2a2.9 2.9 0 0 0 2.9-2.9A8.4 8.4 0 0 0 12 3.5z"/><circle cx="8.4" cy="9" r="1.1" fill="currentColor"/><circle cx="12" cy="7.4" r="1.1" fill="currentColor"/><circle cx="15.6" cy="9" r="1.1" fill="currentColor"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4.5 17 4.8-4.4 3.4 3 2.6-2.3 4.2 3.7"/>',
  pin: '<path d="M9.5 3.5h5l-.8 5.4 3.3 3.3v1.3h-5.5V21l-1-7.5H5v-1.3l3.3-3.3z"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 6.5"/>',
  edit: '<path d="M4.5 19.5h4l10.2-10.2a2.4 2.4 0 0 0-3.4-3.4L5.1 16.1z"/><path d="m13.6 7.6 3.4 3.4"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5h4"/>',
  home: '<path d="m4 10.5 8-6.2 8 6.2V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z"/><path d="M9.5 20.5v-6h5v6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  save: '<path d="M5 4.5h11.5L20 8v11.5H5z"/><path d="M8 4.5v5h7v-5M8.5 15h7"/>',
  shuffle: '<path d="M4 7h3.5c4 0 5 10 9 10H20"/><path d="m17 14.5 3 2.5-3 2.5M4 17h3.5c1.5 0 2.6-1.3 3.6-3M14.5 8.5c.6-1 1.3-1.5 2-1.5H20"/><path d="m17 4.5 3 2.5-3 2.5"/>',
  repeat: '<path d="M7 6.5h10.5L20 9M17 17.5H6.5L4 15"/><path d="m18 6.5 2.5 2.5L18 11.5M6 14.5 3.5 17 6 19.5"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-9A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 3c0 4.6-7.5 9-7.5 9z"/>',
  alert: '<path d="M12 4 3 20h18z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.7 6.6"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 5.5V4.8A1.8 1.8 0 0 0 14.2 3H5.8A1.8 1.8 0 0 0 4 4.8v8.4A1.8 1.8 0 0 0 5.8 15h.7"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20.5c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5"/>',
  logout: '<path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14"/><path d="M17.5 8.5 21 12l-3.5 3.5M10 12h11"/>',
  'x-circle': '<circle cx="12" cy="12" r="8.6"/><path d="m9 9 6 6M15 9l-6 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.6"/><path d="m8 12.2 2.6 2.8L16 9.5"/>',
  'rotate-ccw': '<path d="M4 11.5a8 8 0 1 1 2.4 6.3"/><path d="M4 5v6.5h6.5"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  shield: '<path d="M12 3.5 20 6v6c0 4.5-3.3 7.6-8 8.5-4.7-.9-8-4-8-8.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  zap: '<path d="M13.5 3 5.5 13.5H11L10.5 21l8-10.5H13z"/>',
};

export function icon(name, { size = 20, stroke = 1.7, className = '' } = {}) {
  const body = PATHS[name] || PATHS.file;
  return `<svg class="ros-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * The RadonOS atom mark, scales cleanly and inherits currentColor.
 *
 * Every call gets a unique gradient id: several marks live in the same
 * document (taskbar, start menu, boot splash) and a shared id resolves to
 * whichever one comes first — including one inside a hidden subtree, which
 * leaves the rings unpainted and the mark reading as a plain dot.
 */
let markSeq = 0;

export function radonMark(size = 26, { className = '' } = {}) {
  const paint = `rm-grad-${++markSeq}`;
  return `<svg class="radon-mark ${className}" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="${paint}" x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
        <stop stop-color="#3ee0c8"/><stop offset="0.55" stop-color="#63b1ff"/><stop offset="1" stop-color="#a78bfa"/>
      </linearGradient>
    </defs>
    <ellipse cx="24" cy="24" rx="16" ry="5.6" transform="rotate(38 24 24)" stroke="url(#${paint})" stroke-width="2.7"/>
    <ellipse cx="24" cy="24" rx="16" ry="5.6" transform="rotate(-38 24 24)" stroke="url(#${paint})" stroke-width="2.7"/>
    <circle cx="24" cy="24" r="3.9" fill="#f2ffff"/>
    <circle cx="24" cy="24" r="6.2" stroke="url(#${paint})" stroke-width="1.2" opacity=".5"/>
  </svg>`;
}

export function appIcon(app, size = 22) {
  return icon(app?.icon || 'file', { size });
}
