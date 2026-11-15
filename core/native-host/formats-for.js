// One quality line: playlists, yt-dlp, TikTok rescue, then enrich.
// keepOneFamily stays inside the capture library.

const fs = require('fs');
const os = require('os');
const path = require('path');

function isPlaylistUrl(url) {
  return /\.(m3u8|mpd)(\?|#|$)/i.test(url || '');
}

function isSegmentUrl(url) {
  return /\.(ts|m4s)(\?|#|$)/i.test(url || '');
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return String(url || '');
  }
}

function guessExt(url) {
  const match = String(url || '').match(/\.(mp4|webm|mkv|flv|avi|mov|m4v|3gp|ogg|ogv|ts|m3u8|mpd)(\?|#|$)/i);
  return match ? match[1].toLowerCase() : 'mp4';
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (!b) return '';
  if (b > 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function isTikTokPage(url) {
  return /tiktok\.com|tiktokcdn|musical\.ly/i.test(String(url || ''));
}

function urlHasItem(url) {
  if (!url) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const queryId = parsed.searchParams.get('v') || parsed.searchParams.get('video') || '';
  if (/^[A-Za-z0-9_-]{6,}$/.test(queryId)) return true;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.length === 1 && /^(home|explore|index|feed|reels|watch|trending|search|notifications)$/i.test(parts[0])) return false;
  if (/\d{6,}/.test(parsed.pathname + parsed.search)) return true;
  const tail = parts[parts.length - 1] || '';
  if (parts.length === 1 && tail.length >= 8) return true;
  return parts.length >= 2 && tail.length >= 5;
}

function usesCardMedia(url) {
  const value = String(url || '');
  if (/instagram\.com\/stories\//i.test(value)) return true;
  if (/^https?:\/\/(?:www\.)?instagram\.com\/?(?:[?#]|$)/i.test(value)) return true;
  if (/facebook\.com\/stories\//i.test(value)) return true;
  if (!/facebook\.com|fb\.watch/i.test(value)) return false;
  if (/\/reel\/\d{5,}/i.test(value)) return false;
  if (/\/videos\/\d{5,}/i.test(value)) return false;
  if (/[?&]v=\d{5,}/.test(value)) return false;
  if (/fb\.watch\/[A-Za-z0-9]+/i.test(value)) return false;
  return true;
}

function ownedItemUrl(url) {
  const value = String(url || '');
  if (/(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/[^/?#]+\/status\/\d+/i.test(value)) return true;
  if (/(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/i\/status\/\d+/i.test(value)) return true;
  if (/threads\.(?:com|net)\/@[^/]+\/post\/[A-Za-z0-9_-]+/i.test(value)) return true;
  if (/tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i.test(value)) return true;
  return false;
}

function directAudioFormats(pageFormats) {
  return (Array.isArray(pageFormats) ? pageFormats : []).filter((fmt) => fmt && fmt.direct && fmt.url && fmt.hasAudio && !fmt.hasVideo && !isPlaylistUrl(fmt.url));
}

function buildSnifferFormats(sniffed, videoSrc) {
  const media = Array.isArray(sniffed) ? sniffed : [];
  const formats = [];
  const seen = new Set();
  if (videoSrc && !String(videoSrc).startsWith('blob:') && !isSegmentUrl(videoSrc)) {
    seen.add(normalizeUrl(videoSrc));
    const hit = media.find((item) => item && normalizeUrl(item.url) === normalizeUrl(videoSrc));
    formats.push({
      quality: 'Original',
      url: videoSrc,
      ext: guessExt(videoSrc),
      hasVideo: true,
      hasAudio: true,
      filesize: hit && hit.filesize ? hit.filesize : null,
    });
    return formats;
  }
  const videos = media.filter((item) => {
    if (!item || !item.url || isSegmentUrl(item.url) || isPlaylistUrl(item.url)) return false;
    const type = item.contentType || '';
    return (type.includes('video') || /\.(mp4|webm|m4v|mkv|flv|avi|mov|3gp|ogg|ogv)(\?|#|$)/i.test(item.url))
      && (item.filesize == null || item.filesize > 500000);
  });
  const byHost = new Map();
  for (let i = videos.length - 1; i >= 0; i--) {
    const item = videos[i];
    const norm = normalizeUrl(item.url);
    if (seen.has(norm)) continue;
    let host = item.url;
    try { host = new URL(item.url).hostname; } catch { /* keep the raw url */ }
    if (!byHost.has(host)) byHost.set(host, item);
  }
  let idx = 0;
  for (const item of byHost.values()) {
    const norm = normalizeUrl(item.url);
    if (seen.has(norm)) continue;
    seen.add(norm);
    idx += 1;
    const sizeLabel = item.filesize ? formatBytes(item.filesize) : '';
    formats.push({
      quality: sizeLabel ? `Video ${idx} (${sizeLabel})` : `Video ${idx}`,
      url: item.url,
      ext: guessExt(item.url),
      hasVideo: true,
      hasAudio: true,
      filesize: item.filesize,
    });
  }
  return formats;
}

function mergeFormats(primary, extra) {
  const out = [];
  const seen = new Set();
  for (const fmt of [...(primary || []), ...(extra || [])]) {
    if (!fmt || !fmt.url) continue;
    const kind = `${fmt.hasVideo ? 'v' : ''}${fmt.hasAudio ? 'a' : ''}`;
    const key = `${normalizeUrl(fmt.url)}|${fmt.ext || ''}|${fmt.bitrate || 0}|${fmt.filesize || 0}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fmt);
  }
  return out;
}

function cookieFileFor(url, cookies) {
  if (!cookies) return '';
  const file = path.join(os.tmpdir(), `zdm_ext_cookies_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { domain = ''; }
  let text = '# Netscape HTTP Cookie File\n';
  String(cookies).split(/;\s*/).forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 1) return;
    text += `.${domain}\tTRUE\t/\tTRUE\t0\t${pair.slice(0, eq)}\t${pair.slice(eq + 1)}\n`;
  });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

async function extractViaYtDlp(grabber, pageUrl, videoSrc, cookies) {
  const urlToExtract = pageUrl || videoSrc;
  if (!urlToExtract || String(urlToExtract).startsWith('blob:')) return null;
  if (/threads\.(com|net)\//i.test(urlToExtract)) return null;
  const cookieFile = cookieFileFor(urlToExtract, cookies);
  try {
    const data = await grabber.extract(urlToExtract, { referer: pageUrl || urlToExtract, cookieFile: cookieFile || undefined });
    if (!data || ((!data.formats || !data.formats.length) && (!data.audioFormats || !data.audioFormats.length))) return null;
    const result = [];
    const bestAudio = [...(data.audioFormats || [])].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0) || (b.filesize || 0) - (a.filesize || 0))[0];
    for (const fmt of data.formats || []) {
      result.push({
        quality: fmt.resolution || fmt.note || '',
        url: fmt.url,
        audioUrl: (!fmt.hasAudio && bestAudio) ? bestAudio.url : null,
        formatId: fmt.id || '',
        ext: (fmt.ext && String(fmt.ext).toLowerCase()) || guessExt(fmt.url),
        hasVideo: fmt.hasVideo !== false,
        hasAudio: fmt.hasAudio !== false,
        filesize: fmt.filesize || null,
        note: fmt.note || '',
        resolution: fmt.resolution || '',
        bitrate: fmt.bitrate || 0,
        fps: Math.round(Number(fmt.fps) || 0),
      });
    }
    for (const fmt of data.audioFormats || []) {
      const kbps = fmt.bitrate ? `${fmt.bitrate} kbps` : '';
      result.push({
        quality: fmt.note || kbps || fmt.resolution || 'Audio',
        url: fmt.url,
        formatId: fmt.id || '',
        ext: (fmt.ext && String(fmt.ext).toLowerCase()) || guessExt(fmt.url),
        hasVideo: false,
        hasAudio: true,
        filesize: fmt.filesize || null,
        note: fmt.note || kbps,
        resolution: fmt.resolution || '',
        bitrate: fmt.bitrate || 0,
      });
    }
    return result.length ? { formats: result, title: data.title || '', duration: Number(data.duration) || 0, transcript: data.transcript || null } : null;
  } catch {
    return null;
  } finally {
    if (cookieFile) try { fs.unlinkSync(cookieFile); } catch { /* already gone */ }
  }
}

async function fetchPlaylistText(url, pageUrl, cookies) {
  if (typeof fetch !== 'function') return '';
  const headers = { Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*' };
  if (pageUrl) {
    headers.Referer = pageUrl;
    try { headers.Origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }
  if (cookies) headers.Cookie = cookies;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return '';
    const text = await res.text();
    if (/#EXTM3U/i.test(text) || /<MPD[\s>]/i.test(text)) return text.slice(0, 1500000);
  } catch { /* this child playlist stays out */ }
  return '';
}

async function expandOnce(expandPlaylists, body, playlists) {
  try {
    const result = expandPlaylists({
      pageUrl: body.extractUrl || '',
      videoSrc: body.videoSrc || '',
      pageFormats: body.pageFormats || [],
      sniffed: body.sniffed || [],
      playlists: playlists || [],
      listed: body.listed || [],
      allowSniff: !ownedItemUrl(body.extractUrl || ''),
    }) || {};
    return {
      formats: Array.isArray(result.formats) ? result.formats : [],
      need: Array.isArray(result.need) ? result.need.slice(0, 6) : [],
    };
  } catch {
    return { formats: [], need: [] };
  }
}

function qualityHeight(fmt) {
  const raw = `${fmt.resolution || ''} ${fmt.quality || ''}`;
  const pair = raw.match(/(\d+)\s*[x×*]\s*(\d+)/i);
  if (pair) return Math.min(Number(pair[1]), Number(pair[2]));
  const labeled = raw.match(/(\d+)\s*p/i);
  if (labeled) return Number(labeled[1]);
  const w = Number(fmt.width) || 0;
  const h = Number(fmt.height) || 0;
  if (w && h) return Math.min(w, h);
  return h || 0;
}

function qualityBitrate(fmt) {
  const n = Number(fmt.bitrate) || 0;
  if (n) return n;
  const match = `${fmt.note || ''} ${fmt.quality || ''}`.match(/(\d+)\s*k(?:bps)?/i);
  return match ? Number(match[1]) : 0;
}

function formatClock(seconds) {
  const n = Math.round(Number(seconds) || 0);
  if (!n) return '';
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function shortQuality(fmt) {
  const raw = `${fmt.resolution || ''} ${fmt.quality || ''}`;
  const pair = raw.match(/(\d+)\s*[x×*]\s*(\d+)/i);
  if (pair) return Math.min(Number(pair[1]), Number(pair[2])) + 'p';
  const labeled = String(fmt.quality || fmt.resolution || '').match(/(\d+)\s*p/i);
  if (labeled) return labeled[1] + 'p';
  const h = qualityHeight(fmt);
  if (h) return h + 'p';
  return String(fmt.quality || fmt.resolution || 'Video').replace(/\s*\((?:no audio|audio only)\)\s*/ig, ' ').trim();
}

function formatLabel(fmt, mode, fpsDisplay) {
  const note = String(fmt.note || '').trim();
  let main;
  if (!fmt.hasVideo && fmt.hasAudio) {
    const named = note && !/audio only/i.test(note) ? note : String(fmt.quality || '').replace(/audio only/ig, '').trim();
    main = named || 'Audio';
  } else {
    main = shortQuality(fmt);
  }
  if (mode !== 'full') main = main.replace(/\s*·?\s*\d+\s*kbps/ig, '').trim();
  const box = String(fmt.ext || '').toLowerCase();
  if (fmt.hasVideo && /^(ts|mp4|webm|mkv|mov|flv|avi|wmv)$/i.test(box) && !new RegExp(`\\b${box}\\b`, 'i').test(main)) {
    main = `${main} ${box.toUpperCase()}`.trim();
  }
  if (fmt.hasVideo && /watermark/i.test(note) && !/watermark/i.test(main)) main += ' (watermark)';
  const clock = formatClock(fmt.duration);
  if (clock && main.indexOf(clock) === -1) main = `${main} · ${clock}`;
  const rate = qualityBitrate(fmt);
  const rateLabel = mode === 'full' && rate && !new RegExp(`${rate}\\s*k`, 'i').test(main) ? ` · ${rate} kbps` : '';
  const fps = Math.round(Number(fmt.fps) || 0);
  const floor = fpsDisplay === 'off' ? 0 : (fpsDisplay === '30' ? 30 : 60);
  const fpsLabel = floor && fmt.hasVideo && fps >= floor && !new RegExp(`${fps}\\s*fps`, 'i').test(main) ? ` ${fps} fps` : '';
  const size = fmt.filesize ? ` - ${formatBytes(fmt.filesize)}` : '';
  return `${main}${fpsLabel}${rateLabel}${size}`.replace(/\s+/g, ' ').trim();
}

function badgeFor(fmt) {
  if (fmt.hasVideo && fmt.hasAudio) return { text: 'V+A', cls: 'zdm-badge-muxed' };
  if (fmt.hasVideo) return { text: 'V', cls: 'zdm-badge-video' };
  if (fmt.hasAudio) return { text: 'A', cls: 'zdm-badge-audio' };
  return null;
}

function listComplete(formats) {
  const rows = formats || [];
  if (!rows.length) return false;
  const ready = rows.some((fmt) => {
    const ext = String(fmt.ext || '').toLowerCase();
    const url = String(fmt.url || '');
    const file = /^(ts|mp4|m4a|mp3|wav|flac|ogg|webm|mkv)$/.test(ext);
    const master = /master\.m3u8|\/urlset\//i.test(url) || isPlaylistUrl(url);
    if (!file || master) return false;
    if (fmt.hasVideo === false && fmt.hasAudio) return true;
    return qualityHeight(fmt) > 0;
  });
  return ready;
}

function pickDefaultAudio(formats) {
  const audio = (formats || []).filter((fmt) => fmt && fmt.hasAudio && !fmt.hasVideo);
  if (!audio.length) return null;
  const marked = audio.filter((fmt) => fmt.isDefault || fmt.default || Number(fmt.language_preference) > 0 || /\b(default|original)\b/i.test(`${fmt.note || ''} ${fmt.quality || ''}`));
  const pool = marked.length ? marked : audio;
  return pool.slice().sort((a, b) => qualityHeight(b) - qualityHeight(a) || qualityBitrate(b) - qualityBitrate(a) || (b.filesize || 0) - (a.filesize || 0))[0];
}

function decorate(formats, mode, fpsDisplay) {
  const complete = listComplete(formats);
  const chosen = pickDefaultAudio(formats);
  return (formats || []).map((fmt) => {
    const row = Object.assign({}, fmt);
    row.label = formatLabel(row, mode, fpsDisplay);
    row.badge = badgeFor(row);
    row.defaultAudio = !!(chosen && chosen.url === row.url && row.hasAudio && !row.hasVideo);
    row.complete = complete;
    return row;
  });
}

function cookieHosts(formats, playlists) {
  const hosts = new Set();
  const add = (url) => {
    try { hosts.add(new URL(url).hostname); } catch { /* skip */ }
  };
  for (const fmt of formats || []) {
    if (fmt && fmt.url) add(fmt.url);
    if (fmt && fmt.audioUrl) add(fmt.audioUrl);
  }
  for (const item of playlists || []) {
    if (item && item.url) add(item.url);
  }
  return [...hosts];
}

async function enrich(enrichFormats, formats, body, duration) {
  const list = Array.isArray(formats) ? formats : [];
  if (!list.length) return list;
  try {
    const sized = await enrichFormats({
      formats: list,
      pageUrl: body.extractUrl || '',
      videoSrc: body.videoSrc || '',
      duration: duration || 0,
      cookie: body.cookies || '',
    });
    if (Array.isArray(sized) && sized.length) return sized;
  } catch { /* sizes stay as captured */ }
  return list;
}

async function fallbackFormats(body, grabber, rescueTikTok) {
  const extractUrl = body.extractUrl || '';
  const pageList = (body.pageFormats || []).filter((fmt) => fmt && fmt.url && !isPlaylistUrl(fmt.url));
  const sniffed = buildSnifferFormats(body.sniffed, body.videoSrc || '');
  if (usesCardMedia(extractUrl)) return { formats: pageList, title: '', duration: 0, transcript: null };
  if (!urlHasItem(extractUrl)) {
    if (isTikTokPage(extractUrl) || /instagram\.com/i.test(extractUrl)) return { formats: pageList, title: '', duration: 0, transcript: null };
    return { formats: pageList.length ? pageList : sniffed, title: '', duration: 0, transcript: null };
  }
  if (/tiktok\.com\/music\//i.test(extractUrl) || /threads\.(com|net)\//i.test(extractUrl)) {
    return { formats: pageList.length ? pageList : (/tiktok\.com\/music\//i.test(extractUrl) ? sniffed : []), title: '', duration: 0, transcript: null };
  }
  const src = body.videoSrc && !String(body.videoSrc).startsWith('blob:') ? body.videoSrc : '';
  const extracted = await extractViaYtDlp(grabber, extractUrl, src, body.cookies || '');
  let formats = extracted && extracted.formats;
  let title = extracted && extracted.title || '';
  let duration = extracted && extracted.duration || 0;
  let transcript = extracted && extracted.transcript || null;
  if ((!formats || !formats.length) && isTikTokPage(extractUrl)) {
    const id = (extractUrl.match(/\/(?:video|photo)\/(\d+)/) || [])[1];
    if (id) {
      try {
        const rescued = await rescueTikTok({ id, pageUrl: extractUrl, audioOnly: false });
        if (rescued && rescued.urls && rescued.urls.length) {
          formats = [{ quality: 'Original (No Watermark)', resolution: '720p', url: rescued.urls[0], ext: 'mp4', hasVideo: true, hasAudio: true, filesize: null }];
        }
      } catch { /* rescue missed */ }
    }
  }
  if (!formats || !formats.length) {
    const keepPage = isTikTokPage(extractUrl) || ownedItemUrl(extractUrl) || /instagram\.com/i.test(extractUrl);
    formats = keepPage ? pageList : sniffed;
  }
  return { formats: mergeFormats(formats, pageList), title, duration, transcript };
}

async function resolveFormats(body, deps) {
  const msg = body || {};
  const mode = msg.qualityMode === 'average' || msg.qualityMode === 'simple' ? msg.qualityMode : 'full';
  const fpsDisplay = msg.fpsDisplay === '30' || msg.fpsDisplay === 'off' ? msg.fpsDisplay : '60';
  const direct = directAudioFormats(msg.pageFormats);
  if (direct.length) {
    const sized = await enrich(deps.enrichFormats, direct, msg, 0);
    const formats = decorate(sized, mode, fpsDisplay);
    return { formats, title: '', duration: 0, transcript: msg.pageTranscript || null, cookieHosts: cookieHosts(formats, msg.playlists), complete: listComplete(formats) };
  }
  const youtube = /(?:youtube\.com|youtu\.be)/i.test(msg.extractUrl || '');
  let playlistFormats = [];
  if (!youtube) {
    const first = await expandOnce(deps.expandPlaylists, msg, msg.playlists || []);
    playlistFormats = first.formats;
    if (first.need.length) {
      const extra = [];
      for (const url of first.need) {
        const text = await fetchPlaylistText(url, msg.extractUrl || '', msg.cookies || '');
        if (text) extra.push({ url, text });
      }
      if (extra.length) {
        const again = await expandOnce(deps.expandPlaylists, msg, extra.concat(msg.playlists || []).slice(0, 30));
        if (again.formats.length) playlistFormats = again.formats;
      }
    }
  }
  let resolved;
  if (playlistFormats.length) {
    resolved = { formats: playlistFormats, title: '', duration: 0, transcript: null };
  } else {
    resolved = await fallbackFormats(msg, deps.grabber, deps.rescueTikTok);
  }
  const sized = await enrich(deps.enrichFormats, resolved.formats, msg, resolved.duration);
  const formats = decorate(sized, mode, fpsDisplay);
  const transcript = (resolved.transcript && resolved.transcript.url) ? resolved.transcript : (msg.pageTranscript || null);
  return {
    formats,
    title: resolved.title || '',
    duration: resolved.duration || 0,
    transcript,
    cookieHosts: cookieHosts(formats, msg.playlists),
    complete: listComplete(formats),
  };
}

module.exports = { resolveFormats, guessExt, formatBytes };
