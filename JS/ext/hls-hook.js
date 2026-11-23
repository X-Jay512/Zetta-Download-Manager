(function () {
  if (window.__zdmHlsHook) return;
  window.__zdmHlsHook = true;

  const playlistSeen = new Map();
  const postedStoryBodies = new Set();
  let postedShare = '';

  const _bufSrcMap = new WeakMap();
  const _sbToMs = new WeakMap();
  const _msToBlob = new WeakMap();
  const _urlKind = new Map();

  const _isMseSite = () => /threads\.com|instagram\.com|facebook\.com/i.test(location.hostname);
  const _responseUrl = new WeakMap();

  const _looksCdnMedia = (url, type) => {
    if (!/fbcdn\.net|cdninstagram\.com/i.test(url || '')) return false;
    if (/(video|audio)/i.test(type || '')) return true;
    try {
      const parsed = new URL(url);
      if (/^video[-.]/i.test(parsed.hostname)) return true;
      if (/\.(mp4|m4s|m4a|webm)$/i.test(parsed.pathname)) return true;
      if (/cdninstagram\.com/i.test(parsed.hostname) && /\/o1\/v\/|\/v\/t\d+\//i.test(parsed.pathname)) return true;
    } catch { /* a relative address is not a media file */ }
    return false;
  };

  // Stories often copy the response before appendBuffer, so the byte map misses.
  // Remember the file size and bind that append only when one open story file matches.
  const _recentCdn = [];
  const _storyPage = () => /instagram\.com\/stories\/|facebook\.com\/stories\//i.test(location.href || '');
  const _sig = (data) => {
    let bytes = null;
    try {
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data, 0, Math.min(4096, data.byteLength));
      else if (data && ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset || 0, Math.min(4096, data.byteLength || 0));
    } catch { bytes = null; }
    if (!bytes || bytes.length < 32) return '';
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };
  const _rememberCdn = (url, type, length, sig) => {
    const size = Number(length) || 0;
    if (!_storyPage() || size < 10000 || !url) return;
    if (/\.(m4s|jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(url)) return;
    if (!_looksCdnMedia(url, type)) return;
    if (!/(video|audio)/i.test(type || '') && !/\.(mp4|m4a|webm)(\?|#|$)/i.test(url) && !/\/o1\/v\//i.test(url)) return;
    const mark = sig || '';
    if (mark) {
      for (let i = _recentCdn.length - 1; i >= 0; i--) {
        if (_recentCdn[i].url === url) {
          if (!_recentCdn[i].sig) _recentCdn[i].sig = mark;
          _recentCdn[i].time = Date.now();
          return;
        }
      }
    }
    _recentCdn.push({ url: String(url), len: size, time: Date.now(), sig: mark });
    if (_recentCdn.length > 30) _recentCdn.shift();
  };
  const _matchCdn = (size, sig) => {
    const now = Date.now();
    if (sig) {
      const signed = [];
      for (let i = _recentCdn.length - 1; i >= 0; i--) {
        const row = _recentCdn[i];
        if (now - row.time > 20000 || row.sig !== sig) continue;
        if (signed.indexOf(row.url) === -1) signed.push(row.url);
        if (signed.length > 1) break;
      }
      if (signed.length === 1) return signed[0];
    }
    const bytes = Number(size) || 0;
    if (!_storyPage() || bytes < 10000) return '';
    const hits = [];
    for (let i = _recentCdn.length - 1; i >= 0; i--) {
      const row = _recentCdn[i];
      if (now - row.time > 20000 || row.len !== bytes) continue;
      if (hits.indexOf(row.url) === -1) hits.push(row.url);
      if (hits.length > 1) return '';
    }
    return hits.length === 1 ? hits[0] : '';
  };

  const _sniffKind = (buf) => {
    try {
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      const limit = Math.min(bytes.length, 262144);
      for (let i = 0; i + 20 < limit; i++) {
        if (bytes[i] !== 0x68 || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x6c || bytes[i + 3] !== 0x72) continue;
        const handler = String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]);
        if (handler === 'soun') return 'audio';
        if (handler === 'vide') return 'video';
      }
    } catch { /* a short buffer has no handler box */ }
    return '';
  };

  const _typeKind = (type) => {
    const text = String(type || '');
    if (/audio/i.test(text) || /mp4a|opus|ac-3/i.test(text)) return 'audio';
    if (/avc1|vp09|hev1|av01/i.test(text)) return 'video';
    return '';
  };

  const _kindFor = (url, buf, type) => {
    const base = String(url || '').split('?')[0];
    const known = base && _urlKind.get(base);
    if (known) return known;
    const kind = _sniffKind(buf) || _typeKind(type);
    if (base && kind) _urlKind.set(base, kind);
    return kind || '';
  };

  try {
    const _origCreateObjUrl = URL.createObjectURL;
    URL.createObjectURL = function(obj) {
      const url = _origCreateObjUrl.apply(URL, arguments);
      try { if (typeof MediaSource !== 'undefined' && obj instanceof MediaSource) _msToBlob.set(obj, url); } catch {}
      return url;
    };
  } catch {}

  const _hookSourceBuffer = (proto) => {
    if (!proto || proto.__zdmAddSb) return;
    const orig = proto.addSourceBuffer;
    if (typeof orig !== 'function') return;
    proto.addSourceBuffer = function () {
      const sb = orig.apply(this, arguments);
      try { _sbToMs.set(sb, this); } catch {}
      return sb;
    };
    proto.__zdmAddSb = true;
  };
  try { _hookSourceBuffer(MediaSource.prototype); } catch {}
  try { if (typeof ManagedMediaSource === 'function') _hookSourceBuffer(ManagedMediaSource.prototype); } catch {}

  try {
    const _origSlice = ArrayBuffer.prototype.slice;
    ArrayBuffer.prototype.slice = function() {
      const next = _origSlice.apply(this, arguments);
      try {
        const mapped = _bufSrcMap.get(this);
        if (mapped) _bufSrcMap.set(next, mapped);
      } catch { /* a detached buffer has no media url */ }
      return next;
    };
  } catch {}

  try {
    const _origFetch = window.fetch;
    window.fetch = function(input) {
      const asked = typeof input === 'string' ? input : (input && input.url) || '';
      return _origFetch.apply(this, arguments).then((res) => {
        try {
          const url = (res && res.url) || asked || '';
          if (url) _responseUrl.set(res, url);
          const type = res && res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
          const length = res && res.headers && res.headers.get ? res.headers.get('content-length') : '';
          _rememberCdn(url, type, length);
        } catch { /* a locked response keeps its own url */ }
        return res;
      });
    };
  } catch {}

  try {
    const _origAppend = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function(data) {
      try {
        if (_isMseSite()) {
          const buf = data instanceof ArrayBuffer ? data : (data && data.buffer);
          const mapped = buf && _bufSrcMap.get(buf);
          let srcUrl = mapped && typeof mapped === 'object' ? mapped.url : (mapped || '');
          let kind = (mapped && mapped.kind) || (srcUrl && _urlKind.get(String(srcUrl).split('?')[0])) || '';
          if (!srcUrl) {
            const guessed = _matchCdn(data && data.byteLength, _sig(data));
            if (guessed) {
              srcUrl = guessed;
              kind = kind || _kindFor(guessed, data, '');
            }
          }
          if (srcUrl) {
            const ms = _sbToMs.get(this);
            const blobUrl = ms && _msToBlob.get(ms);
            if (blobUrl) {
              window.postMessage({ source: 'zdm-threads-mp4', blobUrl: blobUrl, videoUrl: srcUrl, kind: kind }, '*');
            }
            if (/facebook\.com\/stories\//i.test(location.href || '')) _markStoryFile(_storyVideoFor(this), srcUrl, kind);
          }
        }
      } catch {}
      return _origAppend.apply(this, arguments);
    };
  } catch {}

  try {
    const _origAB = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function() {
      const rUrl = _responseUrl.get(this) || this.url || '';
      const rType = this.headers ? (this.headers.get('content-type') || '') : '';
      return _origAB.call(this).then(buf => {
        try {
          if (_isMseSite() && _looksCdnMedia(rUrl, rType)) {
            _bufSrcMap.set(buf, { url: rUrl, kind: _kindFor(rUrl, buf, rType) });
            _rememberCdn(rUrl, rType, buf.byteLength, _sig(buf));
          }
        } catch {}
        return buf;
      });
    };
  } catch {}

  try {
    const _origBlob = Response.prototype.blob;
    Response.prototype.blob = function () {
      const rUrl = _responseUrl.get(this) || this.url || '';
      const rType = this.headers ? (this.headers.get('content-type') || '') : '';
      return _origBlob.call(this).then((blob) => {
        try {
          if (_storyPage() && blob && blob.size >= 10000 && _looksCdnMedia(rUrl, rType)) {
            blob.slice(0, 4096).arrayBuffer().then((head) => {
              _rememberCdn(rUrl, rType, blob.size, _sig(head));
            }).catch(() => {});
          }
        } catch { /* a blob the page owns stays untouched */ }
        return blob;
      });
    };
  } catch {}

  function _storyVideoFor(sb) {
    const ms = _sbToMs.get(sb);
    const blobUrl = ms && _msToBlob.get(ms);
    const list = document.querySelectorAll('video');
    for (let i = 0; i < list.length; i++) {
      const video = list[i];
      if (blobUrl && (video.src === blobUrl || video.currentSrc === blobUrl)) return video;
      try { if (ms && video.srcObject === ms) return video; } catch { /* the element locked its source */ }
    }
    return null;
  }

  function _markStoryFile(video, url, kind) {
    if (!video || !url || !/facebook\.com\/stories\//i.test(location.href || '')) return;
    const rect = video.getBoundingClientRect ? video.getBoundingClientRect() : null;
    if (!rect || rect.width < 80 || rect.height < 80) return;
    const row = kind ? url + '\t' + kind : url;
    const prev = video.getAttribute('data-zdm-direct-urls') || '';
    if (prev.indexOf(url) === -1) video.setAttribute('data-zdm-direct-urls', prev ? prev + '\n' + row : row);
    try { window.postMessage({ source: 'zdm-fb-live', videoUrl: url, kind: kind || '' }, '*'); } catch { /* the page can ignore the message */ }
  }

  const longId = (value) => (String(value || '').match(/\d{10,}/) || [])[0] || '';

  const playerBox = (video) => {
    let best = video;
    let node = video && video.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      if (node.querySelectorAll && node.querySelectorAll('video').length > 1) break;
      best = node;
      node = node.parentElement;
    }
    return best;
  };

  const playerTokens = (video) => {
    const bag = [];
    const add = (value) => {
      const id = longId(value);
      if (id && bag.indexOf(id) === -1) bag.push(id);
    };
    if (!video) return bag;
    add(video.currentSrc || '');
    add(video.src || '');
    add(video.poster || '');
    const box = playerBox(video);
    if (box && box.querySelectorAll) {
      const nodes = box.querySelectorAll('img[src], source[src], video[poster], [style]');
      for (let i = 0; i < nodes.length && i < 16; i++) {
        add(nodes[i].getAttribute('src') || '');
        add(nodes[i].getAttribute('poster') || '');
        add(nodes[i].getAttribute('style') || '');
      }
    }
    return bag;
  };

  const playingVideos = () => {
    const found = [];
    for (const video of document.querySelectorAll('video')) {
      if (!video.paused && video.readyState >= 1) found.push(video);
    }
    return found;
  };

  const rememberList = (video, url) => {
    if (!video || !url) return;
    const id = longId(url);
    const prev = String(video.getAttribute('data-zdm-lists') || '').split('\n').filter(Boolean);
    const prevId = longId(prev[prev.length - 1] || '');
    const next = prevId && id && prevId !== id ? [] : prev.slice();
    if (next.indexOf(url) === -1) next.push(url);
    video.setAttribute('data-zdm-lists', next.slice(-8).join('\n'));
  };

  const claimPlaylist = (url) => {
    if (!url) return;
    const id = longId(url);
    playlistSeen.set(url, id);
    const videos = [...document.querySelectorAll('video')];
    const owners = id ? videos.filter((video) => playerTokens(video).indexOf(id) !== -1) : [];
    const targets = owners.length ? owners : (playingVideos().length === 1 ? playingVideos() : (videos.length === 1 ? videos : []));
    for (const video of targets) rememberList(video, url);
  };

  const imageOnlyList = (text) => {
    if (!/#EXTM3U/i.test(text || '')) return false;
    const rows = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line[0] !== '#');
    return rows.length > 0 && rows.every((line) => /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(line));
  };

  const thumbListUrl = (url) => /\/(?:thumbnails?|thumbs?|storyboards?|sprites?)\/|\/(?:thumbnails?|storyboard)[^/]*\.m3u8/i.test(String(url || ''));

  const postThumb = (url) => {
    try { window.postMessage({ source: 'zdm-hls-thumb', url: String(url) }, '*'); } catch { /* the page can ignore the message */ }
  };

  const post = (url, text) => {
    if (!url || !text || text.length > 1500000) return;
    if (!/#EXTM3U/i.test(text) && !/<MPD[\s>]/i.test(text)) return;
    if (imageOnlyList(text) || thumbListUrl(url)) {
      postThumb(url);
      return;
    }
    claimPlaylist(String(url));
    try {
      window.postMessage({ source: 'zdm-hls', url: String(url), text: String(text) }, '*');
    } catch { /* the page can ignore the message */ }
  };

  document.addEventListener('play', (event) => {
    const video = event.target;
    if (!video || video.tagName !== 'VIDEO') return;
    const tokens = playerTokens(video);
    for (const [url, id] of playlistSeen) {
      if (id && tokens.indexOf(id) !== -1) rememberList(video, url);
    }
  }, true);

  const looksPlaylist = (url, type) => /\.(m3u8|mpd)(\?|#|$)/i.test(url || '') || /mpegurl|dash\+xml/i.test(type || '');

  const looksDocument = (type) => /json|xml|text\/plain|dash|mpegurl|javascript|x-component/i.test(type || '');

  const dashWindows = (src) => {
    if (src.length <= 700000) return [src];
    const re = /video_versions|video_dash_manifest|<MPD/ig;
    const spans = [];
    let match;
    while ((match = re.exec(src)) && spans.length < 8) {
      let start = Math.max(0, match.index - 100000);
      let end = Math.min(src.length, match.index + 200000);
      const region = src.slice(match.index, Math.min(src.length, match.index + 280000));
      const stop = /<\/MPD>|\\u003c\/mpd|&lt;\/mpd/i.exec(region);
      if (stop) end = Math.min(src.length, match.index + stop.index + stop[0].length);
      const last = spans[spans.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else spans.push([start, end]);
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
    return spans.map((pair) => src.slice(pair[0], pair[1]));
  };

  const postDash = (url, text) => {
    const src = String(text || '');
    if (!src || src.length > 8000000) return;
    if (!/video_versions|video_dash_manifest|<MPD[\s>]/i.test(src)) return;
    for (const part of dashWindows(src)) {
      try {
        window.postMessage({ source: 'zdm-dash', url: String(url || ''), text: part }, '*');
      } catch { /* the page can ignore the message */ }
    }
  };

  const postPlayer = (url, text) => {
    if (!text || !/bitrateInfo|"bitRate"|playAddr|play_addr/i.test(text)) return;
    const body = String(text);
    if (body.length > 1500000) return;
    try {
      window.postMessage({ source: 'zdm-player', url: String(url || ''), text: body }, '*');
    } catch { /* the page can ignore the message */ }
  };

  const postIgItems = (url, text) => {
    if (!/(^|\.)instagram\.com$/i.test(location.hostname) || !text) return;
    if (text.indexOf('video_versions') === -1 && text.indexOf('video_dash_manifest') === -1) return;
    postStoryBody('instagram', url, text);
  };

  function postStoryBody(site, url, text) {
    const raw = String(text || '');
    if (!raw) return;
    const body = raw.length > 1500000 ? raw.slice(0, 1500000) : raw;
    const key = site + '\n' + body.length + '\n' + body.slice(0, 64) + '\n' + body.slice(-64);
    if (postedStoryBodies.has(key)) return;
    postedStoryBodies.add(key);
    while (postedStoryBodies.size > 40) postedStoryBodies.delete(postedStoryBodies.values().next().value);
    try {
      window.postMessage({ source: 'zdm-story-body', site, pageUrl: String(url || location.href), body }, '*');
    } catch { /* the page can ignore the message */ }
  }

  const postFbStories = (url, text) => {
    if (!/(^|\.)facebook\.com$/i.test(location.hostname) || !text) return 0;
    postStoryBody('facebook', url, text);
    return 1;
  };

  function storyTokenIds(token) {
    const ids = [];
    const push = (value) => {
      const text = String(value || '');
      if (text && ids.indexOf(text) === -1) ids.push(text);
    };
    let raw = String(token || '');
    try { raw = decodeURIComponent(raw); } catch { /* already plain */ }
    push(raw.replace(/=+$/, ''));
    push(raw);
    try {
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = atob(b64);
      push(decoded);
      const nums = decoded.match(/\d{8,}/g) || [];
      for (const num of nums) push(num);
    } catch { /* not base64 */ }
    return ids.filter((id) => id.length >= 8);
  }

  function collectShareUrls(value, depth, seen, out) {
    if (value == null || depth > 6) return;
    if (typeof value === 'string') {
      const text = value.replace(/\\\//g, '/');
      const share = text.match(/https?:\/\/(?:www\.)?facebook\.com\/share\/[A-Za-z0-9/_-]{3,}/i);
      const numeric = text.match(/https?:\/\/(?:www\.)?facebook\.com\/stories\/\d{8,}\/?/i);
      if (share && out.indexOf(share[0]) === -1) out.push(share[0].replace(/\/$/, ''));
      if (numeric && out.indexOf(numeric[0]) === -1) out.push(numeric[0].replace(/\/$/, ''));
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length && i < 12; i++) collectShareUrls(value[i], depth + 1, seen, out);
      return;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length && i < 24; i++) {
      const key = keys[i];
      if (key === 'child' || key === 'sibling' || key === 'return' || key === 'alternate' || key === 'stateNode' || key === '_owner') continue;
      collectShareUrls(value[key], depth + 1, seen, out);
    }
  }
  function pageStoryShare() {
    if (!/facebook\.com\/stories\//i.test(location.href || '')) return '';
    const out = [];
    const videos = document.querySelectorAll('video, img');
    let host = null;
    let best = 0;
    for (let i = 0; i < videos.length && i < 20; i++) {
      const rect = videos[i].getBoundingClientRect ? videos[i].getBoundingClientRect() : null;
      if (!rect || rect.width < 180 || rect.height < 240) continue;
      const area = rect.width * rect.height;
      if (area > best) { best = area; host = videos[i]; }
    }
    let node = host;
    for (let up = 0; node && up < 8; up++, node = node.parentElement) {
      const links = node.querySelectorAll ? node.querySelectorAll('a[href*="/share/"], a[href*="/stories/"]') : [];
      for (let i = 0; i < links.length && i < 20; i++) collectShareUrls(links[i].href, 0, new Set(), out);
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.indexOf('__reactProps') !== 0 && key.indexOf('__reactFiber') !== 0) continue;
        collectShareUrls(node[key], 0, new Set(), out);
      }
      if (out.length) break;
    }
    return out.filter((url) => /\/share\//i.test(url))[0] || out.filter((url) => /\/stories\/\d+\/?$/i.test(url))[0] || '';
  }
  function publishStoryShare() {
    const url = pageStoryShare();
    if (!url || url === postedShare) return;
    postedShare = url;
    const bar = (location.href || '').match(/facebook\.com\/stories\/([^/?#]+)\/([^/?#]+)/i);
    try { window.postMessage({ source: 'zdm-fb-share', url, owner: bar ? bar[1] : '', token: bar ? bar[2] : '' }, '*'); } catch { /* the page can ignore the message */ }
  }
  setInterval(publishStoryShare, 1200);

  const fetchedStories = new Set();
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'zdm-fb-fetch-story' || event.source !== window) return;
    const owner = String(data.owner || '').replace(/[^\w.-]/g, '');
    const token = String(data.token || '').replace(/[^\w.+=/_-]/g, '');
    if (!owner || token.length < 8) return;
    const shareUrl = String(data.shareUrl || '');
    const key = owner + '/' + token + (shareUrl ? '|' + shareUrl : '');
    if (fetchedStories.has(key)) return;
    const storyReady = (body) => {
      const flat = String(body || '');
      const ids = storyTokenIds(token);
      for (let i = 0; i < ids.length; i++) if (ids[i] && flat.indexOf(ids[i]) !== -1) return true;
      return false;
    };
    const readLink = (url) => fetch(url, { credentials: 'include', cache: 'no-store' }).then((res) => res.text()).then((text) => {
      const body = String(text || '');
      const found = body ? postFbStories(url, body) : 0;
      return { found, ready: body ? storyReady(body) : false };
    });
    const targets = [];
    if (/facebook\.com\/share\/|facebook\.com\/stories\/\d+\/?(\?|$)/i.test(shareUrl)) targets.push(shareUrl);
    const mediaId = storyTokenIds(token).filter((id) => /^\d{8,}$/.test(id) && id !== owner)[0] || '';
    if (mediaId) targets.push('https://www.facebook.com/stories/' + mediaId + '/');
    targets.push('https://www.facebook.com/stories/' + owner + '/' + token + '/');
    const step = (n) => {
      if (n >= targets.length) return;
      readLink(targets[n]).then((result) => {
        if (result && result.ready && result.found) {
          fetchedStories.add(key);
          return;
        }
        step(n + 1);
      }).catch(() => step(n + 1));
    };
    step(0);
  });

  const takeBody = (url, type, text) => {
    if (!text) return;
    if (looksPlaylist(url, type) || /#EXTM3U/i.test(text)) post(url, text);
    else {
      postDash(url, text);
      postPlayer(url, text);
      postIgItems(url, text);
      postFbStories(url, text);
    }
  };

  let origFetch = typeof window.fetch === 'function' ? window.fetch : null;

  // A page request that fails still rejects for the site. Chrome otherwise
  // lists it on the extension because this file called fetch.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason && reason.message ? String(reason.message) : String(reason || '');
    if (!/Failed to fetch|NetworkError|Load failed/i.test(message)) return;
    const stack = reason && reason.stack ? String(reason.stack) : '';
    if (stack && !/hls-hook\.js/i.test(stack)) return;
    event.preventDefault();
  });

  if (origFetch) {
    window.fetch = function (input, init) {
      const pending = origFetch.apply(this, arguments);
      pending.then((res) => {
        try {
          const url = (res && res.url) || (typeof input === 'string' ? input : (input && input.url)) || '';
          const type = res && res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
          const length = Number(res && res.headers && res.headers.get ? (res.headers.get('content-length') || 0) : 0);
          const isThreadsHost = /threads\.com/i.test(location.hostname);
          if ((looksPlaylist(url, type) || looksDocument(type) || (isThreadsHost && /api\//i.test(url))) && (!length || length <= 8000000)) {
            res.clone().text().then((text) => {
              takeBody(url, type, text);
            }).catch(() => {});
          }
        } catch { /* leave the original response untouched */ }
      }, () => {});
      return pending;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__zdmUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this.responseURL || this.__zdmUrl || '';
        const type = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
        const length = this.getResponseHeader ? this.getResponseHeader('content-length') : '';
        _rememberCdn(url, type, length || (this.response && this.response.byteLength));
        const responseType = this.responseType || '';
        let text = '';
        if (responseType === 'json') {
          if (!this.response) return;
          try { text = JSON.stringify(this.response); } catch { return; }
        } else if (responseType === 'arraybuffer') {
          if (!(this.response && (looksPlaylist(url, type) || looksDocument(type)))) return;
          text = new TextDecoder().decode(this.response);
        } else if (responseType && responseType !== 'text') {
          return;
        } else if (typeof this.responseText === 'string' && this.responseText) {
          text = this.responseText;
        } else return;
        if (!text || text.length > 8000000) return;
        if (!looksPlaylist(url, type) && !looksDocument(type) && text.indexOf('video_dash_manifest') === -1 && text.indexOf('video_versions') === -1 && text.indexOf('cdninstagram.com') === -1 && text.indexOf('<MPD') === -1 && text.indexOf('#EXTM3U') === -1 && text.indexOf('bitrateInfo') === -1 && text.indexOf('playAddr') === -1 && text.indexOf('browser_native_hd_url') === -1 && text.indexOf('playable_url') === -1 && text.indexOf('progressive_url') === -1 && text.indexOf('dash_manifest') === -1 && text.indexOf('Uzpf') === -1) return;
        takeBody(url, type, text);
      } catch { /* ignore a playlist we could not read */ }
    });
    return origSend.apply(this, arguments);
  };

  const publishUrl = (url) => {
    if (!url || !/^https?:/i.test(String(url))) return;
    if (!/\.(m3u8|mpd)(\?|#|$)/i.test(String(url))) return;
    if (thumbListUrl(url)) {
      postThumb(url);
      return;
    }
    claimPlaylist(String(url));
    try { window.postMessage({ source: 'zdm-hls-url', url: String(url) }, '*'); } catch { /* the page can ignore the message */ }
  };

  const pullSetup = (config) => {
    if (!config) return;
    publishUrl(config.file);
    const sources = config.sources;
    const list = Array.isArray(sources) ? sources : (sources ? [sources] : []);
    for (const item of list) {
      if (!item) continue;
      publishUrl(typeof item === 'string' ? item : (item.file || item.src));
    }
  };

  const wrapJw = (fn) => {
    if (typeof fn !== 'function' || fn.__zdmWrapped) return fn;
    const wrapped = function () {
      const api = fn.apply(this, arguments);
      if (api && typeof api.setup === 'function' && !api.__zdmSetup) {
        const orig = api.setup.bind(api);
        api.setup = function (config) {
          try { pullSetup(config); } catch { /* leave the player setup alone */ }
          return orig(config);
        };
        api.__zdmSetup = true;
      }
      return api;
    };
    wrapped.__zdmWrapped = true;
    return new Proxy(wrapped, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        const value = fn[prop];
        return typeof value === 'function' ? value.bind(fn) : value;
      },
      set(_target, prop, value) {
        fn[prop] = value;
        return true;
      },
    });
  };

  const armJw = () => {
    try {
      const desc = Object.getOwnPropertyDescriptor(window, 'jwplayer');
      if (desc && desc.get && desc.get.__zdm) return;
      let current = window.jwplayer;
      const getter = function () { return current; };
      getter.__zdm = true;
      Object.defineProperty(window, 'jwplayer', {
        configurable: true,
        enumerable: true,
        get: getter,
        set(value) { current = wrapJw(value); },
      });
      if (typeof current === 'function') current = wrapJw(current);
    } catch { /* the page locked jwplayer */ }
  };

  let audioSeq = 1;
  let lastPointer = null;

  function lightNode(node) {
    let current = node && node.nodeType === 1 ? node : null;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const root = current.getRootNode ? current.getRootNode() : null;
      if (root && root.host) {
        current = root.host;
        continue;
      }
      return current;
    }
    return null;
  }

  function pickAudioBox(start) {
    let node = lightNode(start);
    let best = null;
    const viewW = window.innerWidth || 1;
    for (let i = 0; i < 10 && node && node !== document.body && node !== document.documentElement; i++) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 48 && rect.height >= 18 && rect.height <= 220 && rect.width <= viewW * 0.98) best = node;
      if (rect.height > 320 && rect.width > viewW * 0.9) break;
      node = node.parentElement;
    }
    return best;
  }

  function reportAudio(media) {
    try {
      if (!media || media.tagName !== 'AUDIO') return;
      const anchor = pickAudioBox(media.isConnected ? media : lastPointer);
      if (!anchor) return;
      let id = anchor.getAttribute('data-zdm-audio');
      if (!id) {
        id = String(audioSeq++);
        anchor.setAttribute('data-zdm-audio', id);
      }
      const url = media.currentSrc || media.src || '';
      window.postMessage({ source: 'zdm-audio', id, url: String(url || '') }, '*');
    } catch { /* leave playback alone */ }
  }

  document.addEventListener('pointerdown', (event) => {
    lastPointer = event.target || null;
  }, true);

  const origMediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try { reportAudio(this); } catch { /* keep the native play */ }
    return origMediaPlay.apply(this, arguments);
  };

  document.addEventListener('play', (event) => {
    reportAudio(event.target);
  }, true);

  armJw();
  let armTries = 0;
  const armTimer = setInterval(() => {
    armTries += 1;
    armJw();
    if (armTries > 20) clearInterval(armTimer);
  }, 500);
})();
