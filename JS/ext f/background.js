const NATIVE_URL = 'http://127.0.0.1:29512';
const TICK_URL = 'http://127.0.0.1:29513';
let extSettings = null;

function catchSlice() {
  return (extSettings && extSettings.catch) || null;
}

function sniffAllowed() {
  const c = catchSlice();
  if (!c) return true;
  return c.sniffVideos !== false;
}

function interceptAllowed() {
  const c = catchSlice();
  if (!c) return true;
  return c.interceptDownloads !== false;
}

let lastQualityStamp = null;

function qualityFromSlice(slice) {
  const q = slice && slice.quality;
  const validModes = ['full', 'average', 'simple'];
  const mode = q && validModes.includes(q.qualityMode) ? q.qualityMode : 'full';
  const fps = q && (q.fpsDisplay === '30' || q.fpsDisplay === 'off') ? q.fpsDisplay : '60';
  const stamp = Number(q && q.qualityStamp) || 0;
  return { qualityMode: mode, fpsDisplay: fps, qualityStamp: stamp };
}

async function refreshExtSettings() {
  try {
    const res = await fetch(NATIVE_URL + '/settings', {
      headers: {
        'X-ZDM-Browser': browserKey(),
      },
    });
    if (res.ok) {
      extSettings = await res.json();
      const next = qualityFromSlice(extSettings);
      if (lastQualityStamp !== null && next.qualityStamp !== lastQualityStamp) qualityCache.clear();
      lastQualityStamp = next.qualityStamp;
    }
  } catch { /* app not running yet */ }
}

function safePost(port, msg) {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch { /* page went into back/forward cache */ }
  void chrome.runtime.lastError;
}

function settingsMessage() {
  const msg = { type: 'settings', catch: catchSlice() };
  if (extSettings && extSettings.quality) msg.quality = qualityFromSlice(extSettings);
  if (extSettings && typeof extSettings.active === 'boolean') msg.active = extSettings.active;
  if (extSettings && extSettings.rules && typeof extSettings.rules === 'object') msg.rules = extSettings.rules;
  return msg;
}

function pushSettings() {
  const msg = settingsMessage();
  for (const ports of tabPorts.values()) {
    for (const port of ports) safePost(port, msg);
  }
}
const EXTRACT_TIMEOUT_MS = 28000;

const tabMedia = new Map();
const tabPorts = new Map();
const qualityCache = new Map();

function getTabMedia(tabId) {
  if (!tabMedia.has(tabId)) tabMedia.set(tabId, []);
  return tabMedia.get(tabId);
}

function cacheKey(tabId, zdmId) {
  return `${tabId}:${zdmId}`;
}

function qualityKey(tabId, msg) {
  if (msg && msg.cacheKey) return `${tabId}:${msg.cacheKey}`;
  return cacheKey(tabId, msg.zdmId);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    ['range','rn','rbuf','bytestart','byteend','clen','lmt','dur','sq'].forEach(p => u.searchParams.delete(p));
    u.hash = '';
    return u.href;
  } catch { return url; }
}

function setBadge(tabId, text) {
  try {
    if (!chrome.action || typeof chrome.action.setBadgeText !== 'function') return;
    chrome.action.setBadgeText({ tabId, text: text || '' }).catch(() => {});
    if (text) chrome.action.setBadgeBackgroundColor({ tabId, color: '#0078d4' }).catch(() => {});
  } catch {}
}

function updateBadge(tabId) {
  const list = tabMedia.get(tabId);
  const count = list ? list.length : 0;
  setBadge(tabId, count > 0 ? count.toString() : '');
}

function broadcastAudio(tabId, frameId, url, filesize, contentType, pageUrl, title) {
  const ports = tabPorts.get(tabId);
  if (!ports) return;
  const payload = {
    type: 'audio-seen',
    url,
    filesize: filesize || 0,
    contentType: contentType || '',
    title: title || '',
    pageUrl: pageUrl || '',
  };
  for (const port of ports) {
    if (port.__frameId != null && frameId != null && port.__frameId !== frameId) continue;
    safePost(port, payload);
  }
}

function replayAudio(port, tabId) {
  const list = tabMedia.get(tabId) || [];
  for (const entry of list) {
    if (!entry.audio) continue;
    if (!entry.documentUrl) continue;
    if (port.__frameId != null && entry.frameId != null && port.__frameId !== entry.frameId) continue;
    safePost(port, {
      type: 'audio-seen',
      url: entry.url,
      filesize: entry.filesize || 0,
      contentType: entry.contentType || '',
      title: entry.title || '',
      pageUrl: entry.documentUrl || entry.initiator || '',
    });
  }
}

function addMedia(tabId, entry) {
  if (!entry || !entry.url || isSegmentUrl(entry.url)) return;
  const list = getTabMedia(tabId);
  const norm = normalizeUrl(entry.url);
  const existing = list.find(m => normalizeUrl(m.url) === norm);
  if (existing) {
    if (entry.filesize && (!existing.filesize || entry.filesize > existing.filesize)) {
      existing.filesize = entry.filesize;
    }
    return;
  }
  list.push(entry);
  while (list.length > 80) list.shift();
  if (isPlaylistUrl(entry.url) || /mpegurl|dash\+xml/i.test(entry.contentType || '')) {
    for (const key of qualityCache.keys()) {
      if (String(key).startsWith(`${tabId}:`)) qualityCache.delete(key);
    }
  }
  updateBadge(tabId);
}

const dispositionNames = new Map();

function rememberDisposition(url, header) {
  const value = String(header || '').trim();
  if (!url || !value) return;
  const keys = [url];
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    keys.push(parsed.href, `${parsed.origin}${parsed.pathname}`);
  } catch { /* exact url is enough */ }
  for (const key of keys) {
    dispositionNames.delete(key);
    dispositionNames.set(key, value);
  }
  while (dispositionNames.size > 90) dispositionNames.delete(dispositionNames.keys().next().value);
}

function dispositionName(url) {
  if (!url) return '';
  if (dispositionNames.has(url)) return dispositionNames.get(url);
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (dispositionNames.has(parsed.href)) return dispositionNames.get(parsed.href);
    return dispositionNames.get(`${parsed.origin}${parsed.pathname}`) || '';
  } catch {
    return '';
  }
}

const sniffQueue = [];
let sniffTimer = null;

function queueSniff(item) {
  sniffQueue.push(item);
  while (sniffQueue.length > 400) sniffQueue.shift();
  if (!sniffTimer) sniffTimer = setTimeout(flushSniff, 500);
}

async function flushSniff() {
  sniffTimer = null;
  const batch = sniffQueue.splice(0, 80);
  if (!batch.length) return;
  if (sniffQueue.length) sniffTimer = setTimeout(flushSniff, 500);
  let media = null;
  try {
    const res = await fetch(NATIVE_URL + '/sniff/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: batch.map((item) => ({
          url: item.url,
          contentType: item.contentType,
          length: item.length,
          disposition: item.disposition,
        })),
      }),
    });
    const data = await res.json();
    if (data && Array.isArray(data.media)) media = data.media;
  } catch { /* the desktop app is closed, so this batch is not classified here */ }
  if (!media) return;
  const byUrl = new Map();
  for (const item of batch) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  for (const row of media) {
    const item = byUrl.get(row && row.url);
    if (!item) continue;
    const filesize = row.filesize == null ? item.length : row.filesize;
    addMedia(item.tabId, {
      url: row.url,
      contentType: row.contentType || item.contentType || '',
      frameId: item.frameId,
      filesize,
      initiator: item.initiator || '',
      documentUrl: item.documentUrl || '',
      audio: !!row.audio,
      title: row.title || '',
    });
    if (row.audio) broadcastAudio(item.tabId, item.frameId, row.url, filesize, row.contentType || item.contentType || '', item.documentUrl || item.initiator || '', row.title || '');
  }
}

function addHeaderListener(eventName, listener, filter, spec) {
  const api = chrome.webRequest && chrome.webRequest[eventName];
  if (!api || typeof api.addListener !== 'function') return;
  try {
    api.addListener(listener, filter, spec);
  } catch {
    const plain = (spec || []).filter((name) => name !== 'extraHeaders');
    try { api.addListener(listener, filter, plain); } catch { /* this browser will not expose those headers */ }
  }
}

function qualitiesReply(sendResponse) {
  let sent = false;
  return {
    postMessage(payload) {
      if (sent) return;
      sent = true;
      try { sendResponse(payload); } catch { /* the menu closed before the formats arrived */ }
    },
  };
}

function emptyQualities(msg) {
  return {
    type: 'qualities',
    zdmId: msg && msg.zdmId,
    formats: [],
    title: '',
    playGen: (msg && msg.playGen) || 0,
    cacheKey: (msg && msg.cacheKey) || '',
    transcript: null,
    cookieHosts: [],
    menu: null,
  };
}

// A Firefox event page drops a long-lived port while formats are still loading.
// onMessage stays open until sendResponse, so the menu can leave the spinner.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'get-qualities') return;
  const tabId = sender && sender.tab && sender.tab.id;
  const reply = qualitiesReply(sendResponse);
  if (tabId == null) {
    reply.postMessage(emptyQualities(msg));
    return true;
  }
  handleGetQualities(tabId, reply, msg).catch(() => {
    reply.postMessage(emptyQualities(msg));
  });
  return true;
});

addHeaderListener('onHeadersReceived', (details) => {
  const headers = details.responseHeaders || [];
  const disposition = headers.find((h) => h.name.toLowerCase() === 'content-disposition')?.value || '';
  rememberDisposition(details.url, disposition);
  if (!sniffAllowed()) return;
  if (details.tabId < 0) return;
  const ct = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  const cl = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value;
  const range = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-range')?.value || '';
  const rangeSize = range.match(/\/(\d+)\s*$/);
  const filesize = rangeSize ? parseInt(rangeSize[1], 10) : (cl ? parseInt(cl, 10) : null);
  queueSniff({
    url: details.url,
    contentType: ct,
    disposition,
    length: Number.isFinite(filesize) ? filesize : null,
    tabId: details.tabId,
    frameId: details.frameId,
    initiator: details.initiator || '',
    documentUrl: details.documentUrl || '',
  });
}, { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'object', 'other'] }, ['responseHeaders', 'extraHeaders']);

const sentHeaders = new Map();
let replayRuleId = 700000;
const SW_TAB = (chrome.tabs && chrome.tabs.TAB_ID_NONE != null) ? chrome.tabs.TAB_ID_NONE : -1;
const DOCUMENT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';

function headerValue(headers, name) {
  if (!headers) return '';
  const wanted = String(name || '').toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key] || '';
  }
  return '';
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function siteHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  const parts = host.split('.');
  if (parts.length >= 3 && /^[a-z]{1,3}\d{1,4}$/i.test(parts[0])) return parts.slice(1).join('.');
  return host;
}

function rememberSentHeaders(url, keep, extra) {
  if (!url || !keep || !Object.keys(keep).length) return;
  const row = Object.assign({ headers: keep }, extra || {});
  const keys = new Set([url]);
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    keys.add(parsed.href);
    keys.add(normalizeUrl(url));
    keys.add(parsed.origin + parsed.pathname);
  } catch { /* the raw url is enough */ }
  for (const key of keys) sentHeaders.set(key, row);
  while (sentHeaders.size > 300) sentHeaders.delete(sentHeaders.keys().next().value);
}

function lookupSent(url) {
  if (!url) return null;
  if (sentHeaders.has(url)) return sentHeaders.get(url);
  const norm = normalizeUrl(url);
  if (sentHeaders.has(norm)) return sentHeaders.get(norm);
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (sentHeaders.has(parsed.href)) return sentHeaders.get(parsed.href);
    const pathKey = parsed.origin + parsed.pathname;
    if (sentHeaders.has(pathKey)) return sentHeaders.get(pathKey);
  } catch { /* no match */ }
  return null;
}

function isHumanPage(url) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  try {
    const path = new URL(url).pathname;
    // The file request itself is not the page. A start or file gate still is.
    if (/\/download\/[^/]*$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function firstHumanPage(list) {
  for (const value of list || []) {
    if (isHumanPage(value)) return value;
  }
  return '';
}

function fetchSite(url, referrer) {
  try {
    const target = new URL(url);
    if (!referrer) return 'none';
    const from = new URL(referrer);
    if (target.origin === from.origin) return 'same-origin';
    if (siteHost(target.hostname) === siteHost(from.hostname)) return 'same-site';
    return 'cross-site';
  } catch {
    return 'cross-site';
  }
}

async function withReplayHeaders(url, referrer, captured, run) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return run(); }
  if (!chrome.declarativeNetRequest) return run();
  const capturedOrigin = headerValue(captured, 'origin');
  let origin = capturedOrigin;
  if (!origin && referrer) {
    try { origin = new URL(referrer).origin; } catch { origin = ''; }
  }
  const accept = headerValue(captured, 'accept') || DOCUMENT_ACCEPT;
  const language = headerValue(captured, 'accept-language');
  const requestHeaders = [
    referrer
      ? { header: 'Referer', operation: 'set', value: referrer }
      : { header: 'Referer', operation: 'remove' },
    origin
      ? { header: 'Origin', operation: 'set', value: origin }
      : { header: 'Origin', operation: 'remove' },
    { header: 'Accept', operation: 'set', value: accept },
    language ? { header: 'Accept-Language', operation: 'set', value: language } : null,
    { header: 'Sec-Fetch-Mode', operation: 'set', value: 'navigate' },
    { header: 'Sec-Fetch-Dest', operation: 'set', value: 'document' },
    { header: 'Sec-Fetch-Site', operation: 'set', value: fetchSite(url, referrer) },
    { header: 'Sec-Fetch-User', operation: 'set', value: '?1' },
  ].filter(Boolean);
  if (captured) {
    for (const key of Object.keys(captured)) {
      if (/^sec-ch-ua/i.test(key) && captured[key]) {
        requestHeaders.push({ header: key, operation: 'set', value: captured[key] });
      }
    }
  }
  const ruleId = ++replayRuleId;
  const condition = {
    urlFilter: '||' + (siteHost(host) || host) + '^',
    tabIds: [SW_TAB],
    resourceTypes: ['xmlhttprequest'],
  };
  const install = (rows) => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 2,
      condition,
      action: { type: 'modifyHeaders', requestHeaders: rows },
    }],
  });
  let installed = false;
  try {
    await install(requestHeaders);
    installed = true;
  } catch (err) {
    const safe = requestHeaders.filter((row) => !/^sec-fetch-/i.test(row.header));
    try {
      await install(safe);
      installed = true;
    } catch (err2) {
      console.warn('[ZDM FILE-PULL] header rule failed', (err2 && err2.message) || (err && err.message));
    }
  }
  try {
    return await run();
  } finally {
    if (installed) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
    }
  }
}

addHeaderListener('onBeforeSendHeaders', (details) => {
  if (!details || details.tabId < 0) return;
  if (!['main_frame', 'sub_frame', 'other'].includes(details.type)) return;
  const keep = {};
  for (const header of details.requestHeaders || []) {
    if (!header || !header.name) continue;
    if (/^(referer|cookie|user-agent|accept|accept-language|origin|sec-ch-ua.*)$/i.test(header.name)) {
      keep[header.name] = header.value || '';
    }
  }
  rememberSentHeaders(details.url, keep, {
    documentUrl: details.documentUrl || '',
    tabId: details.tabId,
  });
}, { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'other'] }, ['requestHeaders', 'extraHeaders']);

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  if (tabId == null) return;
  port.__frameId = port.sender?.frameId;
  if (!tabPorts.has(tabId)) tabPorts.set(tabId, new Set());
  tabPorts.get(tabId).add(port);
  replayAudio(port, tabId);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    const ports = tabPorts.get(tabId);
    if (ports) { ports.delete(port); if (!ports.size) tabPorts.delete(tabId); }
  });
  refreshExtSettings().then(() => {
    safePost(port, settingsMessage());
    safePost(port, { type: 'set-button-style', style: currentButtonStyle });
  });
  port.onMessage.addListener(async (msg) => {

    if (msg && (msg.type === 'video-found' || msg.type === 'get-qualities' || msg.type === 'download')) {
      try {
        console.log('[ZDM-BG] Message received: ' + msg.type, {
          zdmId: msg.zdmId,
          postUrl: msg.postUrl || msg.pageUrl,
          title: msg.pageTitle || msg.fileName,
          src: (msg.src || '').slice(0, 80)
        });
      } catch {}
    }
    switch (msg.type) {

      case 'thread-debug':
        try { console.log('[ZDM-THREADS]', ...(msg.args || [])); } catch {}
        break;

      case 'capture-page-scripts': {
        let data = { rows: [], source: '', ask: true, collect: null };
        try {
          const res = await fetch(NATIVE_URL + '/capture/interpret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'resolve',
              site: msg.site || '',
              pageUrl: msg.pageUrl,
              scripts: msg.scripts,
              seen: msg.seen,
              resources: msg.resources,
              blocked: msg.blocked,
              videoCount: msg.videoCount,
            }),
          });
          data = await res.json();
        } catch { /* the desktop app is closed, so the page keeps its own read */ }
        const formats = (data && (data.rows || data.formats)) || [];
        safePost(port, {
          type: 'capture-page-scripts',
          requestId: msg.requestId,
          formats,
          source: (data && data.source) || (formats.length ? 'app' : ''),
          ask: data && typeof data.ask === 'boolean' ? data.ask : undefined,
          sig: (data && data.sig) || '',
          collect: (data && data.collect) || null,
          menu: (data && data.menu) || null,
        });
        break;
      }

      case 'capture-ingest': {
        try {
          const res = await fetch(NATIVE_URL + '/capture/interpret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'ingest',
              site: msg.site,
              pageUrl: msg.pageUrl,
              body: typeof msg.body === 'string' ? msg.body : '',
            }),
          });
          if (res.ok) safePost(port, { type: 'capture-ingested', site: msg.site || '' });
        } catch { /* the desktop app is closed, so the page keeps its own story read */ }
        break;
      }

      case 'capture-resolve': {
        let data = { identity: { url: '', title: '' }, rows: [], menu: null, collect: null, ask: true };
        try {
          const res = await fetch(NATIVE_URL + '/capture/interpret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'resolve',
              site: msg.site,
              pageUrl: msg.pageUrl,
              card: msg.card,
              storyView: msg.storyView,
              settings: msg.settings,
              videoCount: msg.videoCount,
            }),
          });
          data = await res.json();
        } catch { /* the desktop app is closed, so the page keeps its own read */ }
        safePost(port, {
          type: 'capture-resolve',
          requestId: msg.requestId,
          identity: (data && data.identity) || { url: '', title: '' },
          rows: (data && data.rows) || [],
          menu: (data && data.menu) || null,
          collect: (data && data.collect) || null,
          ask: data && typeof data.ask === 'boolean' ? data.ask : true,
          skip: !!(data && data.skip),
        });
        break;
      }

      case 'capture-interpret': {
        let data = null;
        try {
          const res = await fetch(NATIVE_URL + '/capture/interpret', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'resolve',
              site: msg.site,
              pageUrl: msg.pageUrl,
              postUrl: msg.postUrl,
              code: msg.code,
              caption: msg.caption,
              tokens: msg.tokens,
              played: msg.played,
              bodies: msg.bodies,
              directLines: msg.directLines,
              id: msg.id,
              item: msg.item,
              shortcode: msg.shortcode,
              author: msg.author,
              items: msg.items,
              scripts: msg.scripts,
              card: msg.card,
              settings: msg.settings,
            }),
          });
          data = await res.json();
        } catch { /* the desktop app is closed, so the page keeps its own read */ }
        const formats = (data && (data.rows || data.formats)) || [];
        safePost(port, {
          type: 'capture-formats',
          requestId: msg.requestId,
          formats,
          source: formats.length ? 'app' : '',
          ask: data && typeof data.ask === 'boolean' ? data.ask : undefined,
          sig: (data && data.sig) || '',
          collect: (data && data.collect) || null,
          menu: (data && data.menu) || null,
        });
        break;
      }

      case 'playlist-body':
        rememberCaptured([{ url: msg.url, text: msg.text }]);
        break;
      case 'video-found':
        preloadQualities(tabId, msg, port);
        break;
      case 'video-playing':
        if (msg.resetCache) qualityCache.delete(qualityKey(tabId, msg));
        preloadQualities(tabId, msg);
        break;
      case 'video-src-changed':
        preloadQualities(tabId, msg);
        break;
      case 'get-qualities':
        await handleGetQualities(tabId, port, msg);
        break;
      case 'download':
        await handleDownload(tabId, msg, port.__frameId);
        break;
    }
  });
});

function storedPlaylists() {
  const playlists = [];
  let budget = 5200000;
  for (const [url, text] of capturedPlaylists) {
    if (!url || !text || playlists.length >= 30) break;
    const body = String(text).slice(0, 1500000);
    const cost = body.length + String(url).length + 64;
    if (cost > budget) continue;
    budget -= cost;
    playlists.push({ url, text: body });
  }
  return playlists;
}

async function askFormats(tabId, msg) {
  const extractUrl = msg.postUrl || msg.pageUrl || '';
  const sniffed = (getTabMedia(tabId) || []).slice(0, 80).map((item) => ({
    url: item.url,
    contentType: item.contentType || '',
    filesize: item.filesize || null,
  }));
  const quality = qualityFromSlice(extSettings);
  const res = await fetch(NATIVE_URL + '/capture/formats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extractUrl,
      videoSrc: msg.src || '',
      pageFormats: msg.pageFormats || [],
      sniffed,
      cookies: await pageCookies(extractUrl),
      playlists: storedPlaylists(),
      listed: Array.isArray(msg.listed) ? msg.listed : [],
      pageTranscript: msg.pageTranscript || null,
      qualityMode: quality.qualityMode,
      fpsDisplay: quality.fpsDisplay,
    }),
    signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

function preloadQualities(tabId, msg, port) {
  const key = qualityKey(tabId, msg);
  const videoSrc = msg.src || '';
  const extractUrl = msg.postUrl || msg.pageUrl || '';
  const gen = msg.playGen || 0;
  const hasPageFormats = Array.isArray(msg.pageFormats) && msg.pageFormats.length;
  if (!extractUrl && !hasPageFormats) return;

  const sig = (msg.pageFormats || []).map((f) => (f && f.url) || '').sort().join('|');
  const existing = qualityCache.get(key);
  if (existing && existing.sig === sig && (existing.status === 'loading' ||
     (existing.status === 'ready' && existing.formats && existing.formats.length))) {
    if (existing.status === 'ready' && port) postQualities(port, msg, existing.formats, existing.title, existing.transcript, existing.cookieHosts, existing.menu);
    return;
  }

  qualityCache.set(key, { status: 'loading', formats: null, src: videoSrc, playGen: gen, cacheKey: msg.cacheKey || '', sig });

  (async () => {
    const data = await askFormats(tabId, msg);
    const formats = data && Array.isArray(data.formats) ? data.formats : [];
    const current = qualityCache.get(key);
    if (!(current && current.status === 'loading' && current.sig === sig && (current.playGen || 0) === gen)) return;
    if (!formats.length) {
      qualityCache.delete(key);
      return;
    }
    const title = (data && data.title) || msg.pageTitle || '';
    const transcript = postedTranscript(msg, data && data.transcript);
    const cookieHosts = data && Array.isArray(data.cookieHosts) ? data.cookieHosts : [];
    const menu = readyMenu(data);
    qualityCache.set(key, { status: 'ready', formats, title, src: videoSrc, playGen: gen, cacheKey: msg.cacheKey || '', sig, transcript, cookieHosts, menu });
    if (port) postQualities(port, msg, formats, title, transcript, cookieHosts, menu);
  })().catch(() => {
    const current = qualityCache.get(key);
    if (current && current.status === 'loading' && current.sig === sig && (current.playGen || 0) === gen) {
      qualityCache.delete(key);
    }
  });
}

function postedTranscript(msg, extracted) {
  const pageTranscript = msg && msg.pageTranscript && msg.pageTranscript.url ? msg.pageTranscript : null;
  const got = extracted && extracted.url ? extracted : null;
  return got || pageTranscript || null;
}

function readyMenu(data) {
  const menu = data && data.menu;
  if (!menu || !Array.isArray(menu.choices) || !menu.choices.length) return null;
  return {
    video: Array.isArray(menu.video) ? menu.video : [],
    audio: Array.isArray(menu.audio) ? menu.audio : [],
    choices: menu.choices,
  };
}

function postQualities(port, msg, formats, title, transcript, cookieHosts, menu) {
  try {
    console.log('[ZDM-BG] Sending qualities to content script for #' + msg.zdmId + ':', {
      title: title || '',
      formatsCount: (formats || []).length,
      formats: (formats || []).map(f => (f.quality || f.resolution || '') + (f.filesize ? ' (' + Math.round(f.filesize / 1024) + 'KB)' : ''))
    });
  } catch {}
  safePost(port, {
    type: 'qualities',
    zdmId: msg.zdmId,
    formats: formats || [],
    title: title || '',
    playGen: msg.playGen || 0,
    cacheKey: msg.cacheKey || '',
    transcript: transcript || null,
    cookieHosts: cookieHosts || [],
    menu: menu || null,
  });
}

async function handleGetQualities(tabId, port, msg) {
  const videoSrc = msg.src || '';
  const extractUrl = msg.postUrl || msg.pageUrl || '';
  const key = qualityKey(tabId, msg);
  const gen = msg.playGen || 0;
  const sig = (msg.pageFormats || []).map((f) => (f && f.url) || '').sort().join('|');
  if (!extractUrl && !(Array.isArray(msg.pageFormats) && msg.pageFormats.length)) {
    postQualities(port, msg, [], '', postedTranscript(msg, null), []);
    return;
  }
  const cached = qualityCache.get(key);
  if (cached && cached.status === 'ready' && cached.formats && cached.formats.length && cached.sig === sig) {
    postQualities(port, msg, cached.formats, cached.title, postedTranscript(msg, cached.transcript), cached.cookieHosts, cached.menu);
    return;
  }
  if (cached && cached.status === 'loading') {
    const start = Date.now();
    while (Date.now() - start < 2500) {
      await new Promise((r) => setTimeout(r, 200));
      const current = qualityCache.get(key);
      if (!current || current.status === 'ready') {
        if (current && current.status === 'ready' && current.formats && current.formats.length) {
          postQualities(port, msg, current.formats, current.title, postedTranscript(msg, current.transcript), current.cookieHosts, current.menu);
          return;
        }
        break;
      }
    }
  }
  let data = null;
  try {
    data = await askFormats(tabId, msg);
  } catch {
    qualityCache.delete(key);
    postQualities(port, msg, [], '', postedTranscript(msg, null), []);
    return;
  }
  const formats = data && Array.isArray(data.formats) ? data.formats : [];
  const title = (data && data.title) || msg.pageTitle || '';
  const transcript = postedTranscript(msg, data && data.transcript);
  const hosts = data && Array.isArray(data.cookieHosts) ? data.cookieHosts : [];
  const menu = readyMenu(data);
  const current = qualityCache.get(key);
  if (formats.length && (!current || current.status !== 'ready' || !(current.formats && current.formats.length))) {
    qualityCache.set(key, { status: 'ready', formats, title, src: videoSrc, playGen: gen, cacheKey: msg.cacheKey || '', sig, transcript, cookieHosts: hosts, menu });
  } else if (!formats.length) {
    qualityCache.delete(key);
  }
  postQualities(port, msg, formats, title, transcript, hosts, menu || (current && current.menu) || null);
}

async function pageCookies(url) {
  try {
    const domain = new URL(url).hostname;
    const all = await Promise.race([
      chrome.cookies.getAll({ domain }),
      new Promise((resolve) => setTimeout(() => resolve([]), 4000)),
    ]);
    return (all || []).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  } catch { return ''; }
}

function isPlaylistUrl(url) {
  return /\.(m3u8|mpd)(\?|#|$)/i.test(url || '');
}

function isSegmentUrl(url) {
  return /\.(ts|m4s)(\?|#|$)/i.test(url || '');
}

const capturedPlaylists = new Map();

function rememberCaptured(list) {
  for (const item of list || []) {
    if (!item || !item.url || !item.text || item.text.length > 1500000) continue;
    if (!/#EXTM3U/i.test(item.text) && !/<MPD[\s>]/i.test(item.text)) continue;
    const key = normalizeUrl(item.url);
    capturedPlaylists.delete(key);
    capturedPlaylists.set(key, item.text);
    while (capturedPlaylists.size > 30) capturedPlaylists.delete(capturedPlaylists.keys().next().value);
  }
}

function askPageForMedia(tabId, mediaUrl, shareUrl) {
  const ports = tabPorts.get(tabId);
  if (!ports || !ports.size) return Promise.resolve(null);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onReply);
      resolve(null);
    }, 20000);
    function onReply(msg) {
      if (!msg || msg.type !== 'page-fetch-result' || msg.requestId !== requestId) return;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onReply);
      let bytes = null;
      if (msg.ok && msg.buffer64) {
        try {
          const bin = atob(msg.buffer64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          bytes = u8.buffer;
        } catch { bytes = null; }
      }
      resolve(bytes && bytes.byteLength > 50000 ? bytes : null);
    }
    chrome.runtime.onMessage.addListener(onReply);
    for (const port of ports) {
      safePost(port, { type: 'fetch-media', requestId, url: mediaUrl, shareUrl: shareUrl || '' });
    }
  });
}

async function tiktokRescueFromApp(pageUrl, audioOnly) {
  const id = ((pageUrl || '').match(/\/(?:video|photo)\/(\d+)/) || [])[1] || '';
  if (!id) return null;
  try {
    const res = await fetch(NATIVE_URL + '/capture/tiktok-rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pageUrl: pageUrl || '', audioOnly: !!audioOnly }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (!data || data.source !== 'app' || !Array.isArray(data.urls) || !data.urls.length) return null;
    try { console.log('[ZDM] tiktok-rescue: urls=' + data.urls.length); } catch {}
    return data.urls;
  } catch {
    return null;
  }
}

async function pullTikTokSession(id, url, pageUrl, audioOnly) {
  if (!id || !url) return 'failed';
  const armed = await fileNote(id, '/session-file/arm', {
    url,
    referrer: pageUrl || '',
    pageUrl: pageUrl || '',
    audio: !!audioOnly,
  });
  if (!armed || armed.status !== 'ok') return 'failed';
  const outcome = await pullFileDirect({
    id,
    url,
    referrer: pageUrl || '',
    pageUrl: pageUrl || '',
    offset: 0,
    size: 0,
    keepAlive: true,
  });
  if (outcome !== 'saved') await fileNote(id, '/session-file/drop', {});
  return outcome || 'failed';
}

async function saveTikTokFromPage(tabId, fileName, pageUrl, mediaUrl, recordId) {
  const bytes = await askPageForMedia(tabId, mediaUrl, pageUrl);
  if (!bytes) return false;
  const saved = await fetch(NATIVE_URL + '/browser-save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-ZDM-Name': encodeURIComponent(fileName || 'video.mp4'),
      'X-ZDM-Page': encodeURIComponent(pageUrl || ''),
      'X-ZDM-Source': encodeURIComponent(mediaUrl || ''),
      'X-ZDM-Id': recordId || '',
    },
    body: bytes,
  });
  return saved.ok;
}

async function askDownloadPlan(msg, pageUrl) {
  try {
    const res = await fetch(NATIVE_URL + '/download/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: msg.url || '',
        pageUrl: pageUrl || '',
        audioOnly: !!msg.audioOnly && !msg.transcript,
        id: msg.id || '',
        bodies: Array.isArray(msg.bodies) ? msg.bodies : [],
      }),
    });
    const data = await res.json();
    if (!data || !Array.isArray(data.steps)) return null;
    return data;
  } catch {
    return null;
  }
}

async function copyPlanCookies(payload, urls) {
  try {
    const map = new Map();
    for (const u of urls || []) {
      if (!u || String(u).startsWith('blob:')) continue;
      const list = await chrome.cookies.getAll({ url: u });
      for (const c of list) map.set(c.name, c.value);
    }
    const cookies = [...map.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
    if (cookies) {
      payload.headers.Cookie = cookies;
      payload.cookies = cookies;
    }
  } catch {}
}

async function runDownloadSteps(tabId, msg, frameId, payload, plan) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const pageUrl = msg.pageUrl || payload.sourcePage || '';
  for (const step of steps) {
    if (step && step.action === 'cookies') await copyPlanCookies(payload, step.urls);
  }
  const notice = steps.find((step) => step && step.action === 'notice') || null;
  const rescue = steps.some((step) => step && step.action === 'fetch-stream' && step.source === 'rescue');
  const fromPage = steps.some((step) => step && step.action === 'fetch-stream' && step.source === 'page');
  if (plan.direct) {
    sendToNative(payload);
    broadcastToTab(tabId, { type: 'download-started', zdmId: msg.zdmId });
    return;
  }
  if (rescue || fromPage) {
    payload.confirm = true;
    const reply = await sendToNative(payload);
    broadcastToTab(tabId, { type: 'download-started', zdmId: msg.zdmId });
    if (!reply || !reply.go) return;
    const savedName = reply.fileName || payload.fileName;
    let held = false;
    try {
      if (reply.id && filePulls.has(reply.id)) {
        retireCaptures(reply.id);
        await fileNote(reply.id, '/session-file/drop', {});
        for (let i = 0; i < 30 && filePulls.has(reply.id); i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (reply.id && !filePulls.has(reply.id)) {
        filePulls.add(reply.id);
        held = true;
      }
      if (held && rescue) {
        const rescued = await tiktokRescueFromApp(pageUrl, !!msg.audioOnly);
        for (const url of rescued || []) {
          const outcome = await pullTikTokSession(reply.id, url, pageUrl, !!msg.audioOnly);
          if (outcome === 'saved') return;
        }
        await fileNote(reply.id, '/session-file/drop', {});
      }
      const pageStep = steps.find((step) => step && step.action === 'fetch-stream' && step.source === 'page');
      const pageFile = (pageStep && pageStep.url) || msg.url;
      if (fromPage && !msg.audioOnly && await saveTikTokFromPage(tabId, savedName, pageUrl, pageFile, reply.id)) return;
      if (held) {
        await fileNote(reply.id, '/session-file/fail', {
          message: notice && notice.title ? notice.title + '.' : 'TikTok did not give the file.',
        });
      }
    } catch (err) {
      console.warn('[ZDM] TikTok page fetch failed', err);
      if (reply.id) await fileNote(reply.id, '/session-file/drop', {});
    } finally {
      if (held) filePulls.delete(reply.id);
    }
    if (notice) {
      sendToNative({
        type: 'new-download',
        notice: true,
        fileName: savedName,
        noticeTitle: notice.title || 'TikTok did not give the file',
        noticeBody: notice.body || '',
      });
    }
    return;
  }
  const browser = steps.some((step) => step && (step.action === 'set-headers' || (step.action === 'fetch-stream' && step.browser)));
  if (isPlaylistUrl(payload.url) || browser) {
    await attachMediaCookies(payload);
    const started = await sendToNative({ ...payload, browserPull: browser, confirm: true });
    if (!started || !started.id || started.go === false) return;
    broadcastToTab(tabId, { type: 'download-started', zdmId: msg.zdmId });
    if (!browser) return;
    pullSessionHls(tabId, frameId, started.id, payload, started.connections, planIdleMs(plan)).catch((err) => {
      sessionFail(started.id, (err && err.message) || 'HTTP 403');
    });
    return;
  }
  sendToNative(payload);
  broadcastToTab(tabId, { type: 'download-started', zdmId: msg.zdmId });
}

async function handleDownload(tabId, msg, frameId) {
  if (!interceptAllowed()) return;
  const pageUrl = msg.pageUrl || '';
  const gated = await askGate({
    source: 'menu',
    url: msg.url,
    pageUrl,
    referrer: pageUrl,
    title: msg.pageTitle || '',
    quality: msg.quality || '',
    ext: msg.ext || '',
    audioOnly: !!msg.audioOnly,
    transcript: !!msg.transcript,
    size: msg.filesize || 0,
  });
  if (!gated || !gated.name) return;
  try {
    console.log('[ZDM-BG] handleDownload:', {
      fileName: gated.name,
      pageUrl,
      mediaUrl: (msg.url || '').slice(0, 80),
      size: msg.filesize || 0
    });
  } catch {}
  const payload = {
    type: 'new-download',
    url: msg.url,
    audioUrl: msg.audioUrl || null,
    fileName: gated.name,
    size: msg.filesize || 0,
    audioSize: msg.audioFilesize || 0,
    duration: Number(msg.duration) || 0,
    headers: gated.headers || {},
    referrer: (gated.headers && gated.headers.Referer) || pageUrl,
    sourcePage: pageUrl,
    frameId: frameId || 0,
    cookieHosts: Array.isArray(msg.cookieHosts) ? msg.cookieHosts : [],
    formatId: msg.formatId || '',
    audioFormatId: msg.audioFormatId || '',
    isPageGrab: false,
  };

  payload.audioOnly = !!msg.audioOnly && !msg.transcript;

  await attachRequestCookies(payload, pageUrl);

  const plan = await askDownloadPlan(msg, pageUrl);
  if (plan) {
    await runDownloadSteps(tabId, msg, frameId, payload, plan);
    return;
  }

  sendToNative(payload);
  broadcastToTab(tabId, { type: 'download-started', zdmId: msg.zdmId });
}

function cachedPlaylist(url) {
  const norm = normalizeUrl(url);
  if (capturedPlaylists.has(norm)) return capturedPlaylists.get(norm);
  for (const [key, text] of capturedPlaylists) {
    if (key.split('?')[0] === norm.split('?')[0]) return text;
  }
  return '';
}

const detachedPulls = new Set();
const pullsByTab = new Map();
const keeperTabs = new Map();
const hlsCookieStore = new Map();
let hlsRuleIdCounter = 900000;
const hlsRuleIds = new Map();

async function captureHlsCookies(id, urls) {
  const map = new Map();
  const domains = new Set();
  for (const u of urls) {
    if (!u || String(u).startsWith('blob:')) continue;
    try {
      const list = await chrome.cookies.getAll({ url: u });
      for (const c of list) map.set(c.name, c.value);
      domains.add(new URL(u).hostname);
    } catch {}
  }
  const cookies = [...map.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  if (cookies) hlsCookieStore.set(id, cookies);
  return cookies;
}

async function installHlsHeaderRules(id, mediaUrl, pageUrl) {
  if (!chrome.declarativeNetRequest) return;
  const cookies = hlsCookieStore.get(id) || '';
  if (!cookies) return;
  let host;
  try { host = new URL(mediaUrl).hostname; } catch { return; }
  let origin = '';
  try { origin = new URL(pageUrl).origin; } catch {}
  const ruleId = ++hlsRuleIdCounter;
  const oldIds = hlsRuleIds.get(id) || [];
  hlsRuleIds.set(id, [...oldIds, ruleId]);
  const requestHeaders = [
    { header: 'Cookie', operation: 'set', value: cookies },
  ];
  if (pageUrl) requestHeaders.push({ header: 'Referer', operation: 'set', value: pageUrl });
  if (origin) requestHeaders.push({ header: 'Origin', operation: 'set', value: origin });
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        condition: {
          urlFilter: '||' + host,
          tabIds: [SW_TAB],
          resourceTypes: ['xmlhttprequest', 'media', 'other'],
        },
        action: { type: 'modifyHeaders', requestHeaders },
      }],
    });
    console.log('[ZDM] HLS header rule installed for', host, 'ruleId', ruleId);
  } catch (err) {
    console.warn('[ZDM] declarativeNetRequest rule failed', err);
  }
}

async function removeHlsHeaderRules(id) {
  const ruleIds = hlsRuleIds.get(id);
  hlsRuleIds.delete(id);
  hlsCookieStore.delete(id);
  if (!ruleIds || !ruleIds.length) return;
  if (!chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
  } catch {}
}

async function postPiece(id, index, total, body, lane, lanes, range) {
  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-ZDM-Id': id,
    'X-ZDM-Index': String(index),
    'X-ZDM-Total': String(total),
    'X-ZDM-Lane': String(lane || 0),
    'X-ZDM-Lanes': String(lanes || 0),
  };
  if (range) headers['X-ZDM-Range'] = String(range);
  const saved = await fetch(NATIVE_URL + '/session-hls/piece', {
    method: 'POST',
    headers,
    body,
  });
  const ack = await saved.json().catch(() => ({}));
  return { ok: saved.ok, ack };
}

function noteSessionFlight(msg) {
  if (!msg || !msg.id || !Array.isArray(msg.rows) || !msg.rows.length) return;
  fetch(TICK_URL + '/session-hls/tick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: msg.id, rows: msg.rows }),
  }).catch(() => {});
}

async function announceLanes(id, lanes, total) {
  try {
    await fetch(NATIVE_URL + '/session-hls/lanes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, lanes, total: Number(total) || 0 }),
    });
  } catch { /* the first saved piece still tells the app how many connections are open */ }
}

function planIdleMs(plan) {
  const value = plan && plan.hls && Number(plan.hls.idleMs);
  if (!Number.isFinite(value) || value < 1000 || value > 120000) return 20000;
  return value;
}

async function bytesFromExtension(url, pageUrl, piece, byteRange, idleMs) {
  const headers = { Accept: '*/*' };
  if (byteRange) headers.Range = byteRange;
  if (pageUrl) {
    headers.Referer = pageUrl;
    try { headers.Origin = new URL(pageUrl).origin; } catch { /* ignore a bad page url */ }
  }
  const waitMs = Number.isFinite(Number(idleMs)) && Number(idleMs) >= 1000 ? Number(idleMs) : 20000;
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), waitMs);
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), waitMs);
  };
  let res;
  try {
    res = await fetch(url, { headers, credentials: 'include', cache: 'no-store', signal: ctrl.signal });
  } catch (err) {
    clearTimeout(idle);
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return { status: 0, contentRange: '', error: aborted ? 'timed out' : ((err && err.message) || 'failed') };
  }
  bump();
  const contentRange = res.headers.get('content-range') || '';
  if (piece && piece.id && byteRange && res.status !== 206) {
    clearTimeout(idle);
    return { status: res.status, contentRange, error: 'range refused' };
  }
  if (!res.ok || !res.body) {
    clearTimeout(idle);
    return { status: res.status, contentRange, error: 'HTTP ' + res.status };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  let lastNote = 0;
  const note = (force) => {
    if (!(piece && piece.id)) return;
    const now = Date.now();
    if (!force && now - lastNote < 32) return;
    lastNote = now;
    noteSessionFlight({
      id: piece.id,
      rows: [{ lane: piece.lane || 0, index: piece.index, loaded }],
    });
  };
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      bump();
      chunks.push(step.value);
      loaded += step.value.byteLength;
      note(false);
    }
  } catch (err) {
    clearTimeout(idle);
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return { status: 0, contentRange, error: aborted ? 'timed out' : ((err && err.message) || 'failed') };
  }
  clearTimeout(idle);
  note(true);
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!(piece && piece.id)) {
    return { status: res.status, buffer: buffer.buffer, contentRange, error: '' };
  }
  const posted = await postPiece(piece.id, piece.index, piece.total, buffer.buffer, piece.lane, piece.lanes, byteRange);
  return { status: res.status, size: loaded, contentRange, ack: posted.ack, error: posted.ok ? '' : 'HTTP 403' };
}

async function sessionFail(id, message) {
  try {
    await fetch(NATIVE_URL + '/session-hls/fail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, message: message || 'HTTP 403' }),
    });
  } catch { /* the app already closed the download */ }
}

async function holdSession(id, hold) {
  try {
    await fetch(NATIVE_URL + '/session-hls/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, hold: !!hold }),
    });
  } catch { /* the app is closed */ }
}

function rememberPull(tabId, id) {
  if (tabId == null || tabId < 0 || !id) return;
  let ids = pullsByTab.get(tabId);
  if (!ids) {
    ids = new Set();
    pullsByTab.set(tabId, ids);
  }
  ids.add(id);
}

function forgetPull(tabId, id) {
  const ids = pullsByTab.get(tabId);
  if (!ids) return;
  ids.delete(id);
  if (!ids.size) pullsByTab.delete(tabId);
}

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      setTimeout(resolve, 600);
    };
    const timer = setTimeout(done, 12000);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') done();
    }).catch(() => done());
  });
}

async function openKeeperTab(pageUrl) {
  if (!pageUrl) return null;
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: false });
    if (!tab || tab.id == null) return null;
    await waitForTab(tab.id);
    return tab.id;
  } catch {
    return null;
  }
}

async function pullSessionHls(tabId, frameId, id, payload, connections, idleMs) {
  console.log('[ZDM HLS-PULL] START pullSessionHls', { tabId, frameId, id, url: (payload.url || '').slice(0, 80) });
  rememberPull(tabId, id);
  await holdSession(id, true);
  try {
    return await pullSessionHlsInner(tabId, frameId, id, payload, connections, idleMs);
  } finally {
    forgetPull(tabId, id);
    detachedPulls.delete(id);
    await removeHlsHeaderRules(id);
    await holdSession(id, false);
    const keeper = keeperTabs.get(id);
    if (keeper != null && keeper === tabId) {
      keeperTabs.delete(id);
      chrome.tabs.remove(keeper).catch(() => {});
    }
  }
}

async function askHlsPlan(id, text, baseUrl, connections, probe) {
  const res = await fetch(NATIVE_URL + '/session-hls/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      text: String(text || ''),
      baseUrl: baseUrl || '',
      connections,
      probe: probe || null,
    }),
  });
  return await res.json();
}

async function askHlsNext(id) {
  const res = await fetch(NATIVE_URL + '/session-hls/next?id=' + encodeURIComponent(id));
  return await res.json();
}

async function askHlsRetry(id, index) {
  const res = await fetch(NATIVE_URL + '/session-hls/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, retry: index }),
  });
  return await res.json();
}

async function hlsVariantFromApp(mediaUrl, text, wanted) {
  try {
    const res = await fetch(NATIVE_URL + '/capture/hls-variant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: mediaUrl || '',
        text: String(text || '').slice(0, 1500000),
        wanted: wanted || '',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data && data.source === 'app' && data.url) return data.url;
  } catch { /* the desktop app is closed */ }
  return '';
}

async function pullSessionHlsInner(tabId, frameId, id, payload, connections, idleMs) {
  const pageUrl = payload.referrer || payload.sourcePage || '';
  const waitMs = Number.isFinite(Number(idleMs)) && Number(idleMs) >= 1000 ? Number(idleMs) : 20000;
  let mediaUrl = payload.url;
  await captureHlsCookies(id, [mediaUrl, pageUrl]);
  await installHlsHeaderRules(id, mediaUrl, pageUrl);
  const fetchText = async (url) => {
    const saved = cachedPlaylist(url);
    if (saved && /#EXTM3U/i.test(saved)) return saved;
    const res = await bytesFromExtension(url, pageUrl, null, '', waitMs);
    if (!res || !res.buffer || (res.status || 0) >= 400) {
      throw new Error((res && res.error) || ('HTTP ' + ((res && res.status) || 403)));
    }
    const t = new TextDecoder().decode(res.buffer);
    if (!/#EXTM3U/i.test(t)) throw new Error('HTTP ' + (res.status || 403));
    return t;
  };
  let text = await fetchText(mediaUrl);
  console.log('[ZDM HLS-PULL] playlist fetched, length:', text.length, 'isVariant:', !/#EXT-X-STREAM-INF/i.test(text));
  if (/#EXT-X-STREAM-INF/i.test(text)) {
    const wanted = ((payload.fileName || '').match(/_(\d{3,4})p/i) || [])[1] || '';
    const pickUrl = await hlsVariantFromApp(mediaUrl, text, wanted);
    try { console.log('[ZDM] hls-variant: ' + (pickUrl ? 'app' : 'closed')); } catch {}
    if (!pickUrl) throw new Error('Open ZDM to choose this HLS quality');
    mediaUrl = pickUrl;
    await captureHlsCookies(id, [mediaUrl, pageUrl]);
    await installHlsHeaderRules(id, mediaUrl, pageUrl);
    text = await fetchText(mediaUrl);
  }
  const wantedLanes = Math.max(1, Math.min(32, Number(connections) || 8));
  let plan = await askHlsPlan(id, text, mediaUrl, wantedLanes, null);
  while (plan && plan.paused) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    plan = await askHlsPlan(id, text, mediaUrl, wantedLanes, null);
  }
  if (!plan || plan.stopped) return;
  if (plan.needProbe) {
    const probe = await bytesFromExtension(plan.probeUrl, pageUrl, { range: 'bytes=0-1' }, 'bytes=0-1', waitMs);
    plan = await askHlsPlan(id, text, mediaUrl, wantedLanes, {
      status: probe && probe.status,
      contentRange: probe && probe.contentRange,
    });
    while (plan && plan.paused) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      plan = await askHlsPlan(id, text, mediaUrl, wantedLanes, {
        status: probe && probe.status,
        contentRange: probe && probe.contentRange,
      });
    }
  }
  if (!plan || plan.stopped) return;
  const pieces = Array.isArray(plan.plan) ? plan.plan : [];
  if (!pieces.length) throw new Error('HTTP 403');
  const lanes = Math.max(1, Number(plan.lanes) || 1);
  const total = Number(plan.total) || pieces.length;
  await announceLanes(id, lanes, total);
  let failure = null;
  const pullPiece = async (item, piece) => {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const byteRange = (piece && piece.range) || '';
      const res = await bytesFromExtension(item.url, pageUrl, piece, byteRange, waitMs);
      if (res && (res.aborted || res.error === 'aborted')) return { aborted: true, ack: { status: 'paused', paused: true } };
      const ack = (res && res.ack) || {};
      if (ack.paused || ack.status === 'stopped' || ack.status === 'paused') return res;
      const failed = !res || res.error || (res.status || 0) >= 400 || ack.status === 'error';
      if (!failed) return res;
      last = res;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    return last;
  };
  let leave = false;
  const worker = async (lane) => {
    while (!failure && !leave) {
      let next = null;
      try {
        next = await askHlsNext(id);
      } catch (err) {
        failure = err instanceof Error ? err : new Error('HTTP 403');
        return;
      }
      if (!next || next.stopped) {
        leave = true;
        return;
      }
      if (next.paused) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      if (next.done || !next.piece) return;
      const item = next.piece;
      const res = await pullPiece(item, {
        id,
        index: item.index,
        total,
        lane,
        lanes,
        range: item.range || '',
      });
      const ack = (res && res.ack) || {};
      if (res && (res.aborted || ack.paused || ack.status === 'paused')) {
        try { await askHlsRetry(id, item.index); } catch (err) {
          failure = err instanceof Error ? err : new Error('HTTP 403');
          return;
        }
        continue;
      }
      if (ack.status === 'stopped') {
        leave = true;
        return;
      }
      if (!res || res.error || (res.status || 0) >= 400 || ack.status === 'error') {
        failure = new Error((res && (res.error || (res.ack && res.ack.message))) || ('HTTP ' + ((res && res.status) || 403)));
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, lane) => worker(lane)));
  if (leave) return;
  if (failure) {
    await sessionFail(id, failure.message);
    return;
  }
  const done = await fetch(NATIVE_URL + '/session-hls/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, total }),
  });
  const result = await done.json().catch(() => ({}));
  if (!done.ok || (result && result.status === 'error')) {
    await sessionFail(id, (result && result.message) || 'HTTP 403');
  }
}

async function attachMediaCookies(payload) {
  const urls = [payload.referrer, payload.sourcePage, payload.url];
  const hosts = new Set(Array.isArray(payload.cookieHosts) ? payload.cookieHosts.filter(Boolean) : []);
  if (!hosts.size) {
    const text = cachedPlaylist(payload.url);
    const found = String(text || '').match(/https?:\/\/[^ \s"'<>]+/gi) || [];
    for (const item of found.slice(0, 40)) urls.push(item);
  }
  const map = new Map();
  for (const part of String(payload.cookies || '').split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const item of urls) {
    try { hosts.add(new URL(item).hostname); } catch { /* skip a bad address */ }
  }
  for (const host of hosts) {
    try {
      const list = await chrome.cookies.getAll({ domain: host });
      for (const cookie of list) map.set(cookie.name, cookie.value);
    } catch { /* this host has no cookie jar entry */ }
  }
  const cookies = [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  if (!cookies) return;
  payload.headers = payload.headers || {};
  payload.headers.Cookie = cookies;
  payload.cookies = cookies;
}

async function attachRequestCookies(payload, pageUrl) {
  if (pageUrl) {
    try { payload.headers.Origin = new URL(pageUrl).origin; } catch { /* ignore bad page url */ }
  }
  try {
    const map = new Map();
    for (const u of [pageUrl, payload.url, payload.audioUrl]) {
      if (!u || String(u).startsWith('blob:')) continue;
      const list = await chrome.cookies.getAll({ url: u });
      for (const c of list) map.set(c.name, c.value);
    }
    const cookies = [...map.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
    if (cookies) {
      payload.headers.Cookie = cookies;
      payload.cookies = cookies;
    }
  } catch { /* download still goes out with the referer */ }
}

function broadcastToTab(tabId, msg) {
  const ports = tabPorts.get(tabId);
  if (ports) for (const p of ports) safePost(p, msg);
}

async function sendToNative(msg) {
  try {
    const res = await fetch(NATIVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch {
    console.warn('[ZDM] Could not reach ZDM app');
    return null;
  }
}

const takenDownloads = new Set();
const waitingFilename = new Map();
const pendingGates = new Map();

let detectedBrowserKey = null;

try {
  if (typeof chrome !== 'undefined' && (chrome.braveShields || chrome.brave)) {
    detectedBrowserKey = 'brave';
  }
} catch {}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  try {
    chrome.storage.local.get(['zdmBrowserKey'], (data) => {
      if (data && data.zdmBrowserKey) {
        detectedBrowserKey = data.zdmBrowserKey;
      }
    });
  } catch {}
}

let currentButtonStyle = 'square';

function updateActionIcon(style) {
  const isCircle = style === 'circle';
  const prefix = isCircle ? 'icons/icon-circle-' : 'icons/icon-square-';
  if (chrome.action && typeof chrome.action.setIcon === 'function') {
    chrome.action.setIcon({
      path: {
        16: prefix + '16.png',
        48: prefix + '48.png',
        128: prefix + '128.png',
      },
    }).catch(() => {});
  }
}

function broadcastButtonStyle(style) {
  currentButtonStyle = style === 'circle' ? 'circle' : 'square';
  updateActionIcon(currentButtonStyle);
  const msg = { type: 'set-button-style', style: currentButtonStyle };
  for (const ports of tabPorts.values()) {
    for (const port of ports) safePost(port, msg);
  }
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (tab && tab.id != null) {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
        }
      }
    });
  }
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get({ buttonStyle: 'square' }, (stored) => {
    currentButtonStyle = stored && stored.buttonStyle === 'circle' ? 'circle' : 'square';
    updateActionIcon(currentButtonStyle);
  });
  try { chrome.storage.local.remove('browserOnlyHosts'); } catch { /* old list is unused */ }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'button-style-changed') {
      broadcastButtonStyle(msg.style);
      return;
    }
    if (msg && msg.type === 'settings-changed') {
      refreshExtSettings().then(pushSettings);
      return;
    }
    if (msg && msg.type === 'zdm-browser-detected' && msg.browser) {
      if (detectedBrowserKey !== msg.browser) {
        detectedBrowserKey = msg.browser;
        try {
          chrome.storage.local.set({ zdmBrowserKey: msg.browser });
        } catch {}
        refreshExtSettings();
      }
    }
  });
}

function browserKey() {
  if (detectedBrowserKey) return detectedBrowserKey;
  if (typeof chrome !== 'undefined' && (chrome.braveShields || chrome.brave)) return 'brave';
  if (typeof navigator !== 'undefined' && navigator.brave) return 'brave';
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\//.test(ua) || /Opera\//.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Vivaldi\//.test(ua)) return 'vivaldi';
  if (/Chromium\//.test(ua)) return 'chromium';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'chrome';
}

function browserGateBody(item) {
  const url = (item && (item.finalUrl || item.url)) || '';
  const size = item && item.fileSize > 0 ? item.fileSize : (item && item.totalBytes > 0 ? item.totalBytes : 0);
  return {
    source: 'browser',
    url,
    filename: (item && item.filename) || '',
    disposition: dispositionName(url),
    size: size || 0,
    referrer: (item && item.referrer) || '',
    pageUrl: (item && item.referrer) || '',
    nameReady: !!(item && item._nameReady),
  };
}

async function askGate(body) {
  try {
    const res = await fetch(NATIVE_URL + '/browser/gate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ZDM-Browser': browserKey(),
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function cookiesFor(urls) {
  const map = new Map();
  for (const url of urls) {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
    try {
      const list = await chrome.cookies.getAll({ url });
      for (const cookie of list) map.set(cookie.name, cookie.value);
    } catch { /* cookie store blocked */ }
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function pageFromTab(tabId) {
  if (tabId == null || tabId < 0) return '';
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && tab.url) || '';
  } catch {
    return '';
  }
}

async function takeBrowserDownload(item, fileName, builtHeaders) {
  const url = item.finalUrl || item.url;
  const captured = lookupSent(url);
  const headerMap = captured && captured.headers;
  const tabPage = captured ? await pageFromTab(captured.tabId) : '';
  const page = firstHumanPage([
    captured && captured.documentUrl,
    tabPage,
    item.referrer,
  ]) || item.referrer || '';
  let headers;
  let cookies = '';
  let exactHeaders = false;
  if (headerMap && Object.keys(headerMap).length) {
    headers = Object.assign({}, headerMap);
    cookies = headerValue(headers, 'cookie');
    exactHeaders = true;
  } else {
    cookies = await cookiesFor([url, page]);
    headers = Object.assign({}, builtHeaders || {});
    if (!headers['User-Agent']) headers['User-Agent'] = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (!headers.Referer && page) headers.Referer = page;
    if (cookies) headers.Cookie = cookies;
  }
  const result = await sendToNative({
    type: 'new-download',
    url,
    fileName: fileName || '',
    size: item.fileSize > 0 ? item.fileSize : (item.totalBytes > 0 ? item.totalBytes : 0),
    headers,
    referrer: headerValue(headers, 'referer') || page,
    cookies,
    sourcePage: page,
    isPageGrab: false,
    immediate: true,
    exactHeaders,
  });
  const started = !!(result && result.status === 'started');
  if (!started) takenDownloads.delete(item.id);
  return started;
}

const EXT_STARTED = Date.now();

function isOldDownload(item) {
  if (!item) return true;
  if (item.state === 'complete' || item.state === 'interrupted') return true;
  if (item.paused) return true;
  if ((item.bytesReceived || 0) > 0) return true;
  const started = Date.parse(item.startTime || '');
  return Number.isFinite(started) && started < EXT_STARTED - 4000;
}

async function considerBrowserDownload(item) {
  if (!item || takenDownloads.has(item.id)) return;
  if (isOldDownload(item)) return;
  const url = item.finalUrl || item.url || '';
  if (!/^https?:\/\//i.test(url)) return;
  const decision = await askGate(browserGateBody(item));
  if (!decision) return;
  if (decision.wait) {
    if (!waitingFilename.has(item.id)) {
      waitingFilename.set(item.id, item);
      setTimeout(() => {
        const waiting = waitingFilename.get(item.id);
        if (!waiting || takenDownloads.has(waiting.id)) return;
        waitingFilename.delete(item.id);
        waiting._nameReady = true;
        considerBrowserDownload(waiting);
      }, 2500);
    }
    return;
  }
  waitingFilename.delete(item.id);
  if (isCaptureDownload(item)) return;
  if (!decision.take || takenDownloads.has(item.id)) return;
  takenDownloads.add(item.id);
  await cancelDownload(item.id);
  const started = await takeBrowserDownload(item, decision.name, decision.headers);
  if (!started) {
    console.log('[ZDM] browser download cancelled but the app did not start', { id: item.id });
  }
}

function downloadUrlOf(item) {
  return (item && (item.finalUrl || item.url)) || '';
}

function sameCaptureUrl(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    if (a.href.split('#')[0] === b.href.split('#')[0]) return true;
    return a.hostname === b.hostname && a.pathname === b.pathname;
  } catch {
    return String(left || '') === String(right || '');
  }
}

function isCaptureDownload(item) {
  if (!item || captureFileTabs.size === 0) return false;
  const url = downloadUrlOf(item);
  const referrer = item.referrer || '';
  for (const [, entry] of captureFileTabs) {
    if (!entry) continue;
    if (entry.url && sameCaptureUrl(entry.url, url)) return true;
    if (entry.pageUrl && sameCaptureUrl(entry.pageUrl, url)) return true;
    if (entry.pageUrl && sameCaptureUrl(entry.pageUrl, referrer)) {
      // A confirmation page is a document, not the file this capture is waiting for.
      if (isHumanPage(url)) continue;
      return true;
    }
  }
  return false;
}

function closeGate(id) {
  const gate = pendingGates.get(id);
  if (!gate || gate.closed) return;
  gate.closed = true;
  if (gate.timer) clearTimeout(gate.timer);
  pendingGates.delete(id);
  // Suggest while the download is still in progress. Calling it after cancel
  // makes Chrome report "Download must be in progress".
  try { gate.suggest(); } catch { /* download already settled */ }
}

function takeGate(id) {
  closeGate(id);
  return cancelDownload(id);
}

function cancelDownload(id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.cancel(id, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function gateBrowserDownload(item, suggest) {
  const id = item && item.id;
  if (id == null) {
    try { suggest(); } catch { /* nothing to settle */ }
    return;
  }
  if (isCaptureDownload(item)) {
    console.log('[ZDM CAPTURE] skipping takeover for capture-tab download', { downloadId: id, url: (item.url || '').slice(0, 120) });
    takenDownloads.add(id);
    try { suggest(); } catch { /* already settled */ }
    cancelDownload(id);
    return;
  }
  const existing = pendingGates.get(id);
  if (existing && !existing.closed) {
    existing.item = Object.assign(existing.item, item);
    existing.suggest = suggest;
  } else {
    pendingGates.set(id, { item, suggest, timer: 0, busy: false, closed: false, rerun: false });
  }
  settleGate(id);
}

function settleGate(id) {
  const gate = pendingGates.get(id);
  if (!gate || gate.closed || gate.busy) return;
  gate.busy = true;
  (async () => {
    try {
      if (gate.closed) return;
      if (isOldDownload(gate.item)) {
        closeGate(id);
        return;
      }
      const decision = await askGate(browserGateBody(gate.item));
      if (gate.closed) return;
      if (!decision) {
        closeGate(id);
        return;
      }
      if (decision.wait) {
        gate.busy = false;
        if (gate.rerun) {
          gate.rerun = false;
          settleGate(id);
          return;
        }
        if (!gate.timer) {
          gate.timer = setTimeout(() => {
            gate.timer = 0;
            if (gate.closed) return;
            gate.item._nameReady = true;
            settleGate(id);
          }, 1500);
        }
        return;
      }
      if (isCaptureDownload(gate.item)) {
        takenDownloads.add(id);
        await takeGate(id);
        return;
      }
      if (!decision.take || takenDownloads.has(id)) {
        closeGate(id);
        return;
      }
      const item = gate.item;
      const name = decision.name;
      takenDownloads.add(id);
      waitingFilename.delete(id);
      await takeGate(id);
      const started = await takeBrowserDownload(item, name, decision.headers);
      if (!started) {
        console.log('[ZDM] browser download cancelled but the app did not start', { id });
      }
    } catch {
      closeGate(id);
    }
  })();
}

if (chrome.downloads && chrome.downloads.onCreated) {
  if (chrome.downloads.onDeterminingFilename) {
    // Hold the download here, before Chrome opens the save dialog. suggest()
    // is called with no filename so a download we leave to Chrome still opens
    // in the last folder. A download the app takes is released, then cancelled.
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      gateBrowserDownload(item, suggest);
      return true;
    });
  } else {
    chrome.downloads.onCreated.addListener((item) => {
      considerBrowserDownload(item);
    });
  }
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.filename || !delta.filename.current) return;
    const gate = pendingGates.get(delta.id);
    if (gate && !gate.closed) {
      gate.item.filename = delta.filename.current;
      gate.item._nameReady = true;
      if (gate.busy) gate.rerun = true;
      else settleGate(delta.id);
      return;
    }
    const waiting = waitingFilename.get(delta.id);
    if (!waiting || takenDownloads.has(delta.id)) return;
    waiting.filename = delta.filename.current;
    waiting._nameReady = true;
    considerBrowserDownload(waiting);
  });
}

refreshExtSettings().then(pushSettings);
setInterval(() => refreshExtSettings().then(pushSettings), 15000);
try {
  chrome.alarms.create('zdm-beat', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== 'zdm-beat') return;
    refreshExtSettings().then(pushSettings);
    resumePending().catch(() => {});
  });
} catch { /* this browser has no alarms API */ }

const resumePulls = new Set();

async function findPageTarget(pageUrl, frameId) {
  if (!pageUrl) return null;
  let wanted = '';
  try { wanted = new URL(pageUrl).href.split('#')[0]; } catch { return null; }
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((row) => row && row.url && row.url.split('#')[0] === wanted);
  if (!tab || tab.id == null) return null;
  return { tabId: tab.id, frameId: Number(frameId) || 0 };
}

async function readPending() {
  try {
    const res = await fetch(NATIVE_URL + '/session/pending');
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return {
      pulls: Array.isArray(data.pulls) ? data.pulls : [],
      files: Array.isArray(data.files) ? data.files : [],
    };
  } catch {
    return null;
  }
}

async function resumePending() {
  const pending = await readPending();
  if (!pending) return;
  await resumePendingPulls(pending.pulls);
  await resumePendingFiles(pending.files);
}

async function resumePendingPulls(ready) {
  let list = ready;
  if (!list) {
    const pending = await readPending();
    if (!pending) return;
    list = pending.pulls;
  }
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || !item.id || resumePulls.has(item.id)) continue;
    resumePulls.add(item.id);
    const payload = {
      url: item.url,
      referrer: item.sourcePage,
      sourcePage: item.sourcePage,
      fileName: item.fileName || '',
    };
    const target = await findPageTarget(item.sourcePage, item.frameId);
    const run = async () => {
      if (target) return pullSessionHls(target.tabId, target.frameId, item.id, payload, item.connections);
      try {
        return await pullSessionHls(-1, 0, item.id, payload, item.connections);
      } catch (err) {
        const keeper = await openKeeperTab(item.sourcePage);
        if (keeper == null) throw err;
        keeperTabs.set(item.id, keeper);
        return pullSessionHls(keeper, 0, item.id, payload, item.connections);
      }
    };
    run()
      .catch((err) => sessionFail(item.id, (err && err.message) || 'HTTP 403'))
      .finally(() => resumePulls.delete(item.id));
  }
}

const filePulls = new Set();

async function postFileChunk(id, offset, bytes, total) {
  const res = await fetch(NATIVE_URL + '/session-file/chunk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-ZDM-Id': id,
      'X-ZDM-Offset': String(offset),
      'X-ZDM-Total': String(total || 0),
    },
    body: bytes,
  });
  return res.json().catch(() => ({ status: 'error' }));
}

async function fileNote(id, path, body) {
  const res = await fetch(NATIVE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ id }, body || {})),
  }).catch(() => null);
  if (!res) return null;
  return res.json().catch(() => null);
}

const captureFileTabs = new Map();
const captureEpoch = new Map();

function retireCaptures(id) {
  const epoch = (captureEpoch.get(id) || 0) + 1;
  captureEpoch.set(id, epoch);
  for (const [tabId, entry] of captureFileTabs) {
    if (!entry || entry.id !== id || entry.pulling) continue;
    captureFileTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => {});
  }
  return epoch;
}

async function humanPageFor(item) {
  const url = (item && (item.finalUrl || item.url)) || '';
  const captured = lookupSent(url);
  const tabPage = captured ? await pageFromTab(captured.tabId) : '';
  const direct = firstHumanPage([
    item && item.pageUrl,
    captured && captured.documentUrl,
    tabPage,
    item && item.referrer,
  ]);
  if (direct) return direct;
  const host = siteHost(hostOf(url));
  if (!host) return '';
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isHumanPage(tab && tab.url)) continue;
      const tabHost = hostOf(tab.url);
      if (tabHost === host || siteHost(tabHost) === host || tabHost.endsWith('.' + host)) return tab.url;
    }
  } catch { /* no open file page */ }
  return '';
}

async function showCapturePage(page) {
  let wanted = page;
  try { wanted = new URL(page).href.split('#')[0]; } catch { /* use the raw url */ }
  try {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => {
      const raw = (tab && (tab.url || tab.pendingUrl)) || '';
      try { return new URL(raw).href.split('#')[0] === wanted; } catch { return raw === page; }
    });
    if (existing && existing.id != null) {
      await chrome.tabs.update(existing.id, { active: true });
      return existing;
    }
  } catch { /* open a new tab */ }
  return chrome.tabs.create({ url: page, active: true });
}

async function captureFileFromTab(item, epoch) {
  const id = item.id;
  const fileUrl = (item && (item.finalUrl || item.url)) || '';
  const page = (await humanPageFor(item)) || (/^https?:\/\//i.test(fileUrl) ? fileUrl : '');
  if (!page) {
    console.log('[ZDM CAPTURE] no file page', { id });
    await fileNote(id, '/session-file/fail', { message: 'Could not find the file page in the browser.' });
    return;
  }
  console.log('[ZDM CAPTURE] opening tab for human check', { id, page: String(page).slice(0, 140) });
  let tab;
  try {
    tab = await showCapturePage(page);
  } catch (err) {
    console.log('[ZDM CAPTURE] tab create failed', { id, err: err && err.message });
    await fileNote(id, '/session-file/fail', { message: 'Could not open a browser tab.' });
    return;
  }
  if (!tab || tab.id == null) {
    await fileNote(id, '/session-file/fail', { message: 'Could not open a browser tab.' });
    return;
  }
  const tabId = tab.id;
  const entry = { id, epoch, url: item.url, pageUrl: page, referrer: item.referrer || page, capturedUrl: null, pulling: false };
  captureFileTabs.set(tabId, entry);
  console.log('[ZDM CAPTURE] tab opened, waiting for real file response', { id, tabId });

  return new Promise((resolve) => {
    let settled = false;
    let watch = null;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (watch) clearInterval(watch);
      chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
      captureFileTabs.delete(tabId);
      clearTimeout(timer);
      resolve();
    };
    watch = setInterval(() => {
      if (captureEpoch.get(id) !== epoch) cleanup();
    }, 200);

    const onHeaders = (details) => {
      if (details.tabId !== tabId || settled) return;
      const ctHeader = (details.responseHeaders || [])
        .find(h => h.name.toLowerCase() === 'content-type');
      const dispHeader = (details.responseHeaders || [])
        .find(h => h.name.toLowerCase() === 'content-disposition');
      const lengthHeader = (details.responseHeaders || [])
        .find(h => h.name.toLowerCase() === 'content-length');
      const length = Number(lengthHeader && lengthHeader.value) || 0;
      const ct = (ctHeader && ctHeader.value || '').toLowerCase();
      if (/text\/html|application\/xhtml/i.test(ct) && !dispHeader) return;
      const isBinary = !!dispHeader
        || /octet-stream|zip|rar|7z|gzip|bzip|force-download/i.test(ct)
        || (/^(video|audio|application)\//i.test(ct) && !/html|xml|json|javascript|mpegurl|dash/i.test(ct))
        || (!ct && length >= 256 * 1024);
      if (!isBinary) return;

      console.log('[ZDM CAPTURE] real file detected', {
        id, tabId, url: (details.url || '').slice(0, 140),
        contentType: ct, hasDisposition: !!dispHeader,
      });
      entry.capturedUrl = details.url;
      entry.pulling = true;
      cleanup();

      (async () => {
        try {
          await pullBrowserFile({
            id,
            url: details.url,
            referrer: entry.referrer || entry.pageUrl,
            pageUrl: entry.pageUrl,
            offset: 0,
            size: item.size || length || 0,
            needsHuman: false,
            fromCapture: true,
          });
        } catch (err) {
          console.log('[ZDM CAPTURE] pullBrowserFile with captured URL failed', { id, err: err && err.message });
          await fileNote(id, '/session-file/fail', {
            message: (err && err.message) || 'Download failed after captcha.',
          });
        }
        setTimeout(() => {
          console.log('[ZDM CAPTURE] closing tab', { tabId });
          chrome.tabs.remove(tabId).catch(() => {});
        }, 2000);
      })();
    };

    addHeaderListener(
      'onHeadersReceived',
      onHeaders,
      { urls: ['<all_urls>'], tabId },
      ['responseHeaders', 'extraHeaders']
    );

    const timer = setTimeout(() => {
      if (settled || captureEpoch.get(id) !== epoch) return;
      console.log('[ZDM CAPTURE] timed out waiting for user', { id, tabId });
      cleanup();
      fileNote(id, '/session-file/fail', {
        message: 'Timed out waiting for the download to start in the browser.',
      });
      chrome.tabs.remove(tabId).catch(() => {});
    }, 5 * 60 * 1000);
  });
}
async function pullBrowserFile(item) {
  const epoch = retireCaptures(item.id);
  const outcome = await pullFileDirect(item);
  if (outcome !== 'human' || captureEpoch.get(item.id) !== epoch) return;
  if (item.fromCapture) {
    await fileNote(item.id, '/session-file/fail', { message: 'The server sent a web page instead of the file.' });
    return;
  }
  console.log('[ZDM FILE-PULL] page instead of file, opening the gate page', { id: item.id });
  await captureFileFromTab(item, epoch);
}

async function pullFileDirect(item) {
  const id = item.id;
  const captured = lookupSent(item.url);
  const headerMap = (captured && captured.headers) || null;
  const referrer = headerValue(headerMap, 'referer') || item.referrer || item.pageUrl || '';
  console.log('[ZDM FILE-PULL] starting direct pull', { id, url: (item.url || '').slice(0, 120), referrer: String(referrer).slice(0, 120) });
  let offset = Number(item.offset) || 0;
  const headers = {};
  if (offset > 0) headers.Range = 'bytes=' + offset + '-';
  let res;
  try {
    res = await withReplayHeaders(item.url, referrer, headerMap, () =>
      fetch(item.url, { headers, credentials: 'include', cache: 'no-store' })
    );
  } catch (err) {
    if (!item.keepAlive) await fileNote(id, '/session-file/fail', { message: (err && err.message) || 'The browser could not reach the file.' });
    return 'failed';
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/xhtml\+xml/.test(type)) {
    let body = '';
    try { body = (await res.text()).slice(0, 65536); } catch { body = ''; }
    console.log('[ZDM FILE-PULL] got HTML', { status: res.status, finalUrl: res.url, redirected: res.redirected, body: body.slice(0, 600) });
    // This file type comes through a page. Open that page and catch the real
    // response. Do not retire the whole host, or the next click shows nothing.
    if (body) return 'human';
    if (!item.keepAlive) await fileNote(id, '/session-file/fail', { message: 'The browser was sent a page instead of the file.' });
    return 'failed';
  }
  if (!(res.ok || res.status === 206) || !res.body) {
    if (!item.keepAlive) await fileNote(id, '/session-file/fail', { message: 'HTTP ' + res.status });
    return 'failed';
  }
  if (offset > 0 && res.status !== 206) {
    const reset = await fileNote(id, '/session-file/restart', {});
    if (!reset || reset.status !== 'ok') {
      if (!item.keepAlive) await fileNote(id, '/session-file/fail', { message: 'The server would not resume this file from the browser.' });
      return 'failed';
    }
    offset = 0;
  }
  const totalHeader = Number(res.headers.get('content-length')) || 0;
  const total = res.status === 206 ? (offset + totalHeader) : (totalHeader || Number(item.size) || 0);
  const reader = res.body.getReader();
  const limit = 2 * 1024 * 1024;
  let pending = new Uint8Array(0);
  let stop = '';
  const take = async (bytes) => {
    const ack = await postFileChunk(id, offset, bytes, total);
    if (ack && ack.status === 'refused') {
      stop = 'refused';
      return false;
    }
    if (!ack || ack.status === 'stopped') return false;
    if (ack.status === 'retry') {
      offset = Number(ack.offset) || 0;
      return false;
    }
    offset += bytes.byteLength;
    return ack.status === 'ok';
  };
  try {
    while (true) {
      const step = await reader.read();
      if (step.value && step.value.byteLength) {
        const next = new Uint8Array(pending.length + step.value.byteLength);
        next.set(pending, 0);
        next.set(step.value, pending.length);
        pending = next;
        while (pending.length >= limit) {
          const piece = pending.slice(0, limit);
          pending = pending.slice(limit);
          if (!(await take(piece))) return stop || 'failed';
        }
      }
      if (step.done) break;
    }
  } catch (err) {
    if (!item.keepAlive) await fileNote(id, '/session-file/fail', { message: (err && err.message) || 'The browser lost the file.' });
    return 'failed';
  }
  if (stop) return stop;
  if (pending.length && !(await take(pending))) return stop || 'failed';
  await fileNote(id, '/session-file/finish', { size: offset });
  return 'saved';
}

async function resumePendingFiles(ready) {
  let list = ready;
  if (!list) {
    const pending = await readPending();
    if (!pending) return;
    list = pending.files;
  }
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || !item.id || !item.url || filePulls.has(item.id)) continue;
    filePulls.add(item.id);
    pullBrowserFile(item).catch((err) => fileNote(item.id, '/session-file/fail', {
      message: (err && err.message) || 'The browser could not download this file.',
    })).finally(() => filePulls.delete(item.id));
  }
}

setInterval(() => {
  resumePending().catch(() => {});
}, 2000);

const refreshedForBuild = new Map();

function pageCanRefresh(tab) {
  const url = (tab && (tab.url || tab.pendingUrl)) || '';
  if (!/^https?:\/\//i.test(url)) return false;
  if (tab.discarded) return false;
  return true;
}

function refreshTabIfStale(tabId) {
  if (captureFileTabs.has(tabId)) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.active || !pageCanRefresh(tab)) return;
    if (tab.status === 'loading') return;
    const version = chrome.runtime.getManifest().version;
    chrome.tabs.sendMessage(tabId, { type: 'zdm-ping' }, { frameId: 0 }, (res) => {
      const missing = !!chrome.runtime.lastError;
      const stale = missing || !res || res.version !== version;
      if (!stale) {
        refreshedForBuild.delete(tabId);
        return;
      }
      if (refreshedForBuild.get(tabId) === version) return;
      chrome.tabs.get(tabId, (latest) => {
        if (chrome.runtime.lastError || !latest || !latest.active || !pageCanRefresh(latest)) return;
        if (latest.status === 'loading') return;
        refreshedForBuild.set(tabId, version);
        chrome.tabs.reload(tabId, {}, () => void chrome.runtime.lastError);
      });
    });
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  refreshTabIfStale(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const capture = captureFileTabs.get(tabId);
  if (capture && !capture.pulling) {
    captureFileTabs.delete(tabId);
    if (captureEpoch.get(capture.id) === capture.epoch) {
      console.log('[ZDM CAPTURE] tab closed by user before download started', { id: capture.id, tabId });
      fileNote(capture.id, '/session-file/fail', {
        message: 'The browser tab was closed before the download started.',
      });
    }
  }
  const ids = pullsByTab.get(tabId);
  if (ids) {
    for (const id of ids) detachedPulls.add(id);
    pullsByTab.delete(tabId);
  }
  tabMedia.delete(tabId);
  tabPorts.delete(tabId);
  refreshedForBuild.delete(tabId);
  for (const key of qualityCache.keys()) {
    if (key.startsWith(`${tabId}:`)) qualityCache.delete(key);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabMedia.delete(tabId);
    for (const key of qualityCache.keys()) {
      if (key.startsWith(`${tabId}:`)) qualityCache.delete(key);
    }
    setBadge(tabId, '');
  }
});

function syncContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.storage.local.get({ contextMenu: true }, (stored) => {
    const enabled = stored && stored.contextMenu !== false;
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      if (enabled) {
        chrome.contextMenus.create({
          id: 'zdm-download-link',
          title: 'Download with ZDM',
          contexts: ['link', 'image', 'video', 'audio'],
        }, () => void chrome.runtime.lastError);
      }
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (!details || (details.reason !== 'install' && details.reason !== 'update')) return;
  syncContextMenu();
});

syncContextMenu();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.contextMenu) {
    syncContextMenu();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'zdm-download-link') return;
  const url = info.linkUrl || info.srcUrl;
  if (!url || !/^https?:\/\//i.test(url)) return;
  const pageUrl = (tab && tab.url) || info.pageUrl || '';
  let cookies = '';
  try {
    const all = await chrome.cookies.getAll({ url });
    cookies = all.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {}
  const gated = await askGate({
    source: 'context',
    url,
    pageUrl,
    referrer: pageUrl,
    filename: decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''),
  });
  const headers = Object.assign({}, (gated && gated.headers) || {});
  if (cookies) headers.Cookie = cookies;
  const payload = {
    type: 'new-download',
    url,
    confirm: true,
    sourcePage: pageUrl,
    referrer: headers.Referer || pageUrl,
    headers,
    cookies,
    fileName: (gated && gated.name) || decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''),
  };
  try {
    await fetch(NATIVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {}
});
