import { getSettings } from './settings.js';

/**
 * Tiny synthesized OS sound engine. No audio assets are shipped; every cue is
 * generated with the Web Audio API and routed through a master gain that the
 * taskbar volume slider controls.
 */
let context = null;
let master = null;

function ensure() {
  if (!getSettings().sounds) return null;
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = getSettings().volume ?? 0.45;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function setVolume(value) {
  if (master) master.gain.value = Math.max(0, Math.min(1, value));
}

function tone(frequency, { at = 0, duration = 0.08, type = 'sine', gain = 0.12 } = {}) {
  const ctx = ensure();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const playClick = () => tone(520, { duration: 0.05, type: 'triangle', gain: 0.06 });
export const playOpen = () => {
  tone(420, { duration: 0.1, type: 'sine', gain: 0.07 });
  tone(620, { at: 0.05, duration: 0.12, type: 'sine', gain: 0.05 });
};
export const playClose = () => tone(320, { duration: 0.08, type: 'sine', gain: 0.05 });
export const playChime = () => {
  tone(660, { duration: 0.16, type: 'sine', gain: 0.09 });
  tone(880, { at: 0.09, duration: 0.22, type: 'sine', gain: 0.07 });
  tone(1320, { at: 0.18, duration: 0.3, type: 'sine', gain: 0.035 });
};
export const playError = () => {
  tone(240, { duration: 0.14, type: 'sawtooth', gain: 0.05 });
  tone(190, { at: 0.1, duration: 0.2, type: 'sawtooth', gain: 0.04 });
};
