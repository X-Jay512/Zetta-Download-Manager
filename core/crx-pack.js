const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UPDATE_NAME = 'update.xml';
const CRX_NAME = 'zdm.crx';
const XPI_NAME = 'zdm.xpi';
const FIREFOX_ID = 'flash-dm@localhost';
const HOST = 'http://127.0.0.1:29512';

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function varint(value) {
  let n = Number(value) >>> 0;
  const out = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

function protoBytes(field, data) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const tag = (Number(field) << 3) | 2;
  return Buffer.concat([varint(tag), varint(body.length), body]);
}

function dosTime(date) {
  const d = date || new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

function zipStore(files) {
  const stamp = dosTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
    const data = file.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function listExtFiles(dir, base) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'back' || name === 'background - Copy.js') continue;
    const abs = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    const rel = base ? `${base}/${name}` : name;
    if (stat.isDirectory()) out.push(...listExtFiles(abs, rel));
    else out.push({ name: rel, abs });
  }
  return out;
}

function loadKey(keyPath) {
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8');
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, pair.privateKey);
  return pair.privateKey;
}

function extensionId(spki) {
  const hash = crypto.createHash('sha256').update(spki).digest().subarray(0, 16);
  let id = '';
  for (const byte of hash) {
    id += String.fromCharCode(97 + ((byte >> 4) & 15));
    id += String.fromCharCode(97 + (byte & 15));
  }
  return id;
}

function packCrx(zip, privatePem, spki) {
  const crxId = crypto.createHash('sha256').update(spki).digest().subarray(0, 16);
  const signedHeader = protoBytes(1, crxId);
  const signed = Buffer.concat([Buffer.from('CRX3 SignedData'), Buffer.from([0]), signedHeader]);
  const signature = crypto.sign('sha256', signed, privatePem);
  const proof = Buffer.concat([protoBytes(1, spki), protoBytes(2, signature)]);
  const header = Buffer.concat([protoBytes(2, proof), protoBytes(10000, signedHeader)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 4, 'ascii');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

function manifestFor(raw, spki, firefox) {
  const manifest = JSON.parse(raw);
  manifest.key = spki.toString('base64');
  if (firefox) {
    manifest.browser_specific_settings = {
      gecko: { id: FIREFOX_ID, strict_min_version: '115.0' },
    };
  }
  return Buffer.from(JSON.stringify(manifest));
}

function extensionIdentity(extDir, userData) {
  const privatePem = loadKey(path.join(userData, 'extension-key.pem'));
  const spki = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
  const raw = fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8');
  return { id: extensionId(spki), version: JSON.parse(raw).version || '1.0.0' };
}

function prepareExtensionDist(extDir, userData) {
  const dir = path.join(userData, 'extension-dist');
  fs.mkdirSync(dir, { recursive: true });
  const privatePem = loadKey(path.join(userData, 'extension-key.pem'));
  const spki = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
  const id = extensionId(spki);
  const files = listExtFiles(extDir);
  const rawManifest = fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8');
  const version = JSON.parse(rawManifest).version || '1.0.0';
  const chromeFiles = files.map((file) => ({
    name: file.name,
    data: file.name === 'manifest.json' ? manifestFor(rawManifest, spki, false) : fs.readFileSync(file.abs),
  }));
  const firefoxFiles = files.map((file) => ({
    name: file.name,
    data: file.name === 'manifest.json' ? manifestFor(rawManifest, spki, true) : fs.readFileSync(file.abs),
  }));
  const crx = packCrx(zipStore(chromeFiles), privatePem, spki);
  const xpi = zipStore(firefoxFiles);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${id}">\n    <updatecheck codebase="${HOST}/extension/${CRX_NAME}" version="${version}" />\n  </app>\n</gupdate>\n`;
  fs.writeFileSync(path.join(dir, CRX_NAME), crx);
  fs.writeFileSync(path.join(dir, XPI_NAME), xpi);
  fs.writeFileSync(path.join(dir, UPDATE_NAME), xml);
  fs.writeFileSync(path.join(dir, 'id.txt'), id);
  return { dir, id, version, firefoxId: FIREFOX_ID, host: HOST };
}

module.exports = {
  prepareExtensionDist,
  extensionIdentity,
  extensionId,
  FIREFOX_ID,
  HOST,
  UPDATE_NAME,
  CRX_NAME,
  XPI_NAME,
};
