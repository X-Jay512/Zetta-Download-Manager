const GENERIC_STEM = /^(download|video|file|index|watch|videoplayback|playlist|manifest)$/;

function fileSizeOf(item) {
  const n = Number(item && (item.fileSize || item.size) || 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function audioSizeOf(item) {
  const n = Number(item && item.audioSize || 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function totalSizeOf(item) {
  return fileSizeOf(item) + audioSizeOf(item);
}

function sameSize(a, b) {
  const x = totalSizeOf(a);
  const y = totalSizeOf(b);
  return x > 0 && x === y;
}

function sourcePageOf(item) {
  if (!item) return '';
  const headers = item.headers || {};
  return item.sourcePage || item.referrer || headers.Referer || headers.referer || '';
}

function sourceKey(page) {
  const raw = String(page || '').trim();
  if (!raw) return '';
  const yt = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([\w-]{6,})/i);
  if (yt) return 'youtube:' + yt[1].toLowerCase();
  try {
    const parsed = new URL(raw);
    return (parsed.origin + parsed.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase();
  }
}

function nameExtKey(name) {
  const raw = String(name || '').split(/[\\/]/).pop().split('?')[0].split('#')[0].trim();
  if (!raw) return '';
  let clean = raw;
  try { clean = decodeURIComponent(raw); } catch { /* keep the raw name */ }
  clean = clean.toLowerCase();
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 ? clean.slice(dot) : '';
  if (!ext) return '';
  let stem = clean.slice(0, dot).replace(/(?:_\d+|\s*\(\d+\))$/, '');
  stem = stem.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem || GENERIC_STEM.test(stem)) return '';
  return stem + ext;
}

function sameSource(row, opts) {
  const left = sourceKey(sourcePageOf(row));
  const right = sourceKey(sourcePageOf(opts));
  return !!left && left === right;
}

function sameNameExt(row, opts) {
  const left = nameExtKey(row && row.fileName);
  const right = nameExtKey(opts && opts.fileName);
  return !!left && left === right;
}

function qualityTag(item) {
  const name = String(item && item.fileName || '');
  const fromName = name.match(/(?:^|[\s_-])(\d{3,4})p(?:[\s_.-]|$)/i);
  if (fromName) return fromName[1];
  const url = String(item && (item.url || item.audioUrl) || '');
  const box = url.match(/(\d{2,5})x(\d{2,5})/);
  if (box) return box[2];
  return '';
}

function isDuplicateRow(row, opts) {
  if (!row || !opts) return false;
  if (opts.url && row.url && opts.url === row.url) return true;
  if (sameSource(row, opts)) {
    if (opts.formatId && row.formatId && String(opts.formatId) !== String(row.formatId)) return false;
    const leftTag = qualityTag(row);
    const rightTag = qualityTag(opts);
    if (leftTag && rightTag && leftTag !== rightTag) return false;
    const left = totalSizeOf(row);
    const right = totalSizeOf(opts);
    if (left > 0 && right > 0 && Math.abs(left - right) > Math.max(256 * 1024, left * 0.08)) return false;
    const leftName = nameExtKey(row && row.fileName);
    const rightName = nameExtKey(opts && opts.fileName);
    if (leftName && rightName && leftName !== rightName) return false;
    return true;
  }
  const left = totalSizeOf(row);
  const right = totalSizeOf(opts);
  if (left > 0 && right > 0 && left !== right) return false;
  if (sameSize(row, opts) && sameNameExt(row, opts)) return true;
  return false;
}

function findDuplicate(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const pool = list.filter((row) => isDuplicateRow(row, opts));
  if (!pool.length) return null;
  const unfinished = pool.filter((row) => row.status !== 'complete');
  const ranked = unfinished.length ? unfinished : pool;
  ranked.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return ranked[0];
}

module.exports = {
  fileSizeOf,
  totalSizeOf,
  sourceKey,
  nameExtKey,
  isDuplicateRow,
  findDuplicate,
};
