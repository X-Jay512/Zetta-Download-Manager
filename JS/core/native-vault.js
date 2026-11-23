'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAGIC = 'ZDML';
const SEAL = [
  '7c1e9a4b', 'd03f88c2', '15ab6e90', '4d77c1fa',
  'a91e02b6', '38c4d5e7', 'f06b193a', '82de44c8',
];

function key() {
  return Buffer.from(SEAL.join(''), 'hex');
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(MAGIC), Buffer.from([1]), iv, tag, body]);
}

function openSeal(blob) {
  if (!Buffer.isBuffer(blob) || blob.length < 33 || blob.slice(0, 4).toString() !== MAGIC || blob[4] !== 1) {
    throw new Error('ZDM native library seal is not valid');
  }
  const iv = blob.slice(5, 17);
  const tag = blob.slice(17, 33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.slice(33)), decipher.final()]);
}

function sealFile(plainPath, outPath) {
  const sealed = seal(fs.readFileSync(plainPath));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, sealed);
}

function sweep(folder, stem) {
  let names = [];
  try { names = fs.readdirSync(folder); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(stem + '-') || !name.endsWith('.node')) continue;
    try { fs.unlinkSync(path.join(folder, name)); } catch { /* still loaded */ }
  }
}

function loadAddon(dir, stem) {
  const locked = path.join(dir, stem + '.protected.dll');
  const plain = path.join(dir, stem + '.node');
  if (fs.existsSync(locked)) {
    const raw = openSeal(fs.readFileSync(locked));
    const folder = path.join(os.tmpdir(), 'zdm-native');
    fs.mkdirSync(folder, { recursive: true });
    sweep(folder, stem);
    const tmp = path.join(folder, stem + '-' + process.pid + '.node');
    fs.writeFileSync(tmp, raw);
    return { addon: require(tmp), file: locked };
  }
  return { addon: require(plain), file: plain };
}

module.exports = { sealFile, loadAddon, openSeal };
