import { getSettings, updateSettings } from './settings.js';

/**
 * The lock screen is a convenience lock, not disk encryption: the session lives
 * in this browser profile and anyone with devtools can read it. What the
 * password stops is somebody walking up to an unlocked desktop and clicking
 * through. It is therefore stored as a salted PBKDF2-SHA256 hash, never as the
 * password itself, and never leaves the profile.
 */
export const LOCK_DEFAULTS = {
  hash: '',
  salt: '',
  showClock: true,
  showWindows: true,
  dim: 0.3, // 0 - 0.7 veil over the desktop
  onStart: false,
};

const ITERATIONS = 120000;
const encoder = new TextEncoder();

export function lockSettings() {
  return { ...LOCK_DEFAULTS, ...(getSettings().lock || {}) };
}

export function hasPassword() {
  const { hash, salt } = lockSettings();
  return Boolean(hash && salt);
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Store a password, replacing any existing one. */
export async function setPassword(password) {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(password, salt);
  await updateSettings({ lock: { hash, salt } });
}

export async function clearPassword() {
  await updateSettings({ lock: { hash: '', salt: '' } });
}

/** True when the password matches; always true while no password is set. */
export async function verifyPassword(password) {
  const { hash, salt } = lockSettings();
  if (!hash || !salt) return true;
  return (await derive(password, salt)) === hash;
}
