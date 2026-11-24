/**
 * Packs the extension into `dist/radonos-extension-<version>.zip`.
 *
 * A browser will not load a zip directly — Chrome and Edge take a *folder* via
 * "Load unpacked", and a store listing takes this same zip — so the archive is
 * how the extension travels: unzip it anywhere, point the browser at the
 * folder, done. Nothing else is needed, because the extension is plain ES
 * modules: no bundler, no dependencies, no build step.
 *
 * Writing the zip here instead of shelling out to `zip` keeps the project's
 * "plain Node" promise, and a fixed timestamp makes two packs of the same tree
 * byte-identical.
 *
 *   node tools/build-extension.mjs
 *   node tools/build-extension.mjs --out /tmp/radonos.zip
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Everything a browser needs, relative to the project root. */
const INCLUDE = ['manifest.json', 'background.js', 'newtab', 'apps', 'shared', 'icons'];

/** Nothing outside those paths ships: no tooling, no docs, no hosted build. */
const SKIP = new Set(['.DS_Store', 'Thumbs.db']);

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 0x21; // 1980-01-01, the earliest a zip can express
const UTF8_NAMES = 0x0800;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

async function collect(path, prefix = '') {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collect(join(path, entry.name), name));
    } else if (entry.isFile()) {
      files.push({ name, data: await readFile(join(path, entry.name)) });
    }
  }
  return files;
}

/** A minimal store-or-deflate zip; `entries` is `[{ name, data }]`. */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8); // 0 = store, 8 = deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014B50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(stored ? 0 : 8, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(fileName.length, 28);
    header.writeUInt32LE(0, 42 - 4); // external attributes
    header.writeUInt32LE(offset, 42); // relative offset of the local header

    locals.push(local, fileName, body);
    central.push(header, fileName);
    offset += local.length + fileName.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

const outIndex = process.argv.indexOf('--out');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const OUT = outIndex >= 0
  ? process.argv[outIndex + 1]
  : join(ROOT, 'dist', `radonos-extension-${manifest.version}.zip`);

const files = [];
for (const path of INCLUDE) {
  const full = join(ROOT, path);
  try {
    const info = await stat(full);
    if (info.isDirectory()) files.push(...await collect(full, path));
    else files.push({ name: path, data: await readFile(full) });
  } catch (error) {
    console.error(`Cannot pack ${path}: ${error.message}`);
    process.exit(1);
  }
}

if (!files.some((file) => file.name === 'manifest.json')) {
  console.error('Packed tree has no manifest.json — refusing to write a broken archive.');
  process.exit(1);
}

const archive = zip(files);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, archive);

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const raw = files.reduce((total, file) => total + file.data.length, 0);
console.log(`Packed ${files.length} files · ${kib(raw)} → ${kib(archive.length)} → ${relative(ROOT, OUT) || OUT}`);
console.log('Unzip it, then load the folder with "Load unpacked" (chrome://extensions, Developer mode).');
