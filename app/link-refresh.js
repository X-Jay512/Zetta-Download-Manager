function linkLooksExpired(url) {
  try {
    const parsed = new URL(url);
    const exp = parsed.searchParams.get('expire');
    if (exp && /^\d+$/.test(exp) && Number(exp) * 1000 < Date.now()) return true;
    const expires = parsed.searchParams.get('expires');
    if (expires && /^\d+$/.test(expires) && Number(expires) * 1000 < Date.now()) return true;
    const oe = parsed.searchParams.get('oe');
    if (oe && /^[0-9a-f]+$/i.test(oe)) {
      const expMs = parseInt(oe, 16) * 1000;
      if (expMs > 0 && expMs < Date.now()) return true;
    }
    const expHex = parsed.searchParams.get('exp');
    if (expHex) {
      const num = /^[0-9a-f]+$/i.test(expHex) && !/^\d+$/.test(expHex) ? parseInt(expHex, 16) : Number(expHex);
      if (num > 0 && num * 1000 < Date.now()) return true;
    }
    const start = parsed.searchParams.get('s');
    const life = parsed.searchParams.get('e');
    if (start && life && /^\d+$/.test(start) && /^\d+$/.test(life)) {
      if ((Number(start) + Number(life)) * 1000 < Date.now()) return true;
    }
  } catch {}
  return false;
}

function clipId(url) {
  const text = String(url || '');
  const embed = text.match(/embed-([a-z0-9]{6,})/i);
  if (embed) return embed[1].toLowerCase();
  const file = text.match(/\/([a-z0-9]{6,})_[a-z](?:\/|,)/i);
  if (file) return file[1].toLowerCase();
  return '';
}

function looksSigned(url) {
  try {
    const parsed = new URL(url);
    if (/googlevideo\.com|tiktokcdn|muscdn\.com|tiktokv\.com|fbcdn\.net|cloudfront\.net/i.test(parsed.hostname)) return true;
    for (const key of parsed.searchParams.keys()) {
      if (/^(expire|expires|oe|exp|signature|sig|hmac|x-amz-signature|policy|token)$/i.test(key)) return true;
    }
  } catch { /* not a url */ }
  return false;
}

function isExpiredError(error, record) {
  if (!error) return false;
  if (record && (linkLooksExpired(record.url) || linkLooksExpired(record.audioUrl))) return true;
  const msg = String(error.message || error);
  if (/browser check|browser did not continue|browser was sent a page|browser could not|web page instead of the file/i.test(msg) && sourcePageOf(record)) return true;
  if (/HTTP 410\b/.test(msg)) return true;
  if (error.code === 'LINK_EXPIRED' || /expired|signature/i.test(msg)) return true;
  const created = record && record.createdAt ? new Date(record.createdAt).getTime() : 0;
  const age = created ? Date.now() - created : Infinity;
  if (age < 30 * 1000) return false;
  if (!/HTTP (401|403)\b/.test(msg)) return false;
  return !!(record && (looksSigned(record.url) || looksSigned(record.audioUrl)));
}

function sourcePageOf(opts) {
  const ref = (opts && (opts.sourcePage || opts.referrer)) || '';
  if (!/^https?:\/\//i.test(ref)) return '';
  try {
    const page = new URL(ref);
    if (opts.url) {
      const file = new URL(opts.url);
      if (page.href === file.href) return '';
    }
    return page.href;
  } catch {
    return '';
  }
}

function videoKey(url) {
  if (!url) return '';
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/i);
  return match ? match[1] : '';
}

function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 12 && y.length > 12 && (x.includes(y) || y.includes(x))) return true;
  const xt = new Set(x.split(' ').filter((w) => w.length > 2));
  const yt = y.split(' ').filter((w) => w.length > 2);
  if (!xt.size || !yt.length) return false;
  const shared = yt.filter((w) => xt.has(w)).length;
  return shared >= 3 && shared / Math.min(xt.size, yt.length) >= 0.6;
}

function scoreMatch(record, data) {
  let score = 0;
  const page = record.sourcePage || record.referrer || '';
  const incoming = data.referrer || data.sourcePage || '';
  const key = videoKey(page) || videoKey(record.referrer);
  const other = videoKey(incoming);
  if (key && other && key !== other) return 0;
  if (namesMatch(record.fileName, data.fileName)) score += 100;
  if (page && incoming) {
    try {
      const a = new URL(page);
      const b = new URL(incoming);
      if (a.href === b.href) score += 80;
      else if (a.host === b.host && a.pathname === b.pathname && a.search === b.search) score += 75;
    } catch { /* ignore */ }
  }
  if (key && other && key === other) score += 90;
  const savedClip = clipId(record.url) || clipId(page) || clipId(record.referrer);
  const nextClip = clipId(data.url) || clipId(incoming);
  if (savedClip && nextClip && savedClip === nextClip) score += 90;
  return score;
}

module.exports = { linkLooksExpired, isExpiredError, sourcePageOf, scoreMatch };
