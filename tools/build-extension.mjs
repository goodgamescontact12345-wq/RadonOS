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
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
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

/* ------------------------------------------------------------------ crx3 */
/** `Cr24` + version 3 + header length + protobuf header + the same zip. */
const CRX_MAGIC = Buffer.from('Cr24');
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'binary');

function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 0x7F) {
    bytes.push((rest & 0x7F) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** A protobuf length-delimited field. CRX3 only needs this shape. */
const bytesField = (tag, buffer) => Buffer.concat([varint((tag << 3) | 2), varint(buffer.length), buffer]);

function readVarint(buffer, start) {
  let value = 0;
  let shift = 1;
  let offset = start;
  let byte = 0x80;
  while (byte & 0x80) {
    byte = buffer[offset];
    offset += 1;
    value += (byte & 0x7F) * shift;
    shift *= 128;
  }
  return [value, offset];
}

/** Every length-delimited field of a protobuf message, in order. */
function readFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [key, afterKey] = readVarint(buffer, offset);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 2) {
      const [length, start] = readVarint(buffer, afterKey);
      fields.push({ field, value: buffer.subarray(start, start + length) });
      offset = start + length;
    } else if (wire === 0) {
      offset = readVarint(buffer, afterKey)[1];
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

/** `a`-`p` spelling of a 16-byte extension id, the way Chrome shows it. */
const extensionId = (id) => [...id]
  .map((byte) => 'abcdefghijklmnop'[byte >> 4] + 'abcdefghijklmnop'[byte & 15])
  .join('');

/** Signing key: reused from `path`, or generated once and kept there. */
async function privateKeyPem(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await writeFile(path, privateKey, { mode: 0o600 });
    return privateKey;
  }
}

function signedHeaderData(crxId) {
  return bytesField(1, crxId);
}

function signatureInput(header, archive) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([SIGNATURE_CONTEXT, length, header, archive]);
}

async function packCrx(archive, keyPath) {
  const pem = await privateKeyPem(keyPath);
  const key = createPrivateKey(pem);
  const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const crxId = createHash('sha256').update(publicDer).digest().subarray(0, 16);

  const header = signedHeaderData(crxId);
  const signature = sign('sha256', signatureInput(header, archive), key);
  const proof = Buffer.concat([bytesField(1, publicDer), bytesField(2, signature)]);
  const message = Buffer.concat([bytesField(2, proof), bytesField(10000, header)]);

  const prefix = Buffer.alloc(12);
  CRX_MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(message.length, 8);

  return { crx: Buffer.concat([prefix, message, archive]), id: extensionId(crxId) };
}

/** Read the file back the way Chrome does, and check the signature covers it. */
function verifyCrx(buffer) {
  if (!buffer.subarray(0, 4).equals(CRX_MAGIC)) return 'missing Cr24 magic';
  if (buffer.readUInt32LE(4) !== 3) return 'not a CRX3 file';
  const headerLength = buffer.readUInt32LE(8);
  const header = buffer.subarray(12, 12 + headerLength);
  const archive = buffer.subarray(12 + headerLength);
  if (archive.readUInt32LE(0) !== 0x04034B50) return 'payload is not a zip';

  const fields = readFields(header);
  const signed = fields.find((entry) => entry.field === 10000)?.value;
  const proof = fields.find((entry) => entry.field === 2)?.value;
  if (!signed || !proof) return 'header has no signed data';

  const proofFields = readFields(proof);
  const publicDer = proofFields.find((entry) => entry.field === 1)?.value;
  const signature = proofFields.find((entry) => entry.field === 2)?.value;
  if (!publicDer || !signature) return 'header has no key proof';

  const publicKey = createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
  if (!verify('sha256', signatureInput(signed, archive), publicKey, signature)) {
    return 'signature does not match the archive';
  }

  const crxId = readFields(signed).find((entry) => entry.field === 1)?.value;
  const expected = createHash('sha256').update(publicDer).digest().subarray(0, 16);
  if (!crxId || !Buffer.from(crxId).equals(expected)) return 'extension id does not match the key';
  return null;
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

if (process.argv.includes('--crx')) {
  const keyIndex = process.argv.indexOf('--key');
  const keyPath = keyIndex >= 0
    ? process.argv[keyIndex + 1]
    : join(ROOT, 'dist', 'radonos-extension.pem');
  const crxOut = OUT.replace(/\.zip$/i, '') + '.crx';

  const { crx, id } = await packCrx(archive, keyPath);
  const problem = verifyCrx(crx);
  if (problem) {
    console.error(`Refusing to write a CRX that does not verify: ${problem}`);
    process.exit(1);
  }
  await writeFile(crxOut, crx);
  console.log(`Signed  · id ${id} → ${kib(crx.length)} → ${relative(ROOT, crxOut)}`);
  console.log(`Key     · ${relative(ROOT, keyPath)} (keep it: the id above comes from this key)`);
  console.log('Drag the .crx onto chrome://extensions — Chromium blocks off-store installs on Windows and macOS.');
}
