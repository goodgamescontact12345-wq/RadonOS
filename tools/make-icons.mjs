/**
 * RadonOS icon generator (zero dependencies).
 * Renders the atom mark with signed-distance fields + 3x3 supersampling
 * and encodes the result with Node's zlib (PNG color type 6 / RGBA).
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'icons');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor + alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded square of half-size `s`. */
function sdRoundRect(x, y, s, r) {
  const qx = Math.abs(x) - s + r;
  const qy = Math.abs(y) - s + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Approximate distance to an ellipse outline, rotated by `rot` radians. */
function sdEllipse(x, y, rx, ry, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const px = x * c + y * s;
  const py = -x * s + y * c;
  const k = Math.hypot(px / rx, py / ry);
  return (k - 1) * Math.min(rx, ry);
}

function over(dst, src) {
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a <= 0) return [0, 0, 0, 0];
  return [
    (src[0] * src[3] + dst[0] * dst[3] * (1 - src[3])) / a,
    (src[1] * src[3] + dst[1] * dst[3] * (1 - src[3])) / a,
    (src[2] * src[3] + dst[2] * dst[3] * (1 - src[3])) / a,
    a,
  ];
}

/** One sample of the icon in normalized [-1,1] space. */
function sample(x, y) {
  let px = [0, 0, 0, 0];

  // Body ---------------------------------------------------------------
  const bodyD = sdRoundRect(x, y, 0.965, 0.235);
  if (bodyD < 0) {
    const top = 16, bottom = 34;
    const t = clamp01((y + 1) / 2);
    let r = mix(13, 23, t), g = mix(21, 34, t), b = mix(38, 62, t);
    const glow = Math.exp(-((x + 0.28) ** 2 + (y + 0.42) ** 2) * 5.2);
    r += glow * 20; g += glow * 34; b += glow * 48;
    const halo = Math.exp(-((x - 0.1) ** 2 + (y - 0.05) ** 2) * 3.4);
    r += halo * 8; g += halo * 24; b += halo * 30;
    // inner rim
    const rim = smoothstep(-0.03, 0, bodyD) * 0.6;
    r += rim * 30; g += rim * 70; b += rim * 90;
    px = [r, g, b, smoothstep(0, -0.02, bodyD)];
  }

  // Orbit glow ---------------------------------------------------------
  const orbits = [
    sdEllipse(x, y, 0.66, 0.235, -0.62),
    sdEllipse(x, y, 0.66, 0.235, 0.62),
  ];
  for (const d of orbits) {
    const halo = Math.exp(-(Math.max(d, 0) ** 2) / 0.02) * 0.5;
    if (halo > 0.004) {
      px = over(px, [88, 226, 255, clamp01(halo) * 0.75]);
    }
  }

  // Orbit strokes ------------------------------------------------------
  orbits.forEach((d, i) => {
    const stroke = smoothstep(0.052, 0.032, Math.abs(d)) * 0.95;
    if (stroke > 0.003) {
      const t = clamp01((x + 1) / 2);
      const c = i === 0
        ? [mix(76, 126, t), mix(240, 205, t), mix(220, 255, t)]
        : [mix(96, 160, t), mix(190, 236, t), mix(255, 220, t)];
      px = over(px, [c[0], c[1], c[2], stroke]);
    }
  });

  // Nucleus ------------------------------------------------------------
  const nd = Math.hypot(x, y);
  if (nd < 0.42) {
    const halo = Math.exp(-nd * nd / 0.024) * 0.55;
    px = over(px, [160, 245, 255, halo]);
  }
  if (nd < 0.145) {
    const core = smoothstep(0.145, 0.115, nd);
    px = over(px, [244, 255, 255, core]);
  }

  return px;
}

function render(size) {
  const SS = 3;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxx = 0; pxx < size; pxx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((pxx + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
          const s = sample(x, y);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const i = (py * size + pxx) * 4;
      // Colours are accumulated premultiplied in 0-255 space, so un-premultiply
      // and clamp back to 8-bit; clamping to 0-1 here would blacken the icon.
      const byte = (value) => (alpha > 0 ? Math.round(Math.min(255, Math.max(0, value / a))) : 0);
      rgba[i] = byte(r);
      rgba[i + 1] = byte(g);
      rgba[i + 2] = byte(b);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = render(size);
  writeFileSync(resolve(OUT, `icon-${size}.png`), buf);
  console.log(`icons/icon-${size}.png  ${buf.length} bytes`);
}
console.log('done');
