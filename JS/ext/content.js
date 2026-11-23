(function() {
  if (window.__zdm_init__) return;
  window.__zdm_init__ = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'set-button-style') {
      applyButtonStyle(msg.style);
      return;
    }
    if (!msg || msg.type !== 'zdm-ping') return;
    sendResponse({ version: chrome.runtime.getManifest().version, stamp: qualityStamp });
  });

  try {
    const isBrave = !!(navigator.brave || (window.navigator && window.navigator.brave));
    if (isBrave) {
      chrome.runtime.sendMessage({ type: 'zdm-browser-detected', browser: 'brave' });
    }
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      navigator.brave.isBrave().then((val) => {
        if (val) chrome.runtime.sendMessage({ type: 'zdm-browser-detected', browser: 'brave' });
      }).catch(() => {});
    }
  } catch {}

  let activeButtonStyle = 'square';

  function getButtonIcons(style) {
    const s = style === 'circle' ? 'circle' : 'square';
    return {
      frameUrl: chrome.runtime.getURL('icons/icon-' + s + '-frame.png'),
      arrowUrl: chrome.runtime.getURL('icons/icon-' + s + '-arrow.png'),
      styleClass: 'is-' + s,
    };
  }
  function createButtonContent(style) {
    const icons = getButtonIcons(style || activeButtonStyle);
    const wrap = document.createElement('span');
    wrap.className = 'zdm-btn-icon-wrap';
    const frame = document.createElement('img');
    frame.className = 'zdm-btn-frame';
    frame.src = icons.frameUrl;
    frame.alt = '';
    frame.draggable = false;
    const arrow = document.createElement('img');
    arrow.className = 'zdm-btn-arrow';
    arrow.src = icons.arrowUrl;
    arrow.alt = '';
    arrow.draggable = false;
    wrap.append(frame, arrow);
    return wrap;
  }

  function showMenuSpinner(menu) {
    const box = document.createElement('div');
    box.style.padding = '12px';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    const spin = document.createElement('div');
    spin.className = 'zdm-spinner';
    box.appendChild(spin);
    menu.replaceChildren(box);
  }

  function showMenuNote(menu, text) {
    const line = document.createElement('div');
    line.className = 'zdm-menu-header';
    line.textContent = text;
    menu.replaceChildren(line);
  }

  function applyButtonStyle(style) {
    activeButtonStyle = style === 'circle' ? 'circle' : 'square';
    const icons = getButtonIcons(activeButtonStyle);
    const buttons = document.querySelectorAll('.zdm-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('is-circle', activeButtonStyle === 'circle');
      btn.classList.toggle('is-square', activeButtonStyle === 'square');
      btn.classList.remove('zdm-btn-circle', 'zdm-btn-square');
      const frameImg = btn.querySelector('.zdm-btn-frame');
      if (frameImg) {
        frameImg.className = 'zdm-btn-frame';
        frameImg.src = icons.frameUrl;
      }
      const arrowImg = btn.querySelector('.zdm-btn-arrow');
      if (arrowImg) {
        arrowImg.src = icons.arrowUrl;
      }
    });
  }

  function setButtonState(btn, state) {
    if (!btn) return;
    if (state === 'down') {
      btn.classList.add('zdm-btn-down');
    } else if (state === 'up') {
      btn.classList.remove('zdm-btn-down');
      btn.classList.remove('zdm-downloading');
    } else if (state === 'downloading') {
      btn.classList.add('zdm-btn-down');
      btn.classList.remove('zdm-downloading');
      requestAnimationFrame(() => {
        btn.classList.add('zdm-downloading');
      });
      setTimeout(() => {
        btn.classList.remove('zdm-downloading');
        btn.classList.remove('zdm-btn-down');
      }, 1400);
    }
  }
  const MIN_VIDEO_SIZE = 80;
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|opus|ogg|oga|weba|wma|mpga)(?:\?|#|$)/i;
  let lastGesture = null;
  let lastSniffed = null;
  let pendingAudio = null;
  const recentAudio = [];
  let lastHarvest = 0;
  const POSITION_THROTTLE = 200;
  const RESCAN_INTERVAL = 2000;
  const IG_POST_RE = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;

  let port = null;
  let pageOn = true;
  const qualitySettings = { qualityMode: 'full', fpsDisplay: '60' };
  let qualityStamp = 0;
  const playlistBodies = new Map();
  const seenPlaylistUrls = new Set();
  const pendingBlobMedia = new Map();
  let pageScriptHit = null;
  let pageScriptFlight = '';
  let pageScriptMiss = '';
  const thumbPlaylists = new Set();
  const isThumbList = (url) => thumbPlaylists.has(String(url || ''))
    || /\/(?:thumbnails?|thumbs?|storyboards?|sprites?)\/|\/(?:thumbnails?|storyboard)[^/]*\.m3u8/i.test(String(url || ''));
  const imageOnlyList = (text) => {
    if (!/#EXTM3U/i.test(text || '')) return false;
    const rows = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line[0] !== '#');
    return rows.length > 0 && rows.every((line) => /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(line));
  };
  function forgetThumb(url) {
    const needle = String(url || '');
    if (!needle) return;
    thumbPlaylists.add(needle);
    seenPlaylistUrls.delete(needle);
    playlistBodies.delete(needle);
    let videos = [];
    try { videos = document.querySelectorAll('video'); } catch { videos = []; }
    for (const video of videos) {
      const raw = video.getAttribute && video.getAttribute('data-zdm-lists');
      if (!raw || raw.indexOf(needle) === -1) continue;
      const next = raw.split('\n').map((item) => item.trim()).filter((item) => item && item !== needle && !isThumbList(item));
      if (next.length) video.setAttribute('data-zdm-lists', next.join('\n'));
      else video.removeAttribute('data-zdm-lists');
    }
  }
  const dashBodies = [];
  const dashSeen = new Set();

  function rememberThreadsDash(text) {
    if (!isThreads()) return;
    const rules = threadsRules() || {
      markers: ['video_versions', 'video_dash_manifest', '<MPD[\\s>]'],
      wholeLimit: 700000,
      before: 100000,
      after: 200000,
      maxSpans: 8,
      maxChars: 2500000,
      maxBodies: 16,
      endMarkers: ['</MPD>', '\\u003c/mpd', '&lt;/mpd'],
      endWithin: 280000,
    };
    const parts = collectBodies([text], rules, rules);
    const chunks = parts.length ? parts : [String(text || '').slice(0, 500000)];
    let added = 0;
    for (const body of chunks) {
      if (!/video_versions|video_dash_manifest|<MPD[\s>]/i.test(body)) continue;
      const key = body.length + ':' + body.slice(0, 120);
      if (dashSeen.has(key)) continue;
      dashSeen.add(key);
      dashBodies.push(body);
      added += 1;
      while (dashBodies.length > 24) {
        const old = dashBodies.shift();
        dashSeen.delete(old.length + ':' + old.slice(0, 120));
      }
    }
    if (!added) return;
    refreshThreadsMenus();
    setTimeout(refreshThreadsMenus, 500);
  }


  const threadsUseApp = true;
  const threadsAppRows = new WeakMap();
  const threadsAppFlight = new WeakMap();
  const threadsCaptureWait = new Map();
  let threadsCaptureSeq = 0;
  const cardResolveStamp = new WeakMap();
  let threadsCollect = null;

  function ruleNumber(rules, key) {
    const value = Number(rules[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function markerList(rules, key) {
    if (!rules || !Array.isArray(rules[key]) || !rules[key].length) return null;
    return rules[key].map((item) => String(item));
  }

  function threadsRules() {
    const rules = threadsCollect;
    const markers = markerList(rules, 'markers');
    if (!markers) return null;
    return {
      markers,
      wholeLimit: ruleNumber(rules, 'wholeLimit'),
      before: ruleNumber(rules, 'before'),
      after: ruleNumber(rules, 'after'),
      maxSpans: ruleNumber(rules, 'maxSpans'),
      maxChars: ruleNumber(rules, 'maxChars'),
      maxBodies: ruleNumber(rules, 'maxBodies'),
    };
  }

  function collectBodies(texts, rules, limit) {
    if (!rules || !limit || !rules.markers || !rules.markers.length) return [];
    const bodies = [];
    let chars = 0;
    const must = limit.must || '';
    const source = rules.markers.join('|');
    const hit = new RegExp(source, 'i');
    const scan = new RegExp(source, 'gi');
    const take = (src) => {
      const text = String(src || '');
      if (!text || !hit.test(text)) return;
      const parts = [];
      if (text.length <= rules.wholeLimit) parts.push(text);
      else {
        const spans = [];
        let match;
        while ((match = scan.exec(text))) {
          const start = Math.max(0, match.index - rules.before);
          let end = Math.min(text.length, match.index + rules.after);
          const marks = Array.isArray(rules.endMarkers) ? rules.endMarkers : [];
          const reach = Number(rules.endWithin) || 0;
          if (marks.length && reach) {
            const windowText = text.slice(match.index, Math.min(text.length, match.index + reach));
            const lower = windowText.toLowerCase();
            let cut = -1;
            for (const mark of marks) {
              const at = lower.indexOf(String(mark).toLowerCase());
              if (at >= 0 && (cut < 0 || at < cut)) cut = at + String(mark).length;
            }
            if (cut >= 0) end = Math.min(text.length, match.index + cut);
          }
          const last = spans[spans.length - 1];
          if (last && start <= last[1]) last[1] = Math.max(last[1], end);
          else spans.push([start, end]);
          if (spans.length > rules.maxSpans) break;
        }
        scan.lastIndex = 0;
        for (const pair of spans) parts.push(text.slice(pair[0], pair[1]));
      }
      for (const part of parts) {
        if (must && part.indexOf(must) === -1) continue;
        if (chars > limit.maxChars || bodies.length >= limit.maxBodies) return;
        bodies.push(part);
        chars += part.length;
      }
    };
    for (const text of texts || []) take(text);
    return bodies;
  }

  function threadsPayload(video) {
    const rules = threadsRules();
    const texts = [];
    for (const node of document.querySelectorAll('script')) texts.push(node.textContent || '');
    for (const raw of dashBodies) texts.push(raw);
    const bodies = collectBodies(texts, rules, rules && { maxChars: rules.maxChars, maxBodies: rules.maxBodies });
    let videoCount = 0;
    try { videoCount = document.querySelectorAll('video').length; } catch { videoCount = 0; }
    return {
      site: 'threads',
      pageUrl: pageUrlFor(video),
      postUrl: postUrlFor(video),
      card: cardSnapshot(video),
      videoCount,
      tokens: threadsMediaTokens(video),
      played: threadsPlayedTokens(video),
      bodies,
      directLines: (video && video.getAttribute && video.getAttribute('data-zdm-direct-urls')) || '',
    };
  }

  function threadsAppHit(video) {
    return appHit(video, 'threads');
  }

  function threadsAskApp(video) {
    askApp(video, 'threads');
  }

  function threadLog(...args) {
    try { send({ type: 'thread-debug', args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)) }); } catch {}
  }

  function formatsHaveResolution(formats) {
    for (const fmt of formats || []) {
      if (qualityHeight(fmt) > 0) return true;
    }
    return false;
  }

  const _threadsRefreshSent = new Set();
  function refreshThreadsMenus() {
    if (!isThreads()) return;
    for (const entry of tracked.values()) {
      if (!entry || !entry.video || !document.contains(entry.video)) continue;
      const formats = pageFormatsFor(entry.video);
      if (!formats.length) continue;
      if (entry.menu && entry.menu.classList.contains('zdm-menu-open')) {
        buildQualityMenu(entry, formats, entry.pageTitle || '', appMenuFor(entry.video));
      }
      const key = mediaKey(entry.video);
      const cached = qualityMem.get(key);
      const cachedUrls = cached && cached.formats ? cached.formats.map((fmt) => fmt.url).sort().join('\n') : '';
      const nextUrls = formats.map((fmt) => fmt.url).sort().join('\n');
      if (cached && cached.formats && cached.formats.some((fmt) => fmt && typeof fmt.complete === 'boolean')) {
        if (cached.formats.some((fmt) => fmt.complete)) continue;
      }
      const cachedResolved = !!(cached && cached.formats && cached.formats.length && formatsHaveResolution(cached.formats));
      const hit = threadsAppRows.get(entry.video);
      const nextResolved = hit && typeof hit.ask === 'boolean' ? hit.ask === false : formatsHaveResolution(formats);
      if (cachedResolved && (!nextResolved || cachedUrls === nextUrls)) continue;
      if (_threadsRefreshSent.has(key) && !nextResolved && cachedUrls === nextUrls) continue;
      _threadsRefreshSent.add(key);
      send({
        type: 'video-found',
        zdmId: entry.id,
        cacheKey: key,
        src: mediaSrc(entry.video) || entry.video.currentSrc || entry.video.src || '',
        poster: entry.video.poster || '',
        pageUrl: pageUrlFor(entry.video),
        postUrl: postUrlFor(entry.video),
        pageTitle: entry.pageTitle,
        tagName: entry.pinned ? 'audio' : entry.video.tagName.toLowerCase(),
        pageFormats: formats,
        pageTranscript: entry.transcript,
        frameId: window.self !== window.top ? 1 : 0,
      });
    }
  }

  const _ownedRefreshSent = new Map();
  function refreshOwnedMenus() {
    if (!isFacebook() && !isInstagram()) return;
    for (const entry of tracked.values()) {
      if (!entry || !entry.video || !document.contains(entry.video)) continue;
      const formats = pageFormatsFor(entry.video);
      if (!formats.length) continue;
      if (entry.menu && entry.menu.classList.contains('zdm-menu-open')) {
        buildQualityMenu(entry, formats, entry.pageTitle || '', appMenuFor(entry.video));
      }
      const key = mediaKey(entry.video);
      const nextUrls = formats.map((fmt) => fmt && fmt.url).filter(Boolean).sort().join('\n');
      if (!nextUrls || _ownedRefreshSent.get(key) === nextUrls) continue;
      _ownedRefreshSent.set(key, nextUrls);
      send({
        type: 'video-found',
        zdmId: entry.id,
        cacheKey: key,
        src: mediaSrc(entry.video) || entry.video.currentSrc || entry.video.src || '',
        poster: entry.video.poster || '',
        pageUrl: pageUrlFor(entry.video),
        postUrl: postUrlFor(entry.video),
        pageTitle: entry.pageTitle,
        tagName: entry.pinned ? 'audio' : entry.video.tagName.toLowerCase(),
        pageFormats: formats,
        pageTranscript: entry.transcript,
        frameId: window.self !== window.top ? 1 : 0,
      });
    }
  }

  function rememberBlobMedia(blobUrl, videoUrl, kind) {
    if (!blobUrl || !videoUrl) return;
    let lines = pendingBlobMedia.get(blobUrl);
    if (!lines) {
      lines = new Map();
      pendingBlobMedia.set(blobUrl, lines);
      if (pendingBlobMedia.size > 40) pendingBlobMedia.delete(pendingBlobMedia.keys().next().value);
    }
    const nextKind = kind === 'audio' || kind === 'video' ? kind : (lines.get(videoUrl) || '');
    if (!lines.has(videoUrl) || (nextKind && lines.get(videoUrl) !== nextKind)) lines.set(videoUrl, nextKind);
  }

  function writeDirectLines(video, blobUrl, lines) {
    if (video.getAttribute('data-zdm-direct-blob') !== blobUrl) {
      video.setAttribute('data-zdm-direct-blob', blobUrl);
      video.removeAttribute('data-zdm-direct-urls');
    }
    const merged = new Map();
    for (const line of String(video.getAttribute('data-zdm-direct-urls') || '').split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      const url = tab < 0 ? line : line.slice(0, tab);
      const lineKind = tab < 0 ? '' : line.slice(tab + 1);
      if (url) merged.set(url, lineKind);
    }
    let changed = false;
    for (const [url, lineKind] of lines) {
      if (!merged.has(url) || (lineKind && merged.get(url) !== lineKind)) {
        merged.set(url, lineKind || merged.get(url) || '');
        changed = true;
      }
    }
    if (!changed) return false;
    video.setAttribute('data-zdm-direct-urls', [...merged].map(([url, lineKind]) => lineKind ? `${url}\t${lineKind}` : url).join('\n'));
    return true;
  }

  function bindPendingDirects() {
    if (!pendingBlobMedia.size) return false;
    let linked = false;
    for (const video of document.querySelectorAll('video')) {
      const blobUrl = video.currentSrc || video.src || '';
      const lines = pendingBlobMedia.get(blobUrl);
      if (!lines || !writeDirectLines(video, blobUrl, lines)) continue;
      linked = true;
    }
    return linked;
  }

  let threadsRefreshTimer = 0;
  function scheduleThreadsRefresh() {
    if (!isThreads()) return;
    if (threadsRefreshTimer) clearTimeout(threadsRefreshTimer);
    threadsRefreshTimer = setTimeout(() => {
      threadsRefreshTimer = 0;
      refreshThreadsMenus();
    }, 300);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data) return;
    if (data.source === 'zdm-hls-thumb') {
      if (data.url) forgetThumb(String(data.url));
      return;
    }
    if (data.source === 'zdm-hls-url') {
      if (data.url && isThumbList(data.url)) {
        forgetThumb(String(data.url));
        return;
      }
      if (data.url) {
        seenPlaylistUrls.add(String(data.url));
        while (seenPlaylistUrls.size > 30) seenPlaylistUrls.delete(seenPlaylistUrls.keys().next().value);
      }
      return;
    }
    if (data.source === 'zdm-fb-share') {
      const url = String(data.url || '');
      if (/facebook\.com\/share\/|facebook\.com\/stories\/\d+\/?$/i.test(url)) fbVisibleShare = url;
      return;
    }
    if (data.source === 'zdm-story-body') {
      const site = data.site === 'instagram' ? 'instagram' : (data.site === 'facebook' ? 'facebook' : '');
      const body = typeof data.body === 'string' ? data.body : '';
      if (site && body) send({ type: 'capture-ingest', site, pageUrl: String(data.pageUrl || location.href), body });
      return;
    }
    if (data.source === 'zdm-fb-live') {
      if (!isFacebook() || !isStoryPage()) return;
      const url = String(data.videoUrl || '');
      if (/^https?:/i.test(url) && data.kind !== 'audio') {
        const view = facebookStoryView();
        if (view.token) {
          const key = storyCacheKey(view, view.index);
          const row = { url, ext: 'mp4', hasVideo: true, hasAudio: true, quality: 'HD', width: 0, height: 0 };
          const prev = appStoryRows.get(key) || [];
          if (!prev.some((item) => item && item.url === url)) appStoryRows.set(key, [row].concat(prev));
        }
      }
      refreshOwnedMenus();
      return;
    }
    if (data.source === 'zdm-dash') {
      rememberThreadsDash(data.text);
      return;
    }
    if (data.source === 'zdm-threads-mp4') {
      const blobUrl = data.blobUrl;
      let videoUrl = data.videoUrl;
      if (blobUrl && videoUrl) {
        try { const vu = new URL(videoUrl); vu.searchParams.delete('bytestart'); vu.searchParams.delete('byteend'); videoUrl = vu.toString(); } catch {}
        rememberBlobMedia(blobUrl, videoUrl, data.kind);
        if (bindPendingDirects()) {
          threadLog('mp4-linked:', String(videoUrl).split('/').pop().slice(0, 20), data.kind || 'file', 'to video');
          refreshThreadsMenus();
          refreshOwnedMenus();
        }
      }
      return;
    }
    if (data.source === 'zdm-audio') {
      takePlayedAudio(data);
      return;
    }
    if (data.source === 'zdm-player') { rememberTikTokPayload(data.text); return; }
    if (data.source !== 'zdm-hls') return;
    if (!data.url || !data.text) return;
    if (!/#EXTM3U/i.test(data.text) && !/<MPD[\s>]/i.test(data.text)) return;
    const playlistUrl = String(data.url);
    if (isThumbList(playlistUrl) || imageOnlyList(data.text)) {
      forgetThumb(playlistUrl);
      return;
    }
    playlistBodies.delete(playlistUrl);
    playlistBodies.set(playlistUrl, String(data.text).slice(0, 1500000));
    while (playlistBodies.size > 30) playlistBodies.delete(playlistBodies.keys().next().value);
    send({ type: 'playlist-body', url: playlistUrl, text: playlistBodies.get(playlistUrl) });
  });

  function applyQuality(quality) {
    if (!quality || typeof quality !== 'object') return;
    const validModes = ['full', 'average', 'simple'];
    if (quality.qualityMode) qualitySettings.qualityMode = validModes.includes(quality.qualityMode) ? quality.qualityMode : 'full';
    if (quality.fpsDisplay) qualitySettings.fpsDisplay = (quality.fpsDisplay === '30' || quality.fpsDisplay === 'off') ? quality.fpsDisplay : '60';
    if (quality.qualityStamp != null) {
      const next = Number(quality.qualityStamp) || 0;
      if (next !== qualityStamp) {
        qualityStamp = next;
        try { qualityMem.clear(); } catch { /* map is not ready yet */ }
      }
    }
  }

  function pullButtonStyle() {
    try {
      chrome.storage.local.get({ buttonStyle: 'square' }, (data) => {
        if (data && data.buttonStyle) {
          applyButtonStyle(data.buttonStyle);
        }
      });
    } catch {}
  }

  pullButtonStyle();

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return;
        if (changes.buttonStyle && changes.buttonStyle.newValue) {
          applyButtonStyle(changes.buttonStyle.newValue);
        }
      });
    }
  } catch { /* ignore */ }

  function applyPageRules(rules) {
    if (!rules || typeof rules !== 'object') return;
    const had = !!(threadsCollect || tiktokCollect || igCollectRules || pageScriptCollect || xCollect);
    if (rules.threads && typeof rules.threads === 'object') threadsCollect = rules.threads;
    if (rules.tiktok && typeof rules.tiktok === 'object') tiktokCollect = rules.tiktok;
    if (rules.instagram && typeof rules.instagram === 'object') igCollectRules = rules.instagram;
    if (rules.facebook && typeof rules.facebook === 'object') pageScriptCollect = rules.facebook;
    if (rules.x && typeof rules.x === 'object') xCollect = rules.x;
    if (!had && pageOn) scanForVideos();
  }

  function applyCatch(catchSettings, active) {
    if (typeof active !== 'boolean') {
      if (!catchSettings) pageOn = true;
      return;
    }
    const wasOn = pageOn;
    pageOn = active;
    if (!pageOn) {
      for (const entry of tracked.values()) hideEntry(entry);
      for (const slot of slots.values()) {
        slot.overlay.classList.remove('zdm-visible');
        slot.overlay.style.visibility = 'hidden';
        slot.menu.classList.remove('zdm-menu-open');
      }
    } else if (!wasOn) {
      scanForVideos();
    }
  }
  let portWasDead = false;
  let nextId = 1;
  const tracked = new Map();
  let positionTimer = null;
  let activeId = null;
  let playGen = 0;
  let settleRaf = 0;
  const qualityMem = new Map();

  function keyFromUrl(raw) {
    if (!raw) return '';
    let href = String(raw);
    try { href = new URL(href, location.href).href; } catch { return ''; }
    let m = href.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i);
    if (m) return 'tt:' + m[1];
    m = href.match(/\/shorts\/([\w-]{6,})/);
    if (m) return 'yt:' + m[1];
    m = href.match(/[?&]v=([\w-]{6,})/);
    if (m) return 'yt:' + m[1];
    m = href.match(/youtu\.be\/([\w-]{6,})/);
    if (m) return 'yt:' + m[1];
    m = href.match(/instagram\.com\/stories\/[^/?#]+\/(\d+)/i);
    if (m) return 'igstory:' + m[1];
    m = href.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    if (m) return 'ig:' + m[1];
    m = href.match(/facebook\.com\/stories\/([^/?#]+)\/([^/?#]+)/i);
    if (m) return 'fbstory:' + m[1] + ':' + m[2].slice(0, 80);
    m = href.match(/facebook\.com\/reel\/(\d{5,})/i);
    if (m) return 'fb:' + m[1];
    m = href.match(/facebook\.com\/(?:reel\/|watch\/).*?[?&]v=(\d+)/i) || href.match(/facebook\.com\/[^?#]*\/videos\/(\d+)/i);
    if (m) return 'fb:' + m[1];
    m = href.match(/threads\.(?:net|com)\/@[^/]+\/post\/([A-Za-z0-9_-]+)/i);
    if (m) return 'th:' + m[1];
    m = href.match(/(?:x|twitter)\.com\/(?:i\/status\/|[^/?#]+\/status\/)(\d+)/i);
    if (m) return 'x:' + m[1];
    return '';
  }

  function isTikTok() {
    return /(^|\.)tiktok\.com$/i.test(location.hostname);
  }

  function isThreads() {
    return /(^|\.)threads\.(net|com)$/i.test(location.hostname);
  }

  function isInstagram() {
    return /(^|\.)instagram\.com$/i.test(location.hostname);
  }

  function isX() {
    return /(^|\.)(x|twitter)\.com$/i.test(location.hostname);
  }

  function isFacebook() {
    return /(^|\.)facebook\.com$/i.test(location.hostname);
  }

  function isStoryPage() {
    return /instagram\.com\/stories\/[^/?#]+/i.test(location.href) || /facebook\.com\/stories\//i.test(location.href);
  }

  function storyVisible(video) {
    if (!video || !video.getBoundingClientRect) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return cx > 0 && cy > 0 && cx < (window.innerWidth || 1) && cy < (window.innerHeight || 1);
  }

  function facebookSpecificPage() {
    const key = keyFromUrl(location.href);
    return key.indexOf('fb:') === 0;
  }

  function facebookReelKey(video) {
    const known = knownIdentity(video);
    if (known && known.url) {
      const keyed = keyFromUrl(known.url);
      if (keyed) return keyed;
    }
    if (isStoryPage()) {
      const story = keyFromUrl(visibleFacebookStoryUrl() || location.href);
      return story && storyVisible(video) ? story : '';
    }
    return keyFromUrl(location.href);
  }

  const tiktokBodies = [];
  const tiktokUseApp = true;
  const tiktokAppRows = new WeakMap();
  const tiktokAppFlight = new WeakMap();
  let tiktokCollect = null;

  function tiktokRules() {
    const rules = tiktokCollect;
    const markers = markerList(rules, 'markers');
    if (!markers) return null;
    return {
      rawMax: ruleNumber(rules, 'rawMax'),
      rawKeep: ruleNumber(rules, 'rawKeep'),
      scriptMax: ruleNumber(rules, 'scriptMax'),
      scriptTake: ruleNumber(rules, 'scriptTake'),
      payloadChars: ruleNumber(rules, 'payloadChars'),
      payloadBodies: ruleNumber(rules, 'payloadBodies'),
      requireId: rules.requireId !== false,
      markers,
    };
  }

  function rememberTikTokRaw(text) {
    const rules = tiktokRules();
    if (!rules) return false;
    const src = String(text || '');
    if (!src || src.length > rules.rawMax) return false;
    if (tiktokBodies.indexOf(src) !== -1) return false;
    tiktokBodies.push(src);
    while (tiktokBodies.length > rules.rawKeep) tiktokBodies.shift();
    return true;
  }

  function rememberTikTokPayload(text) {
    if (!isTikTok() || !text) return;
    if (rememberTikTokRaw(text)) refreshTikTokActive();
  }

  function refreshTikTokActive() {
    const entry = activeId != null ? tracked.get(activeId) : null;
    if (!entry || !document.contains(entry.video)) return;
    const formats = pageFormatsFor(entry.video);
    if (!formats.length) return;
    const key = mediaKey(entry.video);
    const have = qualityMem.get(key);
    const haveUrls = have && have.formats ? have.formats.map((fmt) => fmt.url).join('\n') : '';
    const nextUrls = formats.map((fmt) => fmt.url).join('\n');
    if (haveUrls && haveUrls === nextUrls) return;
    send({
      type: 'video-playing',
      resetCache: true,
      playGen: entry.playGen || 0,
      zdmId: entry.id,
      cacheKey: key,
      src: entry.video.currentSrc || entry.video.src || '',
      pageUrl: pageUrlFor(entry.video),
      postUrl: postUrlFor(entry.video),
      pageTitle: entry.pageTitle || docTitle(),
      pageFormats: formats,
      playlists: [],
    });
  }

  function tiktokDomBodies(id) {
    const rules = tiktokRules();
    if (!rules) return [];
    const marker = new RegExp(rules.markers.join('|'), 'i');
    const out = [];
    const universal = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    const take = (raw) => {
      const text = String(raw || '');
      if (!text || text.length > rules.scriptMax) return;
      if (id && text.indexOf(id) === -1) return;
      if (out.indexOf(text) !== -1) return;
      out.push(text);
    };
    if (universal) take(universal.textContent);
    let seen = 0;
    for (const node of document.querySelectorAll('script')) {
      if (node === universal) continue;
      const raw = node.textContent || '';
      if (!raw || raw.length > rules.scriptMax || (id && raw.indexOf(id) === -1)) continue;
      if (!marker.test(raw)) continue;
      take(raw);
      seen += 1;
      if (seen >= rules.scriptTake) break;
    }
    return out;
  }

  function tiktokPayload(video) {
    const share = tiktokShareUrl(video);
    const id = ((share || '').match(/\/(?:video|photo)\/(\d+)/) || [])[1] || '';
    const bodies = [];
    let chars = 0;
    const rules = tiktokRules();
    const push = (raw) => {
      if (!rules) return;
      const text = String(raw || '');
      if (!text || (id && text.indexOf(id) === -1)) return;
      if (chars + text.length > rules.payloadChars || bodies.length >= rules.payloadBodies) return;
      if (bodies.indexOf(text) !== -1) return;
      bodies.push(text);
      chars += text.length;
    };
    for (const raw of tiktokBodies) push(raw);
    for (const raw of tiktokDomBodies(id)) push(raw);
    return { site: 'tiktok', pageUrl: pageUrlFor(video), postUrl: share, id, bodies };
  }

  function tiktokAppHit(video) {
    return appHit(video, 'tiktok');
  }

  function tiktokAskApp(video) {
    askApp(video, 'tiktok');
  }

  function playlistExtra(video) {
    return {
      listed: isX() && video ? listedUrls(video) : [],
    };
  }

  function payloadStamp(value) {
    let hash = 2166136261;
    const add = (text) => {
      const src = String(text == null ? '' : text);
      hash ^= src.length;
      const step = Math.max(1, Math.floor(src.length / 32));
      for (let i = 0; i < src.length; i += step) hash = Math.imul(hash, 16777619) ^ src.charCodeAt(i);
    };
    const walk = (node) => {
      if (node == null) {
        add('');
        return;
      }
      if (Array.isArray(node)) {
        add('#' + node.length);
        for (let i = 0; i < node.length; i++) walk(node[i]);
        return;
      }
      if (typeof node === 'object') {
        const keys = Object.keys(node).sort();
        add('#' + keys.length);
        for (let i = 0; i < keys.length; i++) {
          add(keys[i]);
          walk(node[keys[i]]);
        }
        return;
      }
      add(node);
    };
    walk(value);
    return (hash >>> 0).toString(16);
  }

  let pageScriptCollect = null;

  function pageScriptRules() {
    const rules = pageScriptCollect;
    if (!rules || typeof rules !== 'object' || typeof rules.packed !== 'string' || !rules.packed) return null;
    if (typeof rules.media !== 'string' || !rules.media || typeof rules.resource !== 'string' || !rules.resource) return null;
    return {
      packed: rules.packed,
      media: rules.media,
      resource: rules.resource,
      scriptMax: ruleNumber(rules, 'scriptMax'),
      scriptChars: ruleNumber(rules, 'scriptChars'),
      scriptTake: ruleNumber(rules, 'scriptTake'),
      seenTake: ruleNumber(rules, 'seenTake'),
      resourceTake: ruleNumber(rules, 'resourceTake'),
      blockedTake: ruleNumber(rules, 'blockedTake'),
    };
  }

  function pageScriptPayload() {
    const rules = pageScriptRules();
    if (!rules) return { pageUrl: location.href, scripts: [], seen: [], resources: [], blocked: [] };
    const media = new RegExp(rules.media, 'i');
    const resource = new RegExp(rules.resource, 'i');
    const scripts = [];
    let chars = 0;
    for (const script of document.scripts) {
      const text = script.textContent || '';
      if (!text) continue;
      if (text.indexOf(rules.packed) === -1 && !media.test(text)) continue;
      if (text.length > rules.scriptMax) continue;
      if (chars + text.length > rules.scriptChars || scripts.length >= rules.scriptTake) break;
      scripts.push(text);
      chars += text.length;
    }
    const seen = [];
    for (const url of seenPlaylistUrls) {
      if (seen.length >= rules.seenTake) break;
      seen.push(String(url));
    }
    const resources = [];
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        const name = entry && entry.name;
        if (!name || !resource.test(name)) continue;
        if (resources.length >= rules.resourceTake) break;
        resources.push(String(name));
      }
    } catch { /* resource timing can be empty on this page */ }
    const blocked = [];
    for (const url of thumbPlaylists) {
      if (blocked.length >= rules.blockedTake) break;
      blocked.push(String(url));
    }
    return { pageUrl: location.href, scripts, seen, resources, blocked };
  }

  function askPageScripts(payload, sig) {
    if (pageScriptFlight === sig) return;
    if (pageScriptHit && pageScriptHit.sig === sig) return;
    if (pageScriptMiss === sig) return;
    pageScriptFlight = sig;
    const requestId = ++threadsCaptureSeq;
    threadsCaptureWait.set(requestId, { kind: 'page-scripts', sig });
    const sent = send({ type: 'capture-page-scripts', requestId, ...payload, site: isX() ? 'x' : '', videoCount: isX() ? xVideoCount : 0 });
    if (!sent) {
      pageScriptFlight = '';
      threadsCaptureWait.delete(requestId);
    }
  }

  function pageScriptFormats() {
    if (!pageScriptRules()) return [];
    const payload = pageScriptPayload();
    if (!payload.scripts.length && !payload.seen.length && !payload.resources.length) return [];
    const sig = payloadStamp(payload);
    if (pageScriptHit && pageScriptHit.sig === sig && pageScriptHit.rows && pageScriptHit.rows.length) return pageScriptHit.rows;
    askPageScripts(payload, sig);
    return [];
  }

  function canonicalSocial(href) {
    if (!href) return '';
    let abs = String(href);
    try { abs = new URL(abs, location.href).href; } catch { return ''; }
    let match = abs.match(/https?:\/\/(?:www\.)?threads\.(?:com|net)\/(@[^/?#]+)\/post\/([A-Za-z0-9_-]+)/i);
    if (match) return `https://www.threads.com/${match[1]}/post/${match[2]}`;
    match = abs.match(/https?:\/\/(?:www\.)?threads\.(?:com|net)\/t\/([A-Za-z0-9_-]+)/i);
    if (match) return `https://www.threads.com/t/${match[1]}`;
    match = abs.match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i);
    if (match && !/^(home|explore|search|i|intent|share)$/i.test(match[1])) return `https://x.com/${match[1]}/status/${match[2]}`;
    match = abs.match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/status\/(\d+)/i);
    if (match) return `https://x.com/i/status/${match[1]}`;
    return '';
  }

  function linkDistance(link, video) {
    let node = link;
    let depth = 0;
    while (node && depth < 30) {
      if (node.contains && node.contains(video)) return depth;
      node = node.parentElement;
      depth += 1;
    }
    return 99;
  }

  function climbBox(video, limit) {
    let best = video && video.parentElement;
    let node = best;
    const max = limit || 28;
    for (let i = 0; i < max && node && node !== document.body && node !== document.documentElement; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      const count = parent.querySelectorAll ? parent.querySelectorAll('video').length : 0;
      if (count > 1) break;
      best = parent;
      node = parent;
    }
    return best || video;
  }

  function docTitle() {
    return String(document.title || '').replace(/^\(\s*\d+\s*\)\s*/, '').trim();
  }

  function genericPageTitle(text) {
    let value = cleanLabel(text);
    if (!value) return true;
    value = value.replace(/^\(\s*\d+\s*\)\s*/, '').trim();
    if (!value) return true;
    if (value.length > 90) return false;
    if (/^(instagram|threads|x|twitter|home|video|watch)$/i.test(value)) return true;
    if (/^(home|الصفحة الرئيسية|الرئيسية)\b/i.test(value)) return true;
    if (/(الصفحة الرئيسية|\bhome\b)/i.test(value) && /(threads|instagram|\bx\b|twitter)/i.test(value)) return true;
    return false;
  }

  function socialChrome(text) {
    const value = cleanLabel(text);
    if (!value || value.length > 220) return false;
    if (/liked by\b.+\bothers\b/i.test(value)) return true;
    if (/view all\s+\d+\s+comments/i.test(value)) return true;
    if (/تم تسجيل الإعجاب|الإعجاب بواسطة|الأشخاص الآخرين|تسجيلات الإعجاب/.test(value)) return true;
    if (/عرض كل التعليقات|مشاهدة كل التعليقات/.test(value)) return true;
    return false;
  }

  function insideSocialChrome(node) {
    let cur = node;
    for (let i = 0; i < 5 && cur; i++) {
      const text = cleanLabel(cur.textContent || '');
      if (text && text.length <= 220 && socialChrome(text)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function ownArticle(video) {
    if (!video || !video.closest) return null;
    const article = video.closest('article, [role="article"]');
    if (!article || !article.querySelectorAll) return null;
    if (article.querySelectorAll('video').length > 2) return null;
    return article;
  }

  function xPiece(video, selector) {
    const article = video && video.closest && video.closest('article');
    const root = article || climbBox(video, 30);
    if (!root || !root.querySelectorAll) return null;
    const nodes = root.querySelectorAll(selector);
    for (const node of nodes) {
      const owner = node.closest && node.closest('article');
      if (article && owner && owner !== article) continue;
      return node;
    }
    return null;
  }

  function xCaption(video) {
    const node = xPiece(video, '[data-testid="tweetText"]');
    return node ? cleanLabel(node.textContent) : '';
  }

  function xAuthor(video) {
    const node = xPiece(video, '[data-testid="User-Name"]');
    if (!node) return '';
    const raw = String(node.innerText || node.textContent || '');
    const lines = raw.split(/\n+/).map((line) => cleanLabel(line)).filter(Boolean);
    for (const line of lines) {
      const name = cleanLabel(line.split('@')[0]).replace(/[·•|].*$/, '').trim();
      if (name && !/^[\d.]+[smhdw]?$/.test(name) && name.length <= 40) return name;
    }
    return (raw.match(/@([A-Za-z0-9_]{1,30})/) || [])[1] || '';
  }

  function threadsPostLink(video) {
    if (!video) return null;
    let node = video;
    let found = null;
    for (let i = 0; i < 32 && node && node !== document.documentElement; i++) {
      const links = [];
      if (node.querySelectorAll) {
        for (const link of node.querySelectorAll('a[href]')) {
          const href = link.href || (link.getAttribute && link.getAttribute('href')) || '';
          const url = canonicalSocial(href);
          const code = url && ((url.match(/\/(?:post|t)\/([A-Za-z0-9_-]+)/i) || [])[1] || '');
          if (!code) continue;
          links.push({ url, link, code, dist: linkDistance(link, video), timed: !!(link.querySelector && link.querySelector('time')) });
        }
      }
      const codes = [...new Set(links.map((item) => item.code))];
      if (codes.length === 1) {
        const timed = links.filter((item) => item.timed);
        const pool = timed.length ? timed : links;
        pool.sort((a, b) => a.dist - b.dist);
        found = pool[0];
      } else if (codes.length > 1) {
        if (found) return found;
        links.sort((a, b) => a.dist - b.dist || (b.timed - a.timed));
        if (links[1] && links[1].dist === links[0].dist) return null;
        return links[0];
      }
      node = node.parentElement;
    }
    return found;
  }

  function threadsCard(video) {
    const alone = (node) => !!(node && node.querySelectorAll && node.querySelectorAll('video').length <= 1);
    const dialog = video && video.closest && video.closest('[role="dialog"]');
    if (alone(dialog)) return dialog;
    const article = ownArticle(video);
    if (alone(article)) return article;
    const found = threadsPostLink(video);
    if (found && found.link) {
      let node = video;
      let shared = null;
      for (let i = 0; i < 32 && node && node !== document.body; i++) {
        if (node.contains && node.contains(found.link)) {
          if (alone(node)) return node;
          if (!shared) shared = node;
        }
        node = node.parentElement;
      }
      if (shared) return shared;
    }
    return climbBox(video, 28);
  }

  function igScope(video) {
    return ownArticle(video) || climbBox(video, 24);
  }

  function profileHandle(root, video) {
    if (!root || !root.querySelectorAll || !video) return '';
    let best = '';
    let bestScore = 99;
    for (const link of root.querySelectorAll('a[href]')) {
      let path = '';
      try { path = new URL(link.href || link.getAttribute('href'), location.href).pathname; } catch { continue; }
      let handle = '';
      const at = path.match(/\/@([A-Za-z0-9._]{2,30})(?:\/|$)/);
      if (at) handle = at[1];
      else {
        const parts = path.split('/').filter(Boolean);
        if (parts.length === 1 && /^[A-Za-z0-9._]{2,30}$/.test(parts[0]) && !/^(explore|reels|direct|stories|accounts|p|reel)$/i.test(parts[0])) handle = parts[0];
      }
      if (!handle) continue;
      if (insideSocialChrome(link)) continue;
      const text = cleanLabel(link.textContent).replace(/^@/, '');
      const named = text && text.length <= 32 && !/^\d/.test(text) && !/^(follow|following|reply|ترجمة|translate)$/i.test(text);
      let score = linkDistance(link, video);
      if (named) score -= 6;
      if (link.querySelector && link.querySelector('img')) score -= 2;
      if (/\/(post|status)\//i.test(path)) score += 4;
      if (score < bestScore) {
        bestScore = score;
        best = named ? text : handle;
      }
    }
    return best;
  }

  function readableCaption(root, video, author) {
    if (!root || !root.querySelectorAll || !video) return '';
    const skip = /^(follow|following|reply|repost|share|like|more|ترجمة|translate|see translation|view|watch|إعادة نشر|رد|مشاركة|log in|sign up)$/i;
    const who = cleanLabel(author).replace(/^@/, '').toLowerCase();
    let best = '';
    let bestScore = -1;
    for (const node of root.querySelectorAll('h1, h2, p, figcaption, span')) {
      if (node.closest && node.closest('button, time, [role="button"], a, .zdm-quality-menu, .zdm-overlay')) continue;
      let text = cleanLabel(node.textContent);
      if (node.querySelectorAll) {
        for (const btn of node.querySelectorAll('button, [role="button"]')) {
          const bit = cleanLabel(btn.textContent);
          if (bit) text = cleanLabel(text.replace(bit, ' '));
        }
      }
      text = text.replace(/\s+(ترجمة|translate|see translation)$/i, '').trim();
      if (!text || text.length < 2 || text.length > 400 || skip.test(text) || genericPageTitle(text) || socialChrome(text)) continue;
      if (/^[\d.,]+[kmb]?$/i.test(text) || /^\d+\s*[smhdw]$/i.test(text)) continue;
      if (who && text.replace(/^@/, '').toLowerCase() === who) continue;
      const inner = node.querySelector && node.querySelector('h1, h2, p, span');
      if (inner && cleanLabel(inner.textContent) === text) continue;
      if (isThreads() && threadsQuoteCaption(node, video, root)) continue;
      const dist = linkDistance(node, video);
      if (dist > (isThreads() ? 32 : 14)) continue;
      const score = 100 - dist * 8 + Math.min(text.length, 48);
      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }
    return best;
  }

  function displayTitle(video) {
    const known = knownIdentity(video);
    return (known && known.title) || '';
  }

  function threadsQuoteCaption(node, video, root) {
    let box = node && node.parentElement;
    for (let i = 0; i < 14 && box && box !== root && box !== document.body; i++) {
      if (box.contains && box.contains(video)) return false;
      if (box.querySelectorAll) {
        for (const link of box.querySelectorAll('a[href]')) {
          const href = link.href || (link.getAttribute && link.getAttribute('href')) || '';
          const url = canonicalSocial(href);
          if (url && /\/(?:post|t)\//i.test(url)) return true;
        }
      }
      box = box.parentElement;
    }
    return false;
  }

  function threadsMediaTokens(video) {
    const out = [];
    const push = (value) => {
      const text = String(value || '').replace(/[^A-Za-z0-9_-]/g, '');
      if (text.length < 16 || out.indexOf(text) !== -1) return;
      if (!/[A-Za-z]/.test(text) || !/\d/.test(text)) return;
      out.push(text);
    };
    const harvest = (raw) => {
      if (!raw || /^(blob:|data:)/i.test(String(raw))) return;
      let parsed;
      try { parsed = new URL(raw, location.href); } catch { return; }
      for (const part of parsed.pathname.split('/').filter(Boolean)) {
        push(decodeURIComponent(part).split('.')[0]);
      }
    };
    if (!video) return out;
    harvest(video.poster || (video.getAttribute && video.getAttribute('poster')));
    harvest(mediaSrc(video));
    const box = video.parentElement;
    if (box && box.querySelectorAll) {
      for (const node of box.querySelectorAll('img[src], source[src]')) {
        harvest(node.currentSrc || node.src || (node.getAttribute && node.getAttribute('src')));
      }
    }
    if (!out.length) {
      const card = threadsCard(video);
      if (card && card.querySelectorAll) {
        for (const node of card.querySelectorAll('img[src]')) {
          harvest(node.currentSrc || node.src || (node.getAttribute && node.getAttribute('src')));
        }
      }
    }
    return out;
  }

  function threadsUrlToken(url) {
    let path = String(url || '');
    try { path = new URL(path).pathname; } catch { path = path.split('?')[0]; }
    const name = path.split('/').filter(Boolean).pop() || '';
    const text = name.split('.')[0].replace(/[^A-Za-z0-9_-]/g, '');
    if (text.length < 16 || !/[A-Za-z]/.test(text) || !/\d/.test(text)) return '';
    return text;
  }

  function threadsPlayedTokens(video) {
    const out = [];
    const raw = video && video.getAttribute ? (video.getAttribute('data-zdm-direct-urls') || '') : '';
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const token = threadsUrlToken(line.split('\t')[0]);
      if (token && out.indexOf(token) === -1) out.push(token);
    }
    return out;
  }

  function listedUrls(video) {
    const raw = video && video.getAttribute ? (video.getAttribute('data-zdm-lists') || '') : '';
    return raw.split('\n').map((item) => item.trim()).filter((item) => item && !isThumbList(item));
  }

  let xCollect = null;
  let xVideoCount = 0;

  function xRules() {
    const rules = xCollect;
    if (!rules || typeof rules !== 'object') return null;
    const maxVideos = Number(rules.maxVideos);
    if (!Number.isFinite(maxVideos)) return null;
    return { maxVideos };
  }

  function xPageFormats(video) {
    const rules = xRules();
    if (!rules) return [];
    const listed = listedUrls(video);
    let videos = 0;
    try { videos = document.querySelectorAll('video').length; } catch { videos = 0; }
    xVideoCount = videos;
    if (!listed.length && videos > rules.maxVideos) return [];
    return pageScriptFormats();
  }

  const appStoryRows = new Map();

  function storyIds() {
    const href = location.href;
    const ids = [];
    const push = (value) => {
      const text = String(value || '');
      if (text && ids.indexOf(text) === -1) ids.push(text);
    };
    const ig = href.match(/instagram\.com\/stories\/[^/?#]+\/(\d+)/i);
    if (ig) push(ig[1]);
    const token = href.match(/facebook\.com\/stories\/[^/?#]+\/([^/?#]+)/i);
    if (token) {
      let raw = token[1];
      try { raw = decodeURIComponent(raw); } catch { /* the token is already plain */ }
      push(raw.replace(/=+$/, ''));
      push(raw);
      try {
        let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const text = atob(b64);
        push(text);
        const nums = text.match(/\d{8,}/g) || [];
        for (const num of nums) push(num);
      } catch { /* the story token is not base64 */ }
    }
    return ids;
  }

  function storyOwner() {
    const match = location.href.match(/instagram\.com\/stories\/([^/?#]+)/i);
    if (!match) return '';
    let name = match[1];
    try { name = decodeURIComponent(name); } catch { /* the name is already plain */ }
    name = name.toLowerCase();
    if (name === 'highlights') return '';
    return name;
  }

  function storyDomMediaId(username) {
    if (!username) return '';
    const safe = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('/stories/' + safe + '/(\\d{8,})', 'i');
    let node = null;
    for (const video of document.querySelectorAll('video')) {
      if (storyVisible(video)) { node = video; break; }
    }
    for (let i = 0; i < 8 && node; i++) {
      if (!node.querySelectorAll) {
        node = node.parentElement;
        continue;
      }
      const ids = [];
      for (const link of node.querySelectorAll('a[href]')) {
        const href = link.href || link.getAttribute('href') || '';
        const found = href.match(re);
        if (found && ids.indexOf(found[1]) === -1) ids.push(found[1]);
      }
      if (ids.length === 1) return ids[0];
      if (ids.length > 1) return '';
      node = node.parentElement;
    }
    return '';
  }

  function centeredStoryMedia() {
    if (!isFacebook() || !/facebook\.com\/stories\//i.test(location.href)) return null;
    const x = (window.innerWidth || 0) / 2;
    const y = (window.innerHeight || 0) * 0.55;
    const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    let video = null;
    let picture = null;
    for (const el of stack) {
      if (!el || el.nodeType !== 1) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('zdm-') !== -1) continue;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rect || rect.width < 180 || rect.height < 240) continue;
      if (!video && el.tagName === 'VIDEO') video = el;
      if (!picture && el.tagName === 'IMG') picture = el;
    }
    if (!video) return picture;
    const src = video.currentSrc || video.src || '';
    const marked = video.getAttribute && video.getAttribute('data-zdm-direct-urls');
    let objectUrl = false;
    try { objectUrl = !!video.srcObject; } catch { objectUrl = false; }
    const playing = video.readyState >= 2 && !video.paused;
    if (playing || objectUrl || marked || src.indexOf('blob:') === 0 || /^https?:/i.test(src)) return video;
    return picture || video;
  }

  function tokenFromStoryNode(node) {
    let el = node;
    for (let i = 0; i < 12 && el && el !== document.body; i++) {
      const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/stories/"]') : [];
      const tokens = [];
      for (const link of links) {
        const href = link.href || link.getAttribute('href') || '';
        const match = href.match(/facebook\.com\/stories\/[^/?#]+\/([^/?#]+)/i);
        if (!match) continue;
        let raw = match[1];
        try { raw = decodeURIComponent(raw); } catch { /* the token is already plain */ }
        raw = raw.replace(/=+$/, '');
        if (raw && tokens.indexOf(raw) === -1) tokens.push(raw);
      }
      if (tokens.length === 1) return tokens[0];
      if (tokens.length > 1) return '';
      const html = el.outerHTML || '';
      if (html.length > 0 && html.length < 180000) {
        const found = html.match(/Uzpf[A-Za-z0-9_-]{16,}/g) || [];
        const unique = [];
        for (const token of found) {
          if (unique.indexOf(token) === -1) unique.push(token);
        }
        if (unique.length === 1) return unique[0];
        if (unique.length > 1) return '';
      }
      el = el.parentElement;
    }
    return '';
  }

  function visibleFacebookStoryUrl() {
    const view = facebookStoryView();
    if (view.owner && view.token) return 'https://www.facebook.com/stories/' + view.owner + '/' + view.token + '/';
    const media = centeredStoryMedia();
    const token = media ? tokenFromStoryNode(media) : '';
    if (!token) return '';
    const owner = (location.href.match(/facebook\.com\/stories\/([^/?#]+)/i) || [])[1] || '';
    if (!owner) return '';
    return 'https://www.facebook.com/stories/' + owner + '/' + token + '/';
  }

  function facebookCenteredFormats() {
    const media = centeredStoryMedia();
    if (!media) return null;
    if (media.tagName === 'IMG') {
      const src = media.currentSrc || media.src || '';
      if (!/fbcdn\.net|cdninstagram\.com/i.test(src) || /emoji|rsrc\.php|static\.xx\.fbcdn|safe_image\.php/i.test(src)) return [];
      const rect = media.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 240) return [];
      return [{
        url: src,
        ext: 'jpg',
        hasVideo: true,
        hasAudio: false,
        quality: 'Photo',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }];
    }
    const direct = media.currentSrc || media.src || '';
    if (/^https?:/i.test(direct) && /fbcdn\.net|cdninstagram\.com/i.test(direct) && /(\.mp4|\.mpd|\/o1\/v\/)/i.test(direct)) {
      return [{ url: direct, ext: 'mp4', hasVideo: true, hasAudio: true, quality: 'Original', width: 0, height: 0 }];
    }
    const owned = elementMediaFormats(media);
    if (owned.length) return owned;
    return [];
  }

  function instagramStoryView() {
    const owner = storyOwner();
    const ids = storyIds();
    const domId = !ids.length ? storyDomMediaId(owner) : '';
    const token = ids[0] || domId || '';
    return { owner, token, index: 0, count: token ? 1 : 0, tokens: token ? [token] : [] };
  }

  function storyFormats() {
    if (!isStoryPage()) return [];
    if (isFacebook()) {
      const view = facebookStoryView();
      const rows = rowsForStoryIndex(view, view.index);
      if (rows.length) return rows;
    }
    if (isInstagram()) {
      const rows = rowsForStoryIndex(instagramStoryView(), 0);
      if (rows.length) return rows;
    }
    return [];
  }

  const igUseApp = true;
  const igAppRows = new WeakMap();
  const igAppFlight = new WeakMap();
  let igStoreGen = 0;
  let igCollectRules = null;

  function igRules() {
    const rules = igCollectRules;
    const markers = markerList(rules, 'markers');
    const scriptMarkers = markerList(rules, 'scriptMarkers');
    if (!markers || !scriptMarkers) return null;
    return {
      markers,
      scriptMarkers,
      wholeLimit: ruleNumber(rules, 'wholeLimit'),
      before: ruleNumber(rules, 'before'),
      after: ruleNumber(rules, 'after'),
      maxSpans: ruleNumber(rules, 'maxSpans'),
      payloadChars: ruleNumber(rules, 'payloadChars'),
      payloadBodies: ruleNumber(rules, 'payloadBodies'),
      scriptMax: ruleNumber(rules, 'scriptMax'),
      scriptChars: ruleNumber(rules, 'scriptChars'),
      scriptTake: ruleNumber(rules, 'scriptTake'),
      itemTake: ruleNumber(rules, 'itemTake'),
      dashMax: ruleNumber(rules, 'dashMax'),
    };
  }

  function igUsername(text) {
    const match = String(text || '').replace(/^@/, '').match(/[A-Za-z0-9._]{2,30}/);
    return match ? match[0].toLowerCase() : '';
  }

  function igAuthor(video) {
    const fromHandle = igUsername(profileHandle(igScope(video), video));
    if (fromHandle) return fromHandle;
    const by = cleanLabel(displayTitle(video)).match(/\bby\s+@?([A-Za-z0-9._]{2,30})/i);
    return by ? by[1].toLowerCase() : '';
  }

  function igPayload(video) {
    const postUrl = resolvePostUrl(video) || '';
    const foundCode = ((postUrl || '').match(IG_POST_RE) || [])[2] || '';
    const rules = igRules();
    const texts = [];
    if (foundCode) {
      for (const node of document.querySelectorAll('script')) texts.push(node.textContent || '');
    }
    const bodies = collectBodies(texts, rules, rules && {
      maxChars: rules.payloadChars,
      maxBodies: rules.payloadBodies,
      must: foundCode,
    });
    const codeHasDash = !!(foundCode && bodies.some((part) => part.indexOf(foundCode) !== -1 && /video_dash_manifest|<MPD[\s>]/i.test(part)));
    const shortcode = codeHasDash ? foundCode : '';
    const author = igAuthor(video);
    let caption = cleanLabel(displayTitle(video));
    const byline = caption.match(/\s+by\s+@?[A-Za-z0-9._]{2,30}.*$/i);
    if (byline) caption = caption.slice(0, byline.index);
    const played = threadsPlayedTokens(video);
    const scripts = [];
    let scriptChars = 0;
    if (!codeHasDash && rules) {
      for (const node of document.querySelectorAll('script[type="application/json"]')) {
        const raw = node.textContent || '';
        if (!rules.scriptMarkers.some((mark) => raw.indexOf(mark) !== -1)) continue;
        if (raw.length > rules.scriptMax || scriptChars + raw.length > rules.scriptChars || scripts.length >= rules.scriptTake) break;
        scripts.push(raw);
        scriptChars += raw.length;
      }
    }
    return {
      site: 'instagram',
      pageUrl: pageUrlFor(video),
      postUrl: shortcode ? postUrl : '',
      card: cardSnapshot(video),
      shortcode,
      author,
      caption,
      played,
      bodies,
      items: [],
      storeGen: igStoreGen,
      scripts,
      directLines: (video && video.getAttribute && video.getAttribute('data-zdm-direct-urls')) || '',
    };
  }

  function igAppHit(video) {
    return appHit(video, 'instagram');
  }

  function igAskApp(video) {
    askApp(video, 'instagram');
  }

  function appSpec(site) {
    if (site === 'tiktok') {
      return {
        enabled: tiktokUseApp,
        payload: tiktokPayload,
        sig: payloadStamp,
        store: tiktokAppRows,
        flight: tiktokAppFlight,
        refresh: refreshTikTokActive,
        label: 'tiktok-app:',
        ready: (payload) => {
          const rules = tiktokRules();
          if (!rules) return false;
          return rules.requireId === false || !!payload.id;
        },
      };
    }
    if (site === 'instagram') {
      return {
        enabled: igUseApp,
        payload: igPayload,
        sig: payloadStamp,
        store: igAppRows,
        flight: igAppFlight,
        refresh: refreshOwnedMenus,
        label: 'ig-app:',
        ready: () => !!igRules(),
      };
    }
    return {
      enabled: threadsUseApp,
      payload: threadsPayload,
      sig: payloadStamp,
      ready: () => !!threadsRules(),
      store: threadsAppRows,
      flight: threadsAppFlight,
      refresh: refreshThreadsMenus,
      label: 'app:',
    };
  }

  function appMenuFor(video) {
    if (!video) return null;
    const hit = threadsAppRows.get(video) || tiktokAppRows.get(video) || igAppRows.get(video);
    return hit && hit.menu ? hit.menu : null;
  }

  function appHit(video, site) {
    if (!video) return null;
    const spec = appSpec(site);
    const hit = spec.store.get(video);
    if (!hit || !hit.rows || !hit.rows.length) return null;
    const blob = video.currentSrc || video.src || '';
    if (hit.blob && blob && hit.blob !== blob) return null;
    return hit.rows;
  }

  function askApp(video, site) {
    const spec = appSpec(site);
    if (!spec.enabled || !video) return;
    const payload = spec.payload(video);
    if (spec.ready && !spec.ready(payload)) return;
    const sig = spec.sig(payload);
    const hit = spec.store.get(video);
    if (hit && (hit.sig === sig || hit.miss === sig)) return;
    if (spec.flight.get(video) === sig) return;
    spec.flight.set(video, sig);
    const requestId = ++threadsCaptureSeq;
    threadsCaptureWait.set(requestId, {
      video,
      sig,
      site,
      store: spec.store,
      flight: spec.flight,
      refresh: spec.refresh,
      label: spec.label,
    });
    const sent = send({
      type: 'capture-interpret',
      requestId,
      ...payload,
      settings: { qualityMode: qualitySettings.qualityMode, fpsDisplay: qualitySettings.fpsDisplay },
    });
    if (!sent) {
      spec.flight.delete(video);
      threadsCaptureWait.delete(requestId);
    }
  }
  // ---- instagram feed items end

  function stripPlayRange(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.searchParams.delete('bytestart');
      parsed.searchParams.delete('byteend');
      return parsed.href;
    } catch {
      return url || '';
    }
  }

  function elementMediaFormats(video) {
    if (!video || !video.getAttribute) return [];
    const parsed = [];
    let audio = false;
    for (const line of String(video.getAttribute('data-zdm-direct-urls') || '').split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      const url = stripPlayRange(tab < 0 ? line : line.slice(0, tab));
      const kind = tab < 0 ? '' : line.slice(tab + 1);
      if (!url || /^(blob:|data:)/i.test(url)) continue;
      if (kind === 'audio') audio = true;
      parsed.push({ url, kind });
    }
    const rows = [];
    const seen = new Set();
    for (const item of parsed) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const isAudio = item.kind === 'audio';
      rows.push({
        url: item.url,
        ext: isAudio ? 'm4a' : 'mp4',
        hasVideo: !isAudio,
        hasAudio: isAudio ? true : !audio,
        quality: isAudio ? 'Audio' : 'Original',
        direct: true,
      });
    }
    if (!rows.some((row) => row.hasVideo)) {
      const src = mediaSrc(video);
      if (src && /fbcdn\.net|cdninstagram\.com/i.test(src)) {
        rows.unshift({ url: src, ext: 'mp4', hasVideo: true, hasAudio: true, quality: 'Original', direct: true });
      }
    }
    const picture = rows.find((row) => row.hasVideo && !row.hasAudio);
    const sound = rows.find((row) => row.hasAudio && !row.hasVideo);
    if (picture && sound) picture.audioUrl = sound.url;
    return rows;
  }

  function pageFormatsFor(video) {
    const own = ownAudioFormat(video);
    if (own) return [own];
    if (isTikTok()) {
      const appRows = tiktokAppHit(video);
      if (appRows) return appRows;
      tiktokAskApp(video);
      return [];
    }
    if (/instagram\.com/i.test(location.hostname)) {
      if (isStoryPage() && !(video && video.closest && video.closest('article'))) {
        const fromStory = storyFormats();
        if (fromStory.length) return fromStory;
        return elementMediaFormats(video);
      }
      bindPendingDirects();
      const appRows = igAppHit(video);
      if (appRows) return appRows;
      const owned = elementMediaFormats(video);
      igAskApp(video);
      return owned;
    }
    if (isFacebook()) {
      if (isStoryPage()) {
        const view = facebookStoryView();
        const fromCard = rowsForStoryIndex(view, view.index);
        const centered = facebookCenteredFormats();
        const merged = mergeStoryRows(fromCard, centered);
        if (merged.length) return merged;
        const fromStory = storyFormats();
        if (fromStory.length) return fromStory;
        askFacebookStory(view.token, view.owner);
        return elementMediaFormats(video);
      }
      if (facebookSpecificPage()) return pageScriptFormats();
      const owned = elementMediaFormats(video);
      if (owned.length) return owned;
      return [];
    }
    if (isThreads()) {
      bindPendingDirects();
      const appRows = threadsAppHit(video);
      if (appRows) return appRows;
      const owned = elementMediaFormats(video);
      threadsAskApp(video);
      return owned;
    }
    if (isX()) return xPageFormats(video);
    return pageScriptFormats();
  }

  function tiktokItem(video) {
    const marked = video.closest('section[id^="media-card-"], [data-e2e="recommend-list-item-container"], [data-e2e="browse-video"], article');
    if (marked && marked.querySelectorAll('video').length <= 1) return marked;
    let best = video.parentElement;
    let el = video.parentElement;
    for (let i = 0; i < 10 && el && el !== document.body; i++) {
      if (el.querySelectorAll('video').length > 1) break;
      best = el;
      el = el.parentElement;
    }
    return best;
  }

  function canonicalTikTok(href) {
    if (!href) return '';
    let abs = String(href);
    try { abs = new URL(abs, location.href).href; } catch { return ''; }
    if (/\/music\//i.test(abs)) return '';
    const m = abs.match(/tiktok\.com\/@([^/?#]+)\/(video|photo)\/(\d+)/i);
    if (!m) return '';
    return `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}`;
  }

  function getTikTokCaption(video) {
    if (!isTikTok()) return '';
    const item = tiktokItem(video);
    if (!item) return '';
    const desc = item.querySelector('[data-e2e="video-desc"]');
    if (desc && desc.textContent) return desc.textContent.trim();
    // Fallback: search for poster img alt text (which often holds the caption)
    const img = item.querySelector('img[alt]');
    if (img && img.getAttribute('alt')) return img.getAttribute('alt').trim();
    return '';
  }

  function tiktokCardSig(item, video) {
    let id = '';
    let author = '';
    let desc = '';
    try {
      if (item && item.querySelectorAll) {
        for (const node of item.querySelectorAll('[id]')) {
          const match = String(node.id || '').match(/(?:xgwrapper|xgplayer).*?(\d{15,22})/i);
          if (match) { id = match[1]; break; }
        }
      }
      const name = item && item.querySelector && item.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
      author = name ? String(name.textContent || '').trim() : '';
      const text = item && item.querySelector && item.querySelector('[data-e2e="video-desc"]');
      desc = text ? String(text.textContent || '').trim().slice(0, 80) : '';
    } catch { /* the card changed while it was read */ }
    const src = video ? String(video.currentSrc || video.src || '').slice(0, 80) : '';
    return id + '|' + author + '|' + desc + '|' + src;
  }

  function probeTikTokShare(node) {
    if (!node || !node.dispatchEvent) return '';
    try { node.removeAttribute('data-zdm-share'); } catch { /* the node is not an element */ }
    try { node.dispatchEvent(new CustomEvent('zdm-tiktok-probe', { bubbles: true })); } catch { /* the page ignored the probe */ }
    return canonicalTikTok(node.getAttribute ? (node.getAttribute('data-zdm-share') || '') : '');
  }

  function rememberTikTokShare(item, sig, url) {
    if (!item || !url) return url || '';
    try {
      item.__zdmShare = url;
      item.__zdmShareSig = sig;
    } catch { /* a dead card rejects the cache */ }
    return url;
  }

  function tiktokShareUrl(video) {
    const item = tiktokItem(video);
    if (!item) return '';
    const sig = tiktokCardSig(item, video);
    try {
      if (item.__zdmShare && item.__zdmShareSig === sig) return item.__zdmShare;
    } catch { /* a dead card has no cache */ }
    const links = item.querySelectorAll ? item.querySelectorAll('a[href]') : [];
    for (const a of links) {
      const url = canonicalTikTok(a.href || a.getAttribute('href'));
      if (url) return rememberTikTokShare(item, sig, url);
    }
    const probed = probeTikTokShare(item);
    if (probed) return rememberTikTokShare(item, sig, probed);
    let id = '';
    let author = '';
    if (item.querySelectorAll) {
      for (const node of item.querySelectorAll('[id]')) {
        const xm = (node.id || '').match(/(?:xgwrapper|xgplayer).*?(\d{15,22})/i);
        if (xm) { id = xm[1]; break; }
      }
    }
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const am = href.match(/\/@([^/?#]+)/);
      if (!am || am[1] === 'music') continue;
      if (!/\/(?:video|photo)\//.test(href)) { author = am[1]; break; }
      if (!author) author = am[1];
    }
    if (!author && item.querySelector) {
      const nameEl = item.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
      if (nameEl) author = String(nameEl.textContent || '').trim().replace(/^@/, '');
    }
    if (!id) return '';
    return rememberTikTokShare(item, sig, `https://www.tiktok.com/@${author || 'user'}/video/${id}`);
  }

  function captureSite() {
    if (isThreads()) return 'threads';
    if (isTikTok()) return 'tiktok';
    if (isInstagram()) return 'instagram';
    if (isX()) return 'x';
    if (isFacebook()) return 'facebook';
    return '';
  }

  function cardSnapshot(video) {
    const links = [];
    const seen = new Set();
    let node = video;
    for (let depth = 0; depth < 12 && node && node !== document.body && node !== document.documentElement; depth++) {
      if (node.querySelectorAll) {
        if (depth && node.querySelectorAll('video').length > 1) break;
        for (const link of node.querySelectorAll('a[href]')) {
          const href = link.href || (link.getAttribute && link.getAttribute('href')) || '';
          if (!href || href.indexOf('javascript:') === 0 || seen.has(href)) continue;
          seen.add(href);
          links.push({
            href,
            dist: linkDistance(link, video),
            timed: !!(link.querySelector && link.querySelector('time, abbr')),
          });
          if (links.length >= 24) break;
        }
      }
      if (links.length >= 24) break;
      node = node.parentElement;
    }
    let caption = '';
    let author = '';
    let id = '';
    let heading = '';
    if (isX()) {
      caption = xCaption(video);
      author = xAuthor(video);
    } else if (isThreads()) {
      const root = threadsCard(video);
      author = profileHandle(root, video);
      caption = readableCaption(root, video, author);
    } else if (isInstagram()) {
      const root = igScope(video);
      author = profileHandle(root, video);
      const head = root && root.querySelector ? root.querySelector('h1') : null;
      heading = head ? cleanLabel(head.textContent) : '';
      const who = cleanLabel(author).replace(/^@/, '').toLowerCase();
      const headingOk = heading && !genericPageTitle(heading) && !socialChrome(heading) && heading.replace(/^@/, '').toLowerCase() !== who;
      caption = headingOk ? heading : readableCaption(root, video, author);
      if (headingOk) heading = '';
    } else if (isTikTok()) {
      caption = getTikTokCaption(video);
      const item = tiktokItem(video);
      if (item && item.querySelectorAll) {
        for (const box of item.querySelectorAll('[id]')) {
          const match = String(box.id || '').match(/(?:xgwrapper|xgplayer).*?(\d{15,22})/i);
          if (match) { id = match[1]; break; }
        }
      }
      if (item && item.querySelector) {
        const nameEl = item.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
        if (nameEl) author = String(nameEl.textContent || '').trim().replace(/^@/, '');
      }
    }
    return { links, caption: caption || '', author: author || '', id, heading };
  }

  function askCardResolve(entry) {
    const site = captureSite();
    if (!site || !entry || !entry.video) return;
    const card = cardSnapshot(entry.video);
    const stamp = [site, location.href, card.id, card.caption, card.author, card.links.map((link) => link.href).join('\n')].join('\n');
    if (cardResolveStamp.get(entry.video) === stamp) return;
    cardResolveStamp.set(entry.video, stamp);
    const requestId = ++threadsCaptureSeq;
    const view = !isStoryPage() ? null : (site === 'facebook' ? facebookStoryView() : (site === 'instagram' ? instagramStoryView() : null));
    threadsCaptureWait.set(requestId, { kind: 'resolve', entryId: entry.id, stamp, site, storyKey: view ? storyCacheKey(view, view.index) : '' });
    const sent = send({
      type: 'capture-resolve',
      requestId,
      site,
      pageUrl: location.href,
      card,
      storyView: view ? { owner: view.owner, token: view.token, index: view.index, count: view.count, tokens: view.tokens } : undefined,
      settings: { qualityMode: qualitySettings.qualityMode, fpsDisplay: qualitySettings.fpsDisplay },
      videoCount: site === 'x' ? xVideoCount : 0,
    });
    if (!sent) {
      threadsCaptureWait.delete(requestId);
      cardResolveStamp.delete(entry.video);
    }
  }

  function knownIdentity(video) {
    if (!video || !video.getAttribute) return null;
    const id = parseInt(video.getAttribute('__zdm_id__'), 10);
    const entry = id ? tracked.get(id) : null;
    return entry && entry.identity && typeof entry.identity === 'object' ? entry.identity : null;
  }

  function pageUrlFor(video) {
    const known = knownIdentity(video);
    if (known && known.url && !(isFacebook() && isStoryPage())) return known.url;
    if (isFacebook() && isStoryPage()) return visibleFacebookStoryUrl() || location.href;
    return location.href;
  }

  function postUrlFor(video) {
    const known = knownIdentity(video);
    if (known && known.url && !isStoryPage()) return known.url;
    return null;
  }

  function mediaKey(video) {
    const own = ownAudioFormat(video);
    if (own && own.url) return 'audio:' + own.url.split('#')[0];
    const known = knownIdentity(video);
    if (known && known.url && !isStoryPage()) {
      const keyed = keyFromUrl(known.url);
      if (keyed) return keyed;
    }
    if (isTikTok()) return 'dom:' + (video.getAttribute('__zdm_id__') || '');
    if (isStoryPage()) {
      if (isFacebook() && video && storyVisible(video)) {
        const seen = visibleFacebookStoryUrl();
        const card = seen ? keyFromUrl(seen) : '';
        if (card) return card;
        const media = centeredStoryMedia();
        const src = media && (media.currentSrc || media.src) || '';
        if (src && src.indexOf('blob:') !== 0) return 'fbseen:' + src.slice(-48);
      }
      const story = keyFromUrl(location.href);
      if (story && storyVisible(video)) return story;
      return 'dom:' + (video.getAttribute('__zdm_id__') || '');
    }
    if (isX() || isThreads()) return 'dom:' + (video.getAttribute('__zdm_id__') || '');
    if (isFacebook()) {
      const reel = facebookReelKey(video);
      if (reel) return reel;
      return 'dom:' + (video.getAttribute('__zdm_id__') || '');
    }
    let el = video;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const videos = el.querySelectorAll ? el.querySelectorAll('video') : [];
      if (videos.length > 1) break;
      const links = el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
      for (const a of links) {
        const key = keyFromUrl(a.href || a.getAttribute('href'));
        if (key) return key;
      }
      el = el.parentElement;
    }
    const fromPage = keyFromUrl(resolvePostUrl(video)) || keyFromUrl(location.href);
    if (fromPage) return fromPage;
    const src = video.currentSrc || video.src || '';
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) return 'src:' + src.split('#')[0];
    return 'dom:' + (video.getAttribute('__zdm_id__') || '');
  }

  function canonicalInstagram(href) {
    if (!href) return '';
    let abs = String(href);
    try { abs = new URL(abs, location.href).href; } catch { return ''; }
    const m = abs.match(IG_POST_RE);
    if (!m) return '';
    return `https://www.instagram.com/${m[1]}/${m[2]}/`;
  }

  function instagramLinkIn(root) {
    if (!root || !root.querySelectorAll) return '';
    let fallback = '';
    for (const a of root.querySelectorAll('a[href]')) {
      const url = canonicalInstagram(a.href || a.getAttribute('href'));
      if (!url) continue;
      if (a.querySelector('time')) return url;
      if (!fallback) fallback = url;
    }
    return fallback;
  }

  function resolvePostUrl(video) {
    if (!/instagram\.com/i.test(location.hostname)) return null;
    const article = video.closest('article');
    const fromArticle = article ? instagramLinkIn(article) : '';
    if (fromArticle) return fromArticle;
    if (article && article.querySelectorAll && article.querySelectorAll('video').length <= 1) {
      // An ad has no permalink. Looking above the article finds another post's link.
      return canonicalInstagram(location.href) || null;
    }
    let el = video.parentElement;
    for (let i = 0; i < 6 && el && el !== document.body; i++) {
      if (el.querySelectorAll && el.querySelectorAll('video').length > 1) break;
      const found = instagramLinkIn(el);
      if (found) return found;
      el = el.parentElement;
    }
    return canonicalInstagram(location.href) || null;
  }

  const srcObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === 'src' || m.attributeName === 'currentSrc') {
        const id = parseInt(m.target.getAttribute('__zdm_id__'));
        const entry = tracked.get(id);
        if (entry) {
          send({
            type: 'video-src-changed',
            zdmId: id,
            cacheKey: mediaKey(entry.video),
            src: entry.video.currentSrc || entry.video.src || '',
            pageUrl: pageUrlFor(entry.video),
            postUrl: postUrlFor(entry.video),
          });
        }
      }
    }
  });

  function dropPort() {
    const current = port;
    port = null;
    portWasDead = true;
    if (!current) return;
    try { current.disconnect(); } catch { /* already closed */ }
    void chrome.runtime.lastError;
  }

  function connect() {
    if (port) return true;
    try {
      const next = chrome.runtime.connect({ name: window.self === window.top ? 'top' : 'sub' });
      next.onMessage.addListener(onBackgroundMessage);
      next.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port === next) port = null;
        portWasDead = true;
      });
      port = next;
      for (const [url, text] of playlistBodies) {
        try { next.postMessage({ type: 'playlist-body', url, text }); } catch { /* the port closed */ }
      }
      return true;
    } catch {
      port = null;
      return false;
    }
  }

  function send(msg) {
    if (document.visibilityState === 'hidden') return false;
    if (!port) connect();
    if (!port) return false;
    try {
      port.postMessage(msg);
      void chrome.runtime.lastError;
      return true;
    } catch {
      dropPort();
      return false;
    }
  }

  function askQualities(msg) {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        const failed = chrome.runtime.lastError;
        const entry = tracked.get(msg && msg.zdmId);
        if (failed || !res || res.type !== 'qualities') {
          if (!entry) return;
          if (entry.framed) {
            tellParent(entry, 'formats', { formats: [], title: entry.pageTitle || '', transcript: null, menu: null });
            return;
          }
          if (entry.menu && entry.menu.classList.contains('zdm-menu-open') && entry.menu.querySelector('.zdm-spinner')) {
            showMenuNote(entry.menu, 'Extension reconnect failed. Refresh the page.');
          }
          return;
        }
        onBackgroundMessage(res);
      });
      return true;
    } catch {
      return false;
    }
  }

  let idleTimer = null;

  function refreshAfterIdle() {
    if (document.visibilityState !== 'visible' || !portWasDead) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      portWasDead = false;
      connect();
      const entry = activeId != null ? tracked.get(activeId) : null;
      if (!entry || entry.video.paused) return;
      entry._lastPlayPage = '';
      onVideoPlay(entry);
    }, 300);
  }

  function onBackgroundMessage(msg) {
    switch (msg.type) {
      case 'capture-page-scripts': {
        const pending = threadsCaptureWait.get(msg.requestId);
        threadsCaptureWait.delete(msg.requestId);
        if (!pending || pending.kind !== 'page-scripts') return;
        if (pageScriptFlight === pending.sig) pageScriptFlight = '';
        if (pending.sig !== payloadStamp(pageScriptPayload())) return;
        if (msg.collect && typeof msg.collect === 'object') {
          if (typeof msg.collect.packed === 'string' || typeof msg.collect.scriptMax === 'number') pageScriptCollect = msg.collect;
          if (typeof msg.collect.maxVideos === 'number') xCollect = msg.collect;
        }
        if (msg.source !== 'app') {
          pageScriptMiss = pending.sig;
          return;
        }
        pageScriptHit = { sig: pending.sig, rows: Array.isArray(msg.formats) ? msg.formats : [], ask: msg.ask === true };
        if (pageScriptHit.rows.length) refreshTikTokActive();
        break;
      }
      case 'capture-ingested': {
        if (msg.site !== 'instagram') break;
        igStoreGen += 1;
        refreshOwnedMenus();
        break;
      }
      case 'capture-formats': {
        const pending = threadsCaptureWait.get(msg.requestId);
        threadsCaptureWait.delete(msg.requestId);
        if (!pending) return;
        if (pending.flight && pending.flight.get(pending.video) === pending.sig) pending.flight.delete(pending.video);
        const rows = msg.source === 'app' && Array.isArray(msg.formats) ? msg.formats : [];
        const blob = pending.video ? (pending.video.currentSrc || pending.video.src || '') : '';
        const previous = pending.store.get(pending.video);
        if (!rows.length && previous && previous.rows && previous.rows.length && (!previous.blob || !blob || previous.blob === blob)) {
          previous.miss = pending.sig;
          pending.store.set(pending.video, previous);
          break;
        }
        const saved = { sig: pending.sig, rows, blob };
        if (typeof msg.ask === 'boolean') saved.ask = msg.ask;
        const menu = usableMenu(msg.menu);
        if (menu) saved.menu = menu;
        pending.store.set(pending.video, saved);
        if (pending.site === 'threads' && msg.collect && typeof msg.collect === 'object') threadsCollect = msg.collect;
        if (pending.site === 'tiktok' && msg.collect && typeof msg.collect === 'object') tiktokCollect = msg.collect;
        if (pending.site === 'instagram' && msg.collect && typeof msg.collect === 'object') igCollectRules = msg.collect;
        if (rows.length) {
          threadLog(pending.label || 'app:', 'formats=' + rows.length);
          if (pending.refresh) pending.refresh();
        }
        break;
      }
      case 'capture-resolve': {
        const pending = threadsCaptureWait.get(msg.requestId);
        threadsCaptureWait.delete(msg.requestId);
        if (!pending || pending.kind !== 'resolve') return;
        if (pending.storyKey && Array.isArray(msg.rows) && msg.rows.length) {
          appStoryRows.set(pending.storyKey, msg.rows);
          if (appStoryRows.size > 80) appStoryRows.delete(appStoryRows.keys().next().value);
          refreshOwnedMenus();
        }
        const entry = pending.entryId ? tracked.get(pending.entryId) : null;
        if (!entry) return;
        const identity = msg.identity && typeof msg.identity === 'object' ? msg.identity : null;
        if (!identity || (!identity.url && !identity.title)) {
          if (cardResolveStamp.get(entry.video) === pending.stamp) cardResolveStamp.delete(entry.video);
          return;
        }
        entry.identity = { url: identity.url || '', title: identity.title || '' };
        if (identity.title) {
          entry.pageTitle = identity.title;
          const titleEl = entry.menu && entry.menu.querySelector && entry.menu.querySelector('.zdm-menu-title');
          if (titleEl) {
            titleEl.textContent = identity.title;
            titleEl.title = identity.title;
          }
        }
        if (identity.url) entry.pageUrl = identity.url;
        if (msg.collect && typeof msg.collect === 'object') {
          if (pending.site === 'threads') threadsCollect = msg.collect;
          if (pending.site === 'tiktok') tiktokCollect = msg.collect;
          if (pending.site === 'instagram') igCollectRules = msg.collect;
          if (pending.site === 'facebook') pageScriptCollect = msg.collect;
          if (pending.site === 'x') xCollect = msg.collect;
        }
        break;
      }
      case 'qualities': {
        const entry = tracked.get(msg.zdmId);
        const stale = entry && msg.playGen && msg.playGen !== entry.playGen;
        if (msg.cacheKey && Array.isArray(msg.formats) && msg.formats.length && !stale) {
          qualityMem.set(msg.cacheKey, { formats: msg.formats, title: msg.title, transcript: msg.transcript || null, menu: usableMenu(msg.menu) });
        }
        if (entry && Array.isArray(msg.cookieHosts)) entry.cookieHosts = msg.cookieHosts;
        if (!entry || (!entry.pinned && entry.id !== activeId && !(entry.menu && entry.menu.classList.contains('zdm-menu-open'))) || stale) return;
        if (msg.transcript && msg.transcript.url) entry.transcript = msg.transcript;
        let formats = msg.formats;
        if ((!formats || !formats.length) && entry.video && (isInstagram() || isThreads() || (isFacebook() && isStoryPage()))) {
          const local = pageFormatsFor(entry.video);
          if (local.length) formats = local;
        }
        if (entry.framed) {
          tellParent(entry, 'formats', { formats: formats || [], title: msg.title || '', transcript: entry.transcript || null, menu: usableMenu(msg.menu) });
          return;
        }
        buildQualityMenu(entry, formats, msg.title, usableMenu(msg.menu));
        break;
      }
      case 'set-button-style':
        applyButtonStyle(msg.style);
        break;
      case 'settings':
        applyCatch(msg.catch, msg.active);
        applyPageRules(msg.rules);
        applyQuality(msg.quality);
        break;
      case 'fetch-media':
        fetchMediaFromPage(msg.requestId, msg.url, msg.shareUrl);
        break;
      case 'download-started': {
        const entry = tracked.get(msg.zdmId);
        if (entry && entry.btn) {
          setButtonState(entry.btn, 'downloading');
        }
        break;
      }
      case 'audio-seen':
        takeAudioUrl(msg.url, msg.filesize, msg.contentType, msg.title, msg.pageUrl);
        break;

    }
  }

  function fetchMediaFromPage(requestId, url, shareUrl) {
    const onResult = (event) => {
      const data = event && event.data;
      if (!data || data.source !== 'zdm-media' || data.requestId !== requestId) return;
      window.removeEventListener('message', onResult);
      const send = (buffer64) => {
        chrome.runtime.sendMessage({
          type: 'page-fetch-result',
          requestId,
          ok: !!data.ok && !!buffer64,
          status: data.status || 0,
          buffer64: buffer64 || '',
        }).catch(() => {});
      };
      const raw = data.bytes;
      if (!raw) {
        send('');
        return;
      }
      const u8 = raw.buffer ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength) : new Uint8Array(raw);
      let binary = '';
      const pack = async () => {
        for (let i = 0; i < u8.length; i += 8192) {
          binary += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
          if (i > 0 && i % (8192 * 32) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        send(btoa(binary));
      };
      pack().catch(() => send(''));
    };
    window.addEventListener('message', onResult);
    document.dispatchEvent(new CustomEvent('zdm-fetch-media', { detail: { requestId, url, shareUrl: shareUrl || '' } }));
  }

  function overlayRoot() {
    let root = document.querySelector('.zdm-root');
    if (root) return root;
    root = document.createElement('div');
    root.className = 'zdm-root';
    const parent = document.body || document.documentElement;
    parent.appendChild(root);
    return root;
  }

  function holdMenuWheel(menu) {
    menu.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const list = e.target && e.target.closest && e.target.closest('.zdm-picker-list');
      if (!list || list.hidden) return;
      list.scrollTop += e.deltaY;
    }, { passive: false });
  }

  function createOverlay(video) {
    const id = nextId++;
    video.setAttribute('__zdm_id__', id);

    const overlay = document.createElement('div');
    overlay.className = 'zdm-overlay';
    overlay.setAttribute('data-zdm-id', id);

    const btn = document.createElement('button');
    btn.className = 'zdm-btn is-' + activeButtonStyle;
    btn.replaceChildren(createButtonContent());
    btn.title = 'Download with ZDM';

    const menu = document.createElement('div');
    menu.className = 'zdm-quality-menu';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entry = tracked.get(id);
      if (!entry) return;

      const framed = entry.framed || isFramed();
      if (!framed && menu.classList.contains('zdm-menu-open')) {
        menu.classList.remove('zdm-menu-open');
        setButtonState(btn, 'up');
        return;
      }
      setButtonState(btn, 'down');
      for (const other of tracked.values()) {
        if (other === entry || !other.menu) continue;
        other.menu.classList.remove('zdm-menu-open');
        if (other.btn) setButtonState(other.btn, 'up');
      }

      const own = ownAudioFormat(video);
      if (own) {
        const rememberedAudio = qualityMem.get(mediaKey(video));
        if (rememberedAudio && rememberedAudio.transcript && rememberedAudio.transcript.url) entry.transcript = rememberedAudio.transcript;
        else entry.transcript = findTranscript(video);
        const formats = rememberedAudio && rememberedAudio.formats && rememberedAudio.formats.length ? rememberedAudio.formats : [own];
        if (framed) {
          entry.framed = true;
          tellParent(entry, 'formats', { formats, title: entry.pageTitle || '', transcript: entry.transcript || null, menu: rememberedAudio && rememberedAudio.menu });
        } else {
          buildQualityMenu(entry, formats, entry.pageTitle || '', rememberedAudio && rememberedAudio.menu);
          menu.classList.add('zdm-menu-open');
        }
        askQualities({
          type: 'get-qualities',
          zdmId: id,
          playGen: entry.playGen || 0,
          cacheKey: mediaKey(video),
          src: own.url,
          pageUrl: pageUrlFor(video),
          postUrl: postUrlFor(video),
          cookies: document.cookie || '',
          tagName: 'audio',
          pageFormats: [own],
          pageTranscript: entry.transcript,
          pageTitle: entry.pageTitle,
          ...playlistExtra(video),
        });
        return;
      }

      const remembered = qualityMem.get(mediaKey(video));
      const fromApp = remembered && (remembered.formats || []).some((fmt) => fmt && typeof fmt.complete === 'boolean');
      const appReady = !!(fromApp && remembered.formats.some((fmt) => fmt.complete));
      const resolvedMenu = !fromApp && remembered && (remembered.formats || []).some((fmt) => /^(ts|mp4|m4a|mp3|wav|flac|ogg|webm|mkv)$/i.test(fmt.ext || '') && !/master\.m3u8|\/urlset\//i.test(fmt.url || ''));
      const freshSite = isThreads() || (isInstagram() && !resolvePostUrl(video));
      const freshThreads = freshSite ? pageFormatsFor(video) : [];
      const threadsUpgrade = !fromApp && !!(freshSite && remembered && remembered.formats && remembered.formats.length && resolvedMenu && !formatsHaveResolution(remembered.formats) && formatsHaveResolution(freshThreads));
      const threadsStale = !fromApp && !!(freshSite && remembered && remembered.formats && remembered.formats.length && freshThreads.length && freshThreads.map((fmt) => fmt.url).sort().join('\n') !== remembered.formats.map((fmt) => fmt.url).sort().join('\n'));
      if (remembered && remembered.formats && remembered.formats.length && (appReady || (resolvedMenu && !threadsUpgrade && !threadsStale))) {
        if (remembered.transcript && remembered.transcript.url) entry.transcript = remembered.transcript;
        if (framed) {
          entry.framed = true;
          tellParent(entry, 'formats', { formats: remembered.formats, title: remembered.title || '', transcript: entry.transcript || null, menu: remembered.menu });
          return;
        }
        buildQualityMenu(entry, remembered.formats, remembered.title, remembered.menu);
        menu.classList.add('zdm-menu-open');
        return;
      }

      if (framed) {
        entry.framed = true;
        tellParent(entry, 'wait');
      } else {
        showMenuSpinner(menu);
        menu.classList.add('zdm-menu-open');
      }

      askCardResolve(entry);
      const clickFormats = freshSite ? freshThreads : pageFormatsFor(video);
      const sent = askQualities({
        type: 'get-qualities',
        zdmId: id,
        playGen: entry.playGen || 0,
        cacheKey: mediaKey(video),
        src: mediaSrc(video) || video.currentSrc || video.src || '',
        pageUrl: pageUrlFor(video),
        postUrl: postUrlFor(video),
        cookies: document.cookie || '',
        tagName: isAudioAnchor(video) ? 'audio' : video.tagName.toLowerCase(),
        pageFormats: clickFormats,
        pageTranscript: findTranscript(video),
        pageTitle: entry.pageTitle,
        ...playlistExtra(video),
      });
      if (!sent && !framed) {
        showMenuNote(menu, 'Extension reconnect failed. Refresh the page.');
      }
    });

    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    holdMenuWheel(menu);

    overlay.appendChild(btn);
    overlay.appendChild(menu);

    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.zdm-overlay')) return;
      menu.classList.remove('zdm-menu-open');
      setButtonState(btn, 'up');
      menu.querySelectorAll('.zdm-picker-list').forEach((l) => {
        l.hidden = true;
        l.style.right = '';
        l.style.left = '';
      });
    }, true);

    const entry = { id, video, overlay, btn, menu, visible: false, rect: null, _lastPlaySrc: '', _lastPlayPage: '', _lastSrcSent: '', _reelKey: '', playGen: 0, settling: false, pinned: isAudioAnchor(video), transcript: findTranscript(video), pageTitle: displayTitle(video) || (genericPageTitle(docTitle()) ? '' : docTitle()) };
    tracked.set(id, entry);
    askCardResolve(entry);

    overlayRoot().appendChild(overlay);
    hideEntry(entry);
    observeElement(entry);

    srcObserver.observe(video, { attributes: true, attributeFilter: ['src'] });

    video.addEventListener('play', () => onVideoPlay(entry));

    video.addEventListener('loadeddata', () => {
      const newSrc = mediaSrc(video) || video.currentSrc || video.src || '';
      if (newSrc && newSrc !== entry._lastSrcSent) {
        entry._lastSrcSent = newSrc;
        send({
          type: 'video-src-changed',
          zdmId: id,
          cacheKey: mediaKey(video),
          src: newSrc,
          pageUrl: pageUrlFor(video),
          postUrl: postUrlFor(video),
          pageFormats: pageFormatsFor(video),
          pageTranscript: findTranscript(video),
          ...playlistExtra(video),
        });
      }
      if (entry.pinned || !video.paused) onVideoPlay(entry);
    });
    video.addEventListener('playing', () => onVideoPlay(entry));

    const initSrc = video.currentSrc || video.src || '';

    send({
      type: 'video-found',
      zdmId: id,
      cacheKey: mediaKey(video),
      src: initSrc,
      poster: video.poster || '',
      pageUrl: pageUrlFor(video),
      postUrl: postUrlFor(video),
      pageTitle: entry.pageTitle,
      tagName: entry.pinned ? 'audio' : video.tagName.toLowerCase(),
      pageFormats: pageFormatsFor(video),
      pageTranscript: entry.transcript,
      frameId: window.self !== window.top ? 1 : 0,
      ...playlistExtra(video),
    });

    if (entry.pinned) showPinned(entry);
    else if (!video.paused || dedicatedPlayer(video)) onVideoPlay(entry);

    return entry;
  }

  function qualityHeight(fmt) {
    const raw = `${fmt.resolution || ''} ${fmt.quality || ''} ${fmt.note || ''}`;
    const pair = raw.match(/(\d+)\s*[x×*]\s*(\d+)/i);
    if (pair) return Math.min(Number(pair[1]), Number(pair[2]));
    const labeled = raw.match(/(\d+)\s*p/i);
    if (labeled) return Number(labeled[1]);
    const w = Number(fmt.width) || 0;
    const h = Number(fmt.height) || 0;
    if (w && h) return Math.min(w, h);
    return h || 0;
  }

  function formatOptionLabel(fmt) {
    if (!fmt) return '';
    let text = fmt.label || '';
    if (!text) {
      const quality = String(fmt.quality || '').trim();
      const ext = String(fmt.ext || '').trim();
      text = quality && ext ? quality + ' ' + ext.toUpperCase() : (quality || ext || (fmt.hasAudio && !fmt.hasVideo ? 'Audio' : 'Video'));
    }
    const size = Number(fmt.filesize) || 0;
    if (size > 0 && !/-\s*[\d.]+\s*(B|KB|MB|GB)\s*$/i.test(text)) text += ' - ' + formatSize(size);
    return text;
  }

  function rememberSized(entry, lists) {
    const known = new Map();
    const take = (rows) => {
      for (const fmt of rows || []) {
        const size = Number(fmt && fmt.filesize) || 0;
        if (fmt && fmt.url && size > 0) known.set(fmt.url, size);
      }
    };
    take(entry && entry.sizedFormats);
    if (entry && entry.video) {
      const cached = qualityMem.get(mediaKey(entry.video));
      if (cached) take(cached.formats);
    }
    for (const rows of lists) take(rows);
    if (entry) entry.sizedFormats = [...known].map(([url, filesize]) => ({ url, filesize }));
    return known;
  }

  function applyKnownSize(fmt, known) {
    if (!fmt) return fmt;
    const next = Object.assign({}, fmt);
    const size = Number(next.filesize) || known.get(next.url) || 0;
    if (size > 0) next.filesize = size;
    if (size > 0 && next.label && !/-\s*[\d.]+\s*(B|KB|MB|GB)\s*$/i.test(next.label)) {
      next.label = next.label + ' - ' + formatSize(size);
    }
    return next;
  }

  function markFor(fmt) {
    const badge = fmt && fmt.badge;
    if (badge && badge.text && badge.cls) return badge;
    if (fmt && fmt.hasVideo && fmt.hasAudio) return { text: 'V+A', cls: 'zdm-badge-muxed' };
    if (fmt && fmt.hasVideo) return { text: 'V', cls: 'zdm-badge-video' };
    if (fmt && fmt.hasAudio) return { text: 'A', cls: 'zdm-badge-audio' };
    if (badge && badge.text) {
      const text = String(badge.text);
      const cls = /V\s*\+\s*A/i.test(text) ? 'zdm-badge-muxed' : (/^A$/i.test(text) ? 'zdm-badge-audio' : 'zdm-badge-video');
      return { text, cls };
    }
    return null;
  }

  function makePicker(formats, onToggle) {
    const root = document.createElement('div');
    root.className = 'zdm-picker';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zdm-picker-btn';
    const list = document.createElement('div');
    list.className = 'zdm-picker-list';
    list.hidden = true;
    list.addEventListener('mousedown', (e) => e.stopPropagation());
    list.addEventListener('pointerdown', (e) => e.stopPropagation());
    let index = 0;

    function row(fmt) {
      const line = document.createElement('span');
      line.className = 'zdm-picker-line';
      const label = document.createElement('span');
      label.className = 'zdm-picker-label';
      label.textContent = formatOptionLabel(fmt);
      line.appendChild(label);
      const mark = markFor(fmt);
      if (mark) {
        const badge = document.createElement('span');
        badge.className = `zdm-quality-badge ${mark.cls}`;
        badge.textContent = mark.text;
        const paint = mark.cls === 'zdm-badge-audio'
          ? ['#00e676', 'rgba(0, 230, 118, 0.2)']
          : (mark.cls === 'zdm-badge-muxed' ? ['#ffab40', 'rgba(255, 171, 64, 0.2)'] : ['#00d4ff', 'rgba(0, 212, 255, 0.2)']);
        badge.style.setProperty('color', paint[0], 'important');
        badge.style.setProperty('background', paint[1], 'important');
        line.appendChild(badge);
      }
      return line;
    }

    function paint() {
      button.replaceChildren(row(formats[index]));
    }

    formats.forEach((fmt, i) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'zdm-picker-opt';
      option.appendChild(row(fmt));
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        index = i;
        list.hidden = true;
        list.style.right = '';
        list.style.left = '';
        paint();
        if (typeof onToggle === 'function') onToggle(list, false);
        root.dispatchEvent(new Event('change'));
      });
      list.appendChild(option);
    });

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (list.hidden) {
        list.classList.remove('zdm-drop-up');
        list.hidden = false;
        const rect = list.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
          list.classList.add('zdm-drop-up');
        }
        if (rect.left < 8) {
          list.style.right = 'auto';
          list.style.left = '0';
        } else {
          list.style.right = '0';
          list.style.left = 'auto';
        }
        if (typeof onToggle === 'function') onToggle(list, true);
      } else {
        list.hidden = true;
        list.style.right = '';
        list.style.left = '';
        if (typeof onToggle === 'function') onToggle(list, false);
      }
    });
    paint();
    root.appendChild(button);
    root.appendChild(list);
    root.buttonEl = button;
    root.listEl = list;
    root.valueIndex = () => index;
    return root;
  }

  function requestDownload(entry, fmt, backendTitle, audioFmt) {
    const title = (entry.identity && entry.identity.title) || backendTitle || (entry.video ? displayTitle(entry.video) : '') || entry.pageTitle || docTitle();
    const pairedAudio = audioFmt && audioFmt.url && audioFmt.url !== fmt.url
      ? audioFmt.url
      : (fmt.audioUrl && fmt.audioUrl !== fmt.url ? fmt.audioUrl : null);
    send({
      type: 'download',
      zdmId: entry.id,
      url: fmt.url,
      audioUrl: pairedAudio,
      formatId: fmt.formatId || '',
      audioFormatId: audioFmt && audioFmt.formatId || '',
      quality: fmt.quality,
      ext: fmt.transcript ? (fmt.ext || 'vtt') : ((!audioFmt && fmt.hasAudio && !fmt.hasVideo) ? (fmt.ext || 'mp3') : fmt.ext),
      audioOnly: !fmt.transcript && !audioFmt && !!(fmt.hasAudio && !fmt.hasVideo),
      transcript: !!fmt.transcript,
      filesize: fmt.filesize || 0,
      audioFilesize: audioFmt && audioFmt.filesize ? audioFmt.filesize : 0,
      pageUrl: (entry.identity && entry.identity.url) || entry.pageUrl || (entry.video ? (postUrlFor(entry.video) || pageUrlFor(entry.video)) : ''),
      pageTitle: title,
      cookieHosts: entry.cookieHosts || [],
      id: isTikTok() && entry.video ? tiktokPayload(entry.video).id : '',
      bodies: isTikTok() && entry.video ? tiktokPayload(entry.video).bodies : [],
      duration: Number(fmt.duration) || 0,
      userAgent: entry.userAgent || navigator.userAgent,
    });
    entry.menu.classList.remove('zdm-menu-open');
    if (entry.btn) {
      setButtonState(entry.btn, 'downloading');
    }
  }


  function fileExt(url) {
    const match = String(url || '').match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
    return match ? match[1].toLowerCase() : '';
  }

  function absUrl(raw) {
    try { return new URL(raw, location.href).href; } catch { return raw || ''; }
  }

  function isAudioAnchor(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'AUDIO') return true;
    if (!el.getAttribute) return false;
    if (el.getAttribute('data-zdm-audio-url') || el.getAttribute('data-zdm-audio') || el.getAttribute('data-audio-player-preview-url-value')) return true;
    if (el.tagName === 'VIDEO') return AUDIO_EXT.test(fileExt(mediaSrc(el)));
    return false;
  }

  function mediaSrc(el) {
    if (!el) return '';
    const marked = el.getAttribute && el.getAttribute('data-zdm-audio-url');
    if (marked) return absUrl(marked);
    const preview = el.getAttribute && el.getAttribute('data-audio-player-preview-url-value');
    if (preview) return absUrl(preview);
    let live = el.currentSrc || el.src || '';
    if ((!live || live.startsWith('blob:') || live.startsWith('data:')) && el.querySelector) {
      const source = el.querySelector('source[src]');
      if (source) live = source.src || source.getAttribute('src') || '';
    }
    if (!live || live.startsWith('blob:') || live.startsWith('data:')) return '';
    return absUrl(live);
  }

  function audioExt(url, mime) {
    const ext = fileExt(url);
    if (AUDIO_EXT.test(ext)) return ext;
    const type = String(mime || '').toLowerCase();
    if (/mpeg|mp3/.test(type)) return 'mp3';
    if (/mp4|m4a|aac/.test(type)) return 'm4a';
    if (/wav/.test(type)) return 'wav';
    if (/flac/.test(type)) return 'flac';
    if (/opus/.test(type)) return 'opus';
    if (/ogg/.test(type)) return 'ogg';
    if (/webm/.test(type)) return 'webm';
    return ext || 'mp3';
  }

  function ownAudioFormat(el) {
    if (!isAudioAnchor(el)) return null;
    const url = mediaSrc(el);
    if (!url) return null;
    const ext = fileExt(url);
    const marked = el.getAttribute && (el.getAttribute('data-zdm-audio-url') || el.getAttribute('data-audio-player-preview-url-value'));
    const typed = el.getAttribute && el.getAttribute('data-zdm-audio-type');
    if (el.tagName !== 'AUDIO' && el.tagName !== 'VIDEO' && !AUDIO_EXT.test(ext) && !marked) return null;
    return {
      url,
      quality: '',
      ext: AUDIO_EXT.test(ext) ? ext : (typed || audioExt(url, '')),
      hasVideo: false,
      hasAudio: true,
      filesize: Number(el.getAttribute && el.getAttribute('data-zdm-audio-size')) || 0,
      direct: true,
    };
  }

  function sameMediaUrl(left, right) {
    if (!left || !right) return false;
    try {
      const a = new URL(left, location.href);
      const b = new URL(right, location.href);
      a.hash = '';
      b.hash = '';
      return a.href === b.href;
    } catch {
      return left === right;
    }
  }

  function gestureBox(el) {
    if (!el || !el.closest || el.closest('video')) return null;
    let node = el;
    let best = null;
    const viewW = window.innerWidth || 1;
    for (let i = 0; i < 8 && node && node !== document.body && node !== document.documentElement; i++) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 48 && rect.height >= 18 && rect.height <= 240 && rect.width <= viewW * 0.98) best = node;
      if (rect.height > 320 && rect.width > viewW * 0.9) break;
      node = node.parentElement;
    }
    return best;
  }

  function entryFor(el) {
    const raw = el && el.getAttribute && el.getAttribute('__zdm_id__');
    if (!raw) return null;
    return tracked.get(parseInt(raw, 10)) || null;
  }

  function sameAudioGroup(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.contains && a.contains(b)) return true;
    if (b.contains && b.contains(a)) return true;
    return false;
  }

  function visibleEnough(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 48 && rect.height >= 18;
  }

  function playerSized(el) {
    if (!visibleEnough(el)) return false;
    const rect = el.getBoundingClientRect();
    const viewW = window.innerWidth || 1;
    return rect.height <= 240 && rect.width <= viewW * 0.98;
  }

  function bindAudio(el, url, filesize, title, mime) {
    if (!pageOn || !el || !url || String(url).startsWith('blob:') || String(url).startsWith('data:')) return;
    let host = playerSized(el) ? el : (gestureBox(el) || null);
    if (!host) return;
    for (const entry of tracked.values()) {
      if (!entry.pinned || !entry.video) continue;
      if (!sameAudioGroup(entry.video, host)) continue;
      const existingUrl = entry.video.getAttribute && entry.video.getAttribute('data-zdm-audio-url');
      if (existingUrl && existingUrl !== url && entry.video !== host) continue;
      host = entry.video;
      break;
    }
    host.setAttribute('data-zdm-audio-url', url);
    host.setAttribute('data-zdm-audio-type', audioExt(url, mime));
    if (filesize) host.setAttribute('data-zdm-audio-size', String(filesize));
    const name = bestTitle(host, url, title);
    if (name) host.setAttribute('data-zdm-audio-title', name);
    let entry = entryFor(host);
    if (!entry) entry = createOverlay(host);
    if (!entry) return;
    entry.pinned = true;
    if (name) entry.pageTitle = name;
    showPinned(entry);
    if (entry.menu && entry.menu.classList.contains('zdm-menu-open')) {
      buildQualityMenu(entry, pageFormatsFor(host), entry.pageTitle || name || '');
    }
  }

  function findAudiosByUrl(url) {
    const found = [];
    const nodes = document.querySelectorAll('audio, video, source');
    for (const node of nodes) {
      const src = node.currentSrc || node.src || node.getAttribute('src') || '';
      if (!src || src.startsWith('blob:') || src.startsWith('data:')) continue;
      if (!sameMediaUrl(src, url)) continue;
      const host = node.tagName === 'SOURCE' ? (node.closest('audio, video') || node.parentElement) : node;
      if (!host || found.indexOf(host) !== -1) continue;
      if (host.tagName === 'VIDEO' && !AUDIO_EXT.test(fileExt(url))) continue;
      if (!visibleEnough(host)) continue;
      found.push(host);
    }
    return found;
  }

  function takePlayedAudio(data) {
    if (!data) return;
    let el = null;
    try {
      el = data.id ? document.querySelector('[data-zdm-audio="' + CSS.escape(String(data.id)) + '"]') : null;
    } catch { el = null; }
    const url = data.url && !String(data.url).startsWith('blob:') ? String(data.url) : '';
    if (el && url) {
      bindAudio(el, url, 0, '', '');
      return;
    }
    if (el && lastSniffed && Date.now() - lastSniffed.time < 20000) {
      bindAudio(el, lastSniffed.url, lastSniffed.filesize, lastSniffed.title, lastSniffed.mime);
      return;
    }
    if (el) pendingAudio = { el, time: Date.now() };
    const item = newestUnboundAudio();
    if (el && item) {
      bindAudio(el, item.url, item.filesize, item.title, item.mime);
      return;
    }
    if (url) takeAudioUrl(url, 0, '', '', location.href);
  }

  function rememberAudio(url, filesize, mime, title) {
    if (!url || String(url).startsWith('blob:')) return;
    const item = { url, filesize: Number(filesize) || 0, mime: mime || '', title: title || '', time: Date.now() };
    const known = recentAudio.find((entry) => entry.url === url);
    if (known) {
      known.time = item.time;
      if (item.filesize) known.filesize = item.filesize;
      if (item.title) known.title = item.title;
      if (item.mime) known.mime = item.mime;
    } else {
      recentAudio.push(item);
      if (recentAudio.length > 8) recentAudio.shift();
    }
    lastSniffed = known || item;
  }

  function audioAlreadyShown(url, forHost) {
    for (const entry of tracked.values()) {
      if (!entry.pinned || !entry.video) continue;
      if (forHost && entry.video === forHost) return false;
      const bound = entry.video.getAttribute && entry.video.getAttribute('data-zdm-audio-url');
      if (bound && sameMediaUrl(bound, url)) return true;
    }
    return false;
  }

  function newestUnboundAudio() {
    const now = Date.now();
    for (let i = recentAudio.length - 1; i >= 0; i--) {
      const item = recentAudio[i];
      if (now - item.time > 20000) continue;
      if (audioAlreadyShown(item.url)) continue;
      return item;
    }
    return null;
  }

  function takeAudioUrl(url, filesize, mime, title, pageUrl) {
    if (!url || String(url).startsWith('blob:')) return;
    if (location.hostname.includes('youtube.com')) return;
    if (pageUrl) {
      try {
        const there = new URL(pageUrl, location.href);
        if (there.origin !== location.origin) return;
      } catch {
        return;
      }
    }
    rememberAudio(url, filesize, mime, title);
    const direct = findAudiosByUrl(url);
    if (direct.length) {
      for (const node of direct) bindAudio(node, url, filesize, title, mime);
      return;
    }
    if (pendingAudio && pendingAudio.el && document.contains(pendingAudio.el) && Date.now() - pendingAudio.time < 8000) {
      bindAudio(pendingAudio.el, url, filesize, title, mime);
      pendingAudio = null;
      return;
    }
    if (!lastGesture || !lastGesture.el || !document.contains(lastGesture.el) || Date.now() - lastGesture.time > 8000) return;
    if (lastGesture.el.closest && lastGesture.el.closest('video, .html5-video-player, #movie_player, ytd-player, .jwplayer, .plyr, .video-js')) return;
    const box = gestureBox(lastGesture.el);
    if (box) bindAudio(box, url, filesize, title, mime);
  }

  function audioUrlFromValue(value) {
    if (!value || value.length < 8 || value.length > 4000) return '';
    const text = String(value);
    if (text.indexOf('http') === -1 && text.charAt(0) !== '/' && !/\.(mp3|m4a|aac|wav|flac|opus|ogg|oga|weba|wma|mpga)/i.test(text)) return '';
    const match = text.match(/https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+|\/[^\s"'<>]+\.(?:mp3|m4a|aac|wav|flac|opus|oga|ogg|weba|wma|mpga)(?:[?#][^\s"'<>]*)?/i);
    if (!match) return '';
    let raw = match[0].replace(/[),.;]+$/, '');
    if (raw.indexOf('//') === 0) raw = 'https:' + raw;
    const url = absUrl(raw);
    if (!url || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return '';
    if (!AUDIO_EXT.test(fileExt(url))) return '';
    return url;
  }

  function harvestElement(el) {
    if (!pageOn || !el || el.nodeType !== 1 || !el.attributes) return;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'VIDEO' || tag === 'LINK' || tag === 'META' || tag === 'IMG') return;
    if (el.closest && el.closest('.zdm-root, .zdm-overlay')) return;
    let url = '';
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name || '';
      if (name.indexOf('data-zdm-') === 0 || name === 'class' || name === 'style') continue;
      const found = audioUrlFromValue(attrs[i].value);
      if (!found) continue;
      url = found;
      if (fileExt(found) === 'mp3' || fileExt(found) === 'm4a' || fileExt(found) === 'wav' || fileExt(found) === 'flac') break;
    }
    if (!url) return;
    const host = playerSized(el) ? el : gestureBox(el);
    if (!host || audioAlreadyShown(url, host)) return;
    const title = el.getAttribute('data-title') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    bindAudio(host, url, 0, title, '');
  }

  function harvestAudio(root, force) {
    if (!pageOn || !root) return;
    const whole = root === document || root === document.documentElement || root === document.body;
    const now = Date.now();
    if (whole && !force && now - lastHarvest < 2500) return;
    if (whole) lastHarvest = now;
    if (root.nodeType === 1) harvestElement(root);
    if (!root.querySelectorAll) return;
    const nodes = root.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i++) harvestElement(nodes[i]);
  }

  function cleanLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function bestTitle(el, url, hint) {
    const known = knownIdentity(el);
    if (known && known.title) return known.title;
    const marked = el && el.getAttribute && el.getAttribute('data-zdm-audio-title');
    return cleanLabel(marked) || cleanLabel(hint) || '';
  }

  function findTranscript(el) {
    if (!el || !el.querySelectorAll) return null;
    const tracks = el.querySelectorAll('track');
    for (const track of tracks) {
      const kind = (track.getAttribute('kind') || '').toLowerCase();
      if (kind && !/subtitle|caption/.test(kind)) continue;
      const src = track.src || track.getAttribute('src') || '';
      if (!src || src.startsWith('blob:')) continue;
      const url = absUrl(src);
      return { url, ext: fileExt(url) || 'vtt', lang: track.getAttribute('srclang') || '' };
    }
    const card = el.closest ? el.closest('article, .item-grid-card, figure, [data-player], .html5-video-player') : null;
    const root = card || el.parentElement;
    if (!root || !root.querySelectorAll) return null;
    for (const link of root.querySelectorAll('a[href]')) {
      const href = link.href || '';
      if (!/\.(vtt|srt|ttml)(\?|#|$)/i.test(href)) continue;
      return { url: href, ext: fileExt(href) || 'vtt', lang: '' };
    }
    return null;
  }

  function makeTranscriptButton(entry, transcript, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zdm-menu-btn';
    button.textContent = 'Transcript';
    button.title = 'Download transcript';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      requestDownload(entry, {
        url: transcript.url,
        quality: '',
        ext: transcript.ext || 'vtt',
        hasVideo: false,
        hasAudio: false,
        filesize: 0,
        transcript: true,
      }, title, null);
    });
    return button;
  }

  function makeActionRow(entry, title, transcript, showAudioOnly, onDownload) {
    const actions = document.createElement('div');
    actions.className = 'zdm-menu-actions';
    if (transcript && showAudioOnly) actions.classList.add('is-crowded');
    if (transcript) actions.appendChild(makeTranscriptButton(entry, transcript, title));
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'zdm-menu-btn zdm-menu-btn-primary';
    download.textContent = 'Download';
    download.addEventListener('click', (e) => {
      e.stopPropagation();
      onDownload();
    });
    actions.appendChild(download);
    return actions;
  }

  function audioAnchorBox(el) {
    if (!isAudioAnchor(el)) return el;
    const wave = el.querySelector && el.querySelector('[data-test-id="audio-player-wave-wrapper"], .audio-player__wave-wrapper');
    if (wave) {
      const host = el.getBoundingClientRect();
      const box = wave.getBoundingClientRect();
      if (box.width >= 64 && box.height >= 24 && (host.height < 24 || box.height > host.height + 4)) return wave;
    }
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if ((rect.width < 64 || rect.height < 24) && el.tagName === 'AUDIO') {
      const box = gestureBox(el);
      if (box) return box;
    }
    return el;
  }

  function duplicateOnScreen(entry) {
    const url = entry.video && entry.video.getAttribute && entry.video.getAttribute('data-zdm-audio-url');
    if (!url) return false;
    const viewH = window.innerHeight || 0;
    const viewW = window.innerWidth || 0;

    for (const other of tracked.values()) {
      if (other === entry || !other.pinned || !other.video) continue;
      if (other.video.getAttribute('data-zdm-audio-url') !== url) continue;

      const oRect = (other.pinned ? audioAnchorBox(other.video) : other.video).getBoundingClientRect();
      const onScreenNow = oRect.bottom > 16 && oRect.top < viewH - 16 && oRect.right > 16 && oRect.left < viewW - 16;
      if (!onScreenNow) continue;

      if (other.visible || other.id < entry.id) {
        return true;
      }
    }
    return false;
  }

  function showPinned(entry) {
    if (!entry) return;
    updatePosition(entry);
  }

  function findScrollParent(node) {
    if (!node) return null;
    let parent = node.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      try {
        const style = window.getComputedStyle(parent);
        const oy = style.overflowY;
        const ox = style.overflowX;
        if (oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll') {
          return parent;
        }
      } catch {}
      parent = parent.parentElement;
    }
    return null;
  }

  function entryScrollParent(entry) {
    if (entry._scrollParent !== undefined) {
      if (entry._scrollParent && !document.contains(entry._scrollParent)) {
        entry._scrollParent = undefined;
      } else {
        return entry._scrollParent;
      }
    }
    const target = (entry.pinned ? audioAnchorBox(entry.video) : entry.video);
    entry._scrollParent = findScrollParent(target);
    return entry._scrollParent;
  }

  function getEffectiveZIndex(node) {
    let curr = node;
    let maxZ = 0;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      try {
        const style = window.getComputedStyle(curr);
        const z = parseInt(style.zIndex, 10);
        if (!isNaN(z) && z > maxZ && z < 2000000000) {
          maxZ = z;
        }
      } catch {}
      curr = curr.parentElement;
    }
    return maxZ;
  }

  function engagedVideo(video) {
    if (!video) return false;
    if (!video.paused || dedicatedPlayer(video)) return true;
    return video.readyState >= 1 && video.currentTime > 0.15;
  }

  function heldInView(video) {
    if (!video) return false;
    if (dedicatedPlayer(video)) return true;
    const focus = viewFocus(video);
    if (focus.centerIn) return true;
    const rect = video.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    const visibleH = Math.max(0, Math.min(rect.bottom, viewH) - Math.max(rect.top, 0));
    return viewH > 0 && visibleH >= viewH * 0.62;
  }

  function viewFocus(video) {
    const rect = video.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    const viewW = window.innerWidth || 0;
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewH);
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, viewW);
    const visibleH = Math.max(0, bottom - top);
    const visibleW = Math.max(0, right - left);
    const center = rect.top + rect.height / 2;
    return {
      area: visibleW * visibleH,
      centerIn: center >= 0 && center <= viewH,
      dist: Math.abs(center - viewH / 2),
    };
  }

  function betterFocus(a, b) {
    if (a.centerIn !== b.centerIn) {
      if (a.centerIn && a.area >= b.area * 0.45) return true;
      if (b.centerIn && b.area >= a.area * 0.45) return false;
    }
    if (a.area > b.area * 1.08) return true;
    if (b.area > a.area * 1.08) return false;
    return a.dist < b.dist;
  }

  function shouldPrefer(next, current) {
    if (!current || !current.video || !document.contains(current.video)) return true;
    if (!onScreen(current.video) || videoCovered(current.video)) return true;
    const a = viewFocus(next.video);
    const b = viewFocus(current.video);
    if (a.centerIn && !b.centerIn && a.area >= b.area * 0.5) return true;
    if (!a.centerIn && b.centerIn) return false;
    if (a.dist < b.dist - 20) return true;
    if (b.dist < a.dist - 20) return false;
    return a.area > b.area;
  }

  function focusedEntry() {
    let best = null;
    let bestScore = null;
    for (const other of tracked.values()) {
      if (other.pinned || !document.contains(other.video)) continue;
      if (videoCovered(other.video)) continue;
      if (!heldInView(other.video)) continue;
      if (!onScreen(other.video) && !viewFocus(other.video).centerIn) continue;
      const score = viewFocus(other.video);
      if (score.area < 1) continue;
      if (!best || betterFocus(score, bestScore)) {
        best = other;
        bestScore = score;
      }
    }
    return best;
  }

  function collectMedia(root, out, seen) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    if (!root.querySelectorAll) return;
    let list = [];
    try { list = root.querySelectorAll('video, audio, [data-audio-player-preview-url-value], [data-zdm-audio-url]'); } catch { list = []; }
    for (const el of list) out.push(el);
  }

  const storyFetchAsked = new Map();
  let fbVisibleShare = '';

  function storyCacheKey(view, index) {
    const token = (view && view.tokens && view.tokens.length === view.count && view.tokens[index]) || (view && index === view.index ? view.token : '') || '';
    return (view && view.owner || '') + '|' + index + '|' + token;
  }

  function askStoryRows(view, index) {
    if (!view || (!view.owner && !view.token)) return;
    const key = storyCacheKey(view, index);
    if (appStoryRows.has(key)) return;
    const mark = 'resolve:' + key;
    const prev = storyFetchAsked.get(mark);
    if (prev && Date.now() - prev.at < 1500) return;
    storyFetchAsked.set(mark, { at: Date.now(), n: prev ? prev.n + 1 : 1 });
    const requestId = ++threadsCaptureSeq;
    const token = index === view.index ? view.token : ((view.tokens && view.tokens[index]) || '');
    const site = isInstagram() ? 'instagram' : 'facebook';
    threadsCaptureWait.set(requestId, { kind: 'resolve', storyKey: key, site });
    const sent = send({
      type: 'capture-resolve',
      requestId,
      site,
      pageUrl: location.href,
      card: { links: [] },
      storyView: { site, owner: view.owner, token, index, count: view.count, tokens: view.tokens, pageUrl: location.href },
      settings: { qualityMode: qualitySettings.qualityMode, fpsDisplay: qualitySettings.fpsDisplay },
    });
    if (!sent) {
      threadsCaptureWait.delete(requestId);
      storyFetchAsked.delete(mark);
    }
  }

  function rowsForStoryIndex(view, index) {
    if (!view) return [];
    const key = storyCacheKey(view, index);
    const hit = appStoryRows.get(key);
    if (!hit) askStoryRows(view, index);
    return hit || [];
  }

  function mergeStoryRows(primary, extra) {
    const rows = [];
    const seen = new Set();
    const lists = [primary || [], extra || []];
    for (let n = 0; n < lists.length; n++) {
      for (const row of lists[n]) {
        if (!row || !row.url || seen.has(row.url)) continue;
        seen.add(row.url);
        rows.push(row);
      }
    }
    return rows;
  }

  function storyFill(bar) {
    if (!bar) return null;
    const nodes = bar.firstElementChild ? [bar.firstElementChild, bar] : [bar];
    for (const node of nodes) {
      const style = getComputedStyle(node);
      const inline = node.getAttribute('style') || '';
      if (style.transform && style.transform !== 'none') {
        const matrix = style.transform.match(/matrix\(([^)]+)\)/);
        if (matrix) {
          const scale = Number(matrix[1].split(',')[0]);
          if (Number.isFinite(scale)) return scale;
        }
      }
      const written = inline.match(/scaleX\(\s*([0-9.]+)\s*\)/i) || inline.match(/(?:^|;|\s)width:\s*([0-9.]+)%/i);
      if (written) return inline.indexOf('%') !== -1 && /width/i.test(written[0]) ? Number(written[1]) / 100 : Number(written[1]);
    }
    const inner = bar.firstElementChild;
    if (!inner) return null;
    const outer = bar.getBoundingClientRect().width || 1;
    const width = inner.getBoundingClientRect().width || 0;
    if (width <= 0) return 0;
    return width / outer;
  }

  function storyTicks(root) {
    if (!root || !root.querySelectorAll) return null;
    const host = root.getBoundingClientRect();
    const nodes = root.querySelectorAll('div');
    let best = null;
    for (let i = 0; i < nodes.length && i < 800; i++) {
      const node = nodes[i];
      const kids = node.children;
      if (!kids || kids.length < 1 || kids.length > 30) continue;
      let thin = true;
      for (let k = 0; k < kids.length; k++) {
        const rect = kids[k].getBoundingClientRect();
        if (rect.height <= 0 || rect.height > 8 || rect.width < 6) { thin = false; break; }
      }
      if (!thin) continue;
      const row = node.getBoundingClientRect();
      if (row.top > host.top + 90) continue;
      let index = -1;
      for (let k = 0; k < kids.length; k++) {
        const fill = storyFill(kids[k]);
        if (fill == null) continue;
        if (fill < 0.995) { index = k; break; }
        index = k;
      }
      if (index < 0) {
        const now = Number(node.getAttribute('aria-valuenow'));
        const max = Number(node.getAttribute('aria-valuemax'));
        if (Number.isFinite(now) && now >= 1 && (!Number.isFinite(max) || now <= max)) index = now - 1;
        else index = 0;
      }
      if (!best || kids.length > best.count) best = { count: kids.length, index };
    }
    return best;
  }

  function cleanStoryToken(value) {
    let raw = String(value || '');
    try { raw = decodeURIComponent(raw); } catch { /* already plain */ }
    return raw.replace(/=+$/, '');
  }

  function facebookStoryView() {
    const empty = { owner: '', name: '', token: '', tokens: [], count: 0, index: 0 };
    if (!isFacebook() || !isStoryPage()) return empty;
    const media = centeredStoryMedia();
    let root = media ? media.parentElement : null;
    let ticks = null;
    let scope = null;
    for (let i = 0; i < 16 && root && root !== document.body; i++) {
      const found = storyTicks(root);
      if (found && (!ticks || found.count > ticks.count)) {
        ticks = found;
        scope = root;
      }
      if (ticks && ticks.count >= 2) break;
      root = root.parentElement;
    }
    if (!scope) scope = document.body;
    const links = [];
    const seen = new Set();
    const anchors = scope.querySelectorAll ? scope.querySelectorAll('a[href*="/stories/"]') : [];
    for (const link of anchors) {
      const match = (link.href || '').match(/facebook\.com\/stories\/([^/?#]+)\/([^/?#]+)/i);
      if (!match) continue;
      const owner = match[1];
      const token = cleanStoryToken(match[2]);
      const key = owner + '/' + token;
      if (!token || seen.has(key)) continue;
      seen.add(key);
      links.push({ owner, token });
    }
    const bar = location.href.match(/facebook\.com\/stories\/([^/?#]+)\/([^/?#]+)/i);
    const owner = (bar && bar[1]) || (links[0] && links[0].owner) || '';
    const tokens = links.filter((link) => link.owner === owner).map((link) => link.token);
    const count = Math.max(ticks ? ticks.count : 0, tokens.length);
    let index = ticks ? ticks.index : 0;
    if (index < 0) index = 0;
    if (count && index >= count) index = count - 1;
    const token = (bar && bar[1] === owner && bar[2]) ? cleanStoryToken(bar[2]) : (tokens[index] || '');
    let name = '';
    const names = scope.querySelectorAll ? scope.querySelectorAll('a[href]') : [];
    const hostTop = scope.getBoundingClientRect ? scope.getBoundingClientRect().top : 0;
    for (const link of names) {
      const href = link.href || '';
      if (/\/stories\//i.test(href)) continue;
      const text = String(link.innerText || '').trim().split('\n')[0].trim();
      if (text.length < 2 || text.length > 60 || /^\d/.test(text)) continue;
      const top = link.getBoundingClientRect().top;
      if (top > hostTop + 140) continue;
      name = text;
      break;
    }
    return { owner, name, token, tokens, count: count || (token ? 1 : 0), index };
  }

  function askFacebookStory(token, ownerId) {
    const owner = String(ownerId || ((location.href.match(/facebook\.com\/stories\/([^/?#]+)/i) || [])[1] || '')).replace(/[^\w.-]/g, '');
    const card = cleanStoryToken(token);
    if (!owner || card.length < 8) return;
    const key = owner + '/' + card + '|' + (fbVisibleShare || '');
    const prev = storyFetchAsked.get(key);
    const now = Date.now();
    if (prev && (prev.n >= 2 || now - prev.at < 4000)) return;
    storyFetchAsked.set(key, { at: now, n: prev ? prev.n + 1 : 1 });
    const view = isStoryPage() ? facebookStoryView() : null;
    window.postMessage({
      source: 'zdm-fb-fetch-story',
      owner,
      token: card,
      shareUrl: fbVisibleShare,
      index: view ? view.index : -1,
    }, '*');
  }

  function usableMenu(menu) {
    return menu && Array.isArray(menu.choices) && menu.choices.length ? menu : null;
  }

  function menuFormat(row) {
    const fmt = Object.assign({}, (row && row.format) || {});
    if (row && row.label) fmt.label = row.label;
    if (row && row.badge) fmt.badge = row.badge;
    return fmt;
  }

  function buildQualityMenu(entry, formats, backendTitle = '', readyMenu = null) {
    const menu = entry.menu;
    if (menu.querySelector('.zdm-picker-list:not([hidden])')) {
      entry.pendingPaint = { formats, backendTitle, readyMenu };
      return;
    }
    entry.pendingPaint = null;
    menu.replaceChildren();
    const resolvedTitle = entry.identity && entry.identity.title ? entry.identity.title : '';
    const heard = resolvedTitle ? '' : (entry.pinned && entry.video ? bestTitle(entry.video, mediaSrc(entry.video), backendTitle || entry.pageTitle) : '');
    const localTitle = resolvedTitle || (entry.video ? displayTitle(entry.video) : '');
    const namedSite = !!(entry.video && (isX() || isThreads() || /instagram\.com/i.test(location.hostname)));
    let backend = backendTitle || '';
    if (namedSite && (localTitle || genericPageTitle(backend))) backend = '';
    let pageFallback = entry.pageTitle || '';
    if (genericPageTitle(pageFallback)) pageFallback = '';
    let docFallback = docTitle();
    if (genericPageTitle(docFallback)) docFallback = '';
    const title = heard || localTitle || backend || pageFallback || docFallback || 'Video';
    if (heard || localTitle) entry.pageTitle = heard || localTitle;

    const titleEl = document.createElement('div');
    titleEl.className = 'zdm-menu-title';
    titleEl.textContent = title;
    titleEl.title = title;
    menu.appendChild(titleEl);

    if (isFacebook() && isStoryPage()) {
      const view = facebookStoryView();
      if (view.count > 0) {
        const who = document.createElement('div');
        who.className = 'zdm-story-who';
        who.textContent = (view.name ? view.name + ' · ' : '') + (view.index + 1) + '/' + view.count;
        menu.appendChild(who);
      }
      const currentToken = view.token;
      const playing = formats;
      const here = view.owner + ':' + view.index + ':' + currentToken;
      if (entry.fbStoryHere !== here) {
        entry.fbStoryHere = here;
        entry.fbStoryIndex = view.index;
      }
      askFacebookStory(currentToken, view.owner);
      const bar = location.href.match(/facebook\.com\/stories\/([^/?#]+)\/([^/?#]+)/i);
      if (bar) askFacebookStory(cleanStoryToken(bar[2]), bar[1]);
      if (view.count > 1) {
        let picked = Number.isInteger(entry.fbStoryIndex) ? entry.fbStoryIndex : view.index;
        if (picked < 0 || picked >= view.count) picked = view.index;
        const strip = document.createElement('div');
        strip.className = 'zdm-story-row';
        for (let i = 0; i < view.count; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'zdm-story-chip' + (i === picked ? ' is-on' : '');
          btn.textContent = String(i + 1);
          btn.title = i === view.index ? 'Current story' : 'Story ' + (i + 1);
          btn.addEventListener('click', (event) => {
            event.stopPropagation();
            entry.fbStoryIndex = i;
            const rows = rowsForStoryIndex(view, i);
            if (!rows.length) {
              const token = view.tokens.length === view.count ? view.tokens[i] : (i === view.index ? view.token : '');
              if (token) askFacebookStory(token, view.owner);
            }
            buildQualityMenu(entry, i === view.index ? mergeStoryRows(rows, playing) : rows, backendTitle);
          });
          strip.appendChild(btn);
        }
        menu.appendChild(strip);
        if (picked !== view.index) formats = rowsForStoryIndex(view, picked);
      }
    }

    const domTranscript = entry.video ? findTranscript(entry.video) : null;
    if (domTranscript && domTranscript.url) entry.transcript = domTranscript;
    const pageTranscript = entry.transcript && entry.transcript.url ? entry.transcript : null;

    if (!formats || !formats.length) {
      const src = entry.video ? (mediaSrc(entry.video) || entry.video.currentSrc || entry.video.src) : '';
      if (src && !src.startsWith('blob:')) {
        menu.appendChild(makeActionRow(entry, title, pageTranscript, false, () => {
          requestDownload(entry, { url: src, quality: '', ext: fileExt(src), hasAudio: true, hasVideo: false, filesize: 0 }, title, null);
        }));
      } else if (pageTranscript) {
        const actions = document.createElement('div');
        actions.className = 'zdm-menu-actions';
        actions.appendChild(makeTranscriptButton(entry, pageTranscript, title));
        menu.appendChild(actions);
      } else {
        const empty = document.createElement('div');
        empty.className = 'zdm-menu-header';
        empty.textContent = 'No downloadable formats found';
        menu.appendChild(empty);
      }
      return;
    }

    function audioDefaultTier(fmt) {
      if (!fmt) return 0;
      const text = `${fmt.note || ''} ${fmt.quality || ''} ${fmt.label || ''}`;
      if (fmt.defaultAudio || fmt.isDefault || fmt.default || Number(fmt.language_preference) > 0 || /\bdefault\b/i.test(text)) return 2;
      if (/\boriginal\b/i.test(text)) return 1;
      return 0;
    }

    function putDefaultAudioFirst(list) {
      if (!list || list.length < 2) return list || [];
      let best = -1;
      let bestScore = 0;
      list.forEach((fmt, i) => {
        const tier = audioDefaultTier(fmt);
        if (!tier) return;
        const rate = Number(fmt.bitrate) || 0;
        const size = Number(fmt.filesize) || 0;
        const score = tier * 1e12 + rate * 1e6 + size;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best <= 0) return list;
      const next = list.slice();
      next.unshift(next.splice(best, 1)[0]);
      return next;
    }

    function pickBestDefaultAudio(list) {
      const ordered = putDefaultAudioFirst(list);
      return ordered[0] || null;
    }

    const ready = usableMenu(readyMenu);
    let videoFormats;
    let audioFormats;
    let shownVideo;
    let shownAudio;
    let choices;
    if (ready) {
      shownVideo = (Array.isArray(ready.video) ? ready.video : []).map(menuFormat);
      shownAudio = putDefaultAudioFirst((Array.isArray(ready.audio) ? ready.audio : []).map(menuFormat));
      choices = ready.choices.map(menuFormat);
      videoFormats = shownVideo;
      audioFormats = shownAudio;
    } else {
      videoFormats = formats.filter((fmt) => fmt && fmt.hasVideo);
      audioFormats = putDefaultAudioFirst(formats.filter((fmt) => fmt && fmt.hasAudio && !fmt.hasVideo));
      shownVideo = videoFormats;
      shownAudio = audioFormats;
      choices = shownVideo.length ? shownVideo : shownAudio;
    }
    const knownSizes = rememberSized(entry, [shownVideo, shownAudio, choices, formats]);
    shownVideo = shownVideo.map((fmt) => applyKnownSize(fmt, knownSizes));
    shownAudio = shownAudio.map((fmt) => applyKnownSize(fmt, knownSizes));
    choices = choices.map((fmt) => applyKnownSize(fmt, knownSizes));
    videoFormats = shownVideo;
    audioFormats = shownAudio;

    let qualitySelect = null;
    let audioSelect = null;

    function updateMultiPickerLayout() {
      if (!qualitySelect || !audioSelect) return;
      const videoList = qualitySelect.listEl;
      const audioList = audioSelect.listEl;
      if (!videoList || !audioList) return;
      const videoOpen = !videoList.hidden;
      const audioOpen = !audioList.hidden;

      if (videoOpen && audioOpen) {
        const videoWidth = Math.max(videoList.offsetWidth || 0, qualitySelect.offsetWidth || 0);
        const shift = (videoWidth || 300) + 8;
        audioList.style.right = shift + 'px';
        audioList.style.left = 'auto';

        const rect = audioList.getBoundingClientRect();
        if (rect.left < 8) {
          const overflow = 8 - rect.left;
          audioList.style.right = Math.max(0, shift - overflow) + 'px';
        }
      } else {
        if (!audioOpen) {
          audioList.style.right = '';
          audioList.style.left = '';
        } else {
          audioList.style.right = '0';
          audioList.style.left = 'auto';
        }
        if (videoOpen) {
          videoList.style.right = '0';
          videoList.style.left = 'auto';
        }
      }
    }

    function flushPendingPaint() {
      const job = entry.pendingPaint;
      if (!job || menu.querySelector('.zdm-picker-list:not([hidden])')) return;
      entry.pendingPaint = null;
      buildQualityMenu(entry, job.formats, job.backendTitle, job.readyMenu);
    }

    const qualityRow = document.createElement('div');
    qualityRow.className = 'zdm-menu-row';
    const qualityName = document.createElement('span');
    qualityName.textContent = videoFormats.length ? 'Video quality' : 'Audio';
    qualitySelect = makePicker(choices, (_list, open) => {
      updateMultiPickerLayout();
      if (!open) flushPendingPaint();
    });
    qualityRow.appendChild(qualityName);
    qualityRow.appendChild(qualitySelect);

    const audioRow = document.createElement('div');
    audioRow.className = 'zdm-menu-row';
    const audioName = document.createElement('span');
    audioName.textContent = 'Audio track';
    audioSelect = shownAudio.length ? makePicker(shownAudio, (_list, open) => {
      updateMultiPickerLayout();
      if (!open) flushPendingPaint();
    }) : null;
    audioRow.appendChild(audioName);
    if (audioSelect) audioRow.appendChild(audioSelect);

    function selectedVideo() {
      return choices[qualitySelect.valueIndex()] || choices[0];
    }

    function syncAudioRow() {
      const fmt = selectedVideo();
      const q = fmt && fmt.hasVideo !== false ? (fmt.label || fmt.quality || '') : '';
      const shown = q && !/^video$/i.test(q) ? `${title} · ${q}` : title;
      titleEl.textContent = shown;
      titleEl.title = shown;
      const separate = !!(fmt && fmt.hasVideo && !fmt.hasAudio && audioFormats.length);
      if (qualitySettings.qualityMode === 'simple') {
        audioRow.hidden = true;
      } else {
        audioRow.hidden = !separate;
      }
      if ((audioRow.hidden || !separate) && audioSelect && audioSelect.listEl) {
        audioSelect.listEl.hidden = true;
        updateMultiPickerLayout();
      }
      updateTotalSize();
    }

    const actions = document.createElement('div');
    actions.className = 'zdm-menu-actions';
    const hasVideoChoices = shownVideo.length > 0;

    const audioOnly = document.createElement('button');
    audioOnly.type = 'button';
    audioOnly.className = 'zdm-menu-btn';
    audioOnly.textContent = 'Audio only';
    const muxedAudio = videoFormats.some((fmt) => fmt.hasAudio);
    audioOnly.hidden = !hasVideoChoices || (!audioFormats.length && !muxedAudio);
    audioOnly.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audioFormats.length) {
        let fmt = null;
        if (qualitySettings.qualityMode === 'simple') {
          fmt = pickBestDefaultAudio(audioFormats);
        } else {
          fmt = shownAudio[audioSelect ? audioSelect.valueIndex() : 0] || shownAudio[0];
        }
        if (fmt) requestDownload(entry, fmt, title, null);
        return;
      }
      const fmt = selectedVideo();
      if (!fmt) return;
      requestDownload(entry, Object.assign({}, fmt, { hasVideo: false, hasAudio: true, ext: 'm4a' }), title, null);
    });

    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'zdm-menu-btn zdm-menu-btn-primary';
    download.textContent = 'Download';
    download.addEventListener('click', (e) => {
      e.stopPropagation();
      const fmt = selectedVideo();
      if (!fmt) return;
      const needsAudio = fmt.hasVideo && !fmt.hasAudio;
      let audioFmt = null;
      if (needsAudio) {
        if (qualitySettings.qualityMode === 'simple') {
          audioFmt = pickBestDefaultAudio(audioFormats);
        } else {
          audioFmt = shownAudio[audioSelect ? audioSelect.valueIndex() : 0] || shownAudio[0];
        }
      }
      requestDownload(entry, fmt, title, audioFmt);
    });

    const transcriptBtn = pageTranscript ? makeTranscriptButton(entry, pageTranscript, title) : null;
    if (!audioOnly.hidden) actions.appendChild(audioOnly);
    if (transcriptBtn) actions.appendChild(transcriptBtn);
    actions.appendChild(download);
    if (transcriptBtn && !audioOnly.hidden) actions.classList.add('is-crowded');
    menu.appendChild(actions);

    const pair = document.createElement('div');
    pair.className = 'zdm-menu-pair';
    pair.appendChild(qualityRow);
    pair.appendChild(audioRow);
    menu.appendChild(pair);

    const totalRow = document.createElement('div');
    totalRow.className = 'zdm-total-size';
    const totalLabel = document.createElement('span');
    totalLabel.textContent = 'Total size';
    const totalValue = document.createElement('strong');
    totalRow.appendChild(totalLabel);
    totalRow.appendChild(totalValue);
    menu.appendChild(totalRow);

    function updateTotalSize() {
      const vFmt = selectedVideo();
      let total = vFmt ? (vFmt.filesize || 0) : 0;
      if (vFmt && vFmt.hasVideo && !vFmt.hasAudio && audioFormats.length) {
        let aFmt = null;
        if (qualitySettings.qualityMode === 'simple') {
          aFmt = pickBestDefaultAudio(audioFormats);
        } else {
          aFmt = shownAudio[audioSelect ? audioSelect.valueIndex() : 0] || shownAudio[0];
        }
        total += aFmt ? (aFmt.filesize || 0) : 0;
      }
      totalValue.textContent = total ? formatSize(total) : '—';
    }

    qualitySelect.addEventListener('change', syncAudioRow);
    if (audioSelect) audioSelect.addEventListener('change', updateTotalSize);
    syncAudioRow();
    if (!hasVideoChoices && choices.length <= 1) {
      pair.remove();
      totalRow.remove();
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function hideEntry(entry) {
    entry.overlay.classList.remove('zdm-visible');
    entry.overlay.style.visibility = 'hidden';
    entry.visible = false;
    entry.menu.classList.remove('zdm-menu-open');
    if (entry.framed) tellParent(entry, 'hide');
  }

  function onScreen(video) {
    const rect = video.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    const viewW = window.innerWidth || 0;
    const visibleH = Math.min(rect.bottom, viewH) - Math.max(rect.top, 0);
    const visibleW = Math.min(rect.right, viewW) - Math.max(rect.left, 0);
    return rect.width >= MIN_VIDEO_SIZE && rect.height >= MIN_VIDEO_SIZE
      && visibleW >= MIN_VIDEO_SIZE
      && visibleH >= Math.min(rect.height, viewH) * 0.35;
  }

  function isExtensionUi(el) {
    return !!(el && el.closest && el.closest('.zdm-overlay'));
  }

  function tightPlayer(video) {
    const vr = video.getBoundingClientRect();
    let best = video;
    let node = video.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body && node !== document.documentElement; i++) {
      const r = node.getBoundingClientRect();
      const dw = r.width - vr.width;
      const dh = r.height - vr.height;
      if (dw < -8 || dh < -8 || dw > 140 || dh > 240) break;
      best = node;
      node = node.parentElement;
    }
    return best;
  }

  function playerBox(video) {
    if (isAudioAnchor(video)) return audioAnchorBox(video);
    const mark = '.jwplayer, #vplayer, .video-js, .plyr, .plyr__video-wrapper, .html5-video-player, .player, [data-player]';
    let node = video;
    let known = null;
    for (let i = 0; i < 12 && node && node !== document.body && node !== document.documentElement; i++) {
      try { if (node.matches && node.matches(mark)) known = node; } catch { /* ignore a bad node */ }
      node = node.parentElement;
    }
    return known || tightPlayer(video);
  }

  function dedicatedPlayer(video) {
    if (!video || !video.getBoundingClientRect) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 90) return false;
    const viewW = window.innerWidth || 1;
    const viewH = window.innerHeight || 1;
    if (rect.width * rect.height >= viewW * viewH * 0.35) return true;
    let node = video;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      try {
        if (node.matches && node.matches('.jwplayer, #vplayer, .video-js, .plyr, .plyr__video-wrapper')) return true;
      } catch { /* ignore a node that cannot match */ }
      node = node.parentElement;
    }
    return false;
  }

  function isSiteChrome(el) {
    if (!el || !el.closest) return false;
    try {
      if (el.closest('#adbd, #play_limit_box, .overdiv, .jw-controls, .jw-overlays, .jw-display, .jw-controlbar, .jw-preview, .vjs-control-bar, .plyr__controls')) return true;
    } catch { /* ignore a node that cannot match */ }
    const id = String(el.id || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    return /adbd|overdiv|play_limit|adblock/.test(`${id} ${cls}`);
  }

  function buttonTopOffset(boxTop, rectTop, btnH) {
    const gap = 8;
    const viewH = window.innerHeight || 0;
    let viewTop = boxTop - btnH - gap;
    if (viewTop < gap) viewTop = Math.max(boxTop, 0) + gap;
    const limit = Math.max(gap, viewH - btnH - gap);
    if (viewTop > limit) viewTop = limit;
    return viewTop - rectTop;
  }

  function isFramed() {
    try { return window.parent !== window; } catch { return true; }
  }

  function tellParent(entry, cmd, extra) {
    if (!isFramed()) return;
    try {
      window.parent.postMessage(Object.assign({
        source: 'zdm-slot',
        cmd,
        id: entry.id,
        pageUrl: location.href,
        pageTitle: docTitle(),
        userAgent: navigator.userAgent,
      }, extra || {}), '*');
    } catch { /* the parent page blocked the message */ }
  }

  // A feed video can stay on-screen under a chat or post dialog. The button
  // is painted above that dialog, so hide it unless the video itself is hit.
  function videoCovered(video) {
    if (/(^|\.)tiktok\.com$/i.test(location.hostname)) return false;
    const rect = video.getBoundingClientRect();
    const viewW = window.innerWidth || 0;
    const viewH = window.innerHeight || 0;
    const visL = Math.max(rect.left, 0);
    const visT = Math.max(rect.top, 0);
    const visR = Math.min(rect.right, viewW);
    const visB = Math.min(rect.bottom, viewH);
    if (visR - visL < 8 || visB - visT < 8) return false;
    const cx = (visL + visR) / 2;
    const cy = (visT + visB) / 2;
    let stack;
    try {
      stack = document.elementsFromPoint(cx, cy);
    } catch {
      return false;
    }
    if (!stack || !stack.length) return false;
    const box = playerBox(video);
    for (let i = 0; i < stack.length; i++) {
      const el = stack[i];
      if (!el || el === document.documentElement || el === document.body) continue;
      if (isExtensionUi(el)) continue;
      if (isSiteChrome(el)) continue;
      if (el === video || el === box || box.contains(el) || el.contains(box) || el.contains(video) || video.contains(el)) {
        return false;
      }
      const er = el.getBoundingClientRect();
      if (er.width >= Math.min(rect.width, 80) * 0.55 && er.height >= Math.min(rect.height, 80) * 0.55) {
        return true;
      }
    }
    return false;
  }

  function promoteUncovered(skip) {
    for (const other of tracked.values()) {
      if (other === skip || other.pinned) continue;
      if (!document.contains(other.video) || other.video.paused) continue;
      if (!onScreen(other.video) || videoCovered(other.video)) continue;
      onVideoPlay(other);
      return true;
    }
    return false;
  }

  function releaseIfCovered(entry) {
    if (!videoCovered(entry.video)) return false;
    const wasActive = activeId === entry.id;
    hideEntry(entry);
    if (wasActive && !promoteUncovered(entry)) activeId = null;
    return true;
  }

  function onVideoPlay(entry) {
    if (!pageOn) {
      if (entry) hideEntry(entry);
      return;
    }
    if (!entry || !document.contains(entry.video)) return;
    if (entry.pinned) {
      showPinned(entry);
      return;
    }
    let target = entry;
    const best = focusedEntry();
    if (best && best !== entry && shouldPrefer(best, entry)) target = best;
    const current = activeId != null ? tracked.get(activeId) : null;
    if (current && current !== target && current.visible && current.menu && current.menu.classList.contains('zdm-menu-open')) return;
    if (current && current !== target && current.visible && !shouldPrefer(target, current)) return;
    if (target.video.paused && !heldInView(target.video) && !engagedVideo(target.video)) return;
    if (!heldInView(target.video)) return;
    if (videoCovered(target.video)) {
      if (target === entry) releaseIfCovered(entry);
      return;
    }
    const src = target.video.currentSrc || target.video.src || '';
    const page = location.href;
    const reelKey = facebookReelKey(target.video);
    if (target.id === activeId && target.visible && src === target._lastPlaySrc && page === target._lastPlayPage && reelKey === (target._reelKey || '')) return;
    hardResetPlaying(target, src, page);
  }

  function hardResetPlaying(entry, src, page) {
    playGen += 1;
    entry.playGen = playGen;
    entry._lastPlaySrc = src;
    entry._lastPlayPage = page;
    entry._reelKey = facebookReelKey(entry.video);
    activeId = entry.id;
    for (const other of tracked.values()) {
      other.menu.replaceChildren();
      other.menu.classList.remove('zdm-menu-open');
      if (other !== entry && !other.pinned) hideEntry(other);
    }
    entry.visible = false;
    entry.rect = null;
    entry.settling = true;
    updatePosition(entry);
    followUntilSettled(entry);
    const key = mediaKey(entry.video);
    if (isTikTok()) console.log('[ZDM-TT]', { share: tiktokShareUrl(entry.video), cached: tiktokBodies.length, formats: pageFormatsFor(entry.video).length });
    const caption = displayTitle(entry.video);
    if (caption) entry.pageTitle = caption;
    const resetCache = isTikTok() || isX() || isThreads() || isFacebook() || /instagram\.com/i.test(location.hostname);
    if (resetCache) qualityMem.delete(key);
    const postUrl = postUrlFor(entry.video);
    send({
      type: 'video-playing',
      reset: true,
      resetCache,
      playGen,
      zdmId: entry.id,
      cacheKey: key,
      src,
      pageUrl: postUrl || pageUrlFor(entry.video),
      postUrl,
      pageTitle: caption || entry.pageTitle || docTitle(),
      pageFormats: pageFormatsFor(entry.video),
      pageTranscript: findTranscript(entry.video),
      ...playlistExtra(entry.video),
    });
  }

  function followUntilSettled(entry) {
    const started = performance.now();
    let last = '';
    let stable = 0;
    const step = () => {
      settleRaf = 0;
      if (activeId !== entry.id || !document.contains(entry.video)) {
        entry.settling = false;
        return;
      }
      updatePosition(entry);
      const r = entry.video.getBoundingClientRect();
      const now = [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(':');
      if (now === last) stable += 1;
      else stable = 0;
      last = now;
      const elapsed = performance.now() - started;
      if ((stable >= 4 && elapsed > 80) || elapsed > 1600) {
        entry.settling = false;
        updatePosition(entry);
        return;
      }
      settleRaf = requestAnimationFrame(step);
    };
    if (settleRaf) cancelAnimationFrame(settleRaf);
    settleRaf = requestAnimationFrame(step);
  }

  function followFocus() {
    const current = activeId != null ? tracked.get(activeId) : null;
    if (current && current.menu && current.menu.classList.contains('zdm-menu-open')) return;
    const best = focusedEntry();
    if (!best) return;
    if (best.id === activeId) {
      if (current && (!current.visible || !overlayMatchesVideo(current)) && onScreen(current.video)) {
        updatePosition(current);
      }
      return;
    }
    if (current && current.visible && !shouldPrefer(best, current)) return;
    onVideoPlay(best);
  }

  function overlayMatchesVideo(entry) {
    const v = entry.video.getBoundingClientRect();
    const o = entry.overlay.getBoundingClientRect();
    return Math.abs(v.left - o.left) < 16
      && Math.abs(v.top - o.top) < 16
      && Math.abs(v.width - o.width) < 16
      && Math.abs(v.height - o.height) < 16;
  }

  function onFeedMoved() {
    followFocus();
    const entry = activeId != null ? tracked.get(activeId) : null;
    if (!entry || entry.framed || !document.contains(entry.video)) return;
    if (onScreen(entry.video) || heldInView(entry.video)) {
      updatePosition(entry);
      return;
    }
    hideEntry(entry);
  }

  function onPageUrlChanged() {
    const entry = activeId != null ? tracked.get(activeId) : null;
    if (!entry || entry.video.paused) return;
    if (entry._lastPlayPage === location.href) return;
    onVideoPlay(entry);
  }

  function hookHistory() {
    // Instagram opens a post by calling history.pushState. Replacing that
    // function from this script aborts the viewer and leaves a black page.
    let last = location.href;
    const check = () => {
      try {
        const now = location.href;
        if (now === last) return;
        last = now;
        onPageUrlChanged();
      } catch { /* never throw into the page */ }
    };
    window.addEventListener('popstate', () => setTimeout(check, 0));
    window.addEventListener('hashchange', () => setTimeout(check, 0));
    setInterval(check, 400);
  }

  function updatePosition(entry) {
    if (!pageOn) {
      if (entry) hideEntry(entry);
      return;
    }
    const video = entry.video;
    if (!document.contains(video)) {
      removeEntry(entry);
      return;
    }

    if (releaseIfCovered(entry)) return;

    if (!entry.pinned && entry.id !== activeId) {
      hideEntry(entry);
      return;
    }

    const rect = (entry.pinned ? audioAnchorBox(video) : video).getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const viewH = window.innerHeight || 0;
    const viewW = window.innerWidth || 0;
    let clipTop = 0;
    let clipBottom = viewH;
    let clipLeft = 0;
    let clipRight = viewW;

    const sp = entryScrollParent(entry);
    if (sp) {
      const pRect = sp.getBoundingClientRect();
      clipTop = Math.max(clipTop, pRect.top);
      clipBottom = Math.min(clipBottom, pRect.bottom);
      clipLeft = Math.max(clipLeft, pRect.left);
      clipRight = Math.min(clipRight, pRect.right);
    }

    const visibleH = Math.min(rect.bottom, clipBottom) - Math.max(rect.top, clipTop);
    const visibleW = Math.min(rect.right, clipRight) - Math.max(rect.left, clipLeft);

    if (entry.pinned) {
      if (w < 64 || h < 24 || visibleW < 48 || visibleH < 16) {
        hideEntry(entry);
        return;
      }
    } else if (w < MIN_VIDEO_SIZE || h < MIN_VIDEO_SIZE || visibleW < MIN_VIDEO_SIZE) {
      hideEntry(entry);
      return;
    } else {
      const minVisible = heldInView(video) ? Math.min(h, MIN_VIDEO_SIZE) : Math.min(h, clipBottom - clipTop) * 0.35;
      if (visibleH < minVisible) {
        hideEntry(entry);
        return;
      }
    }

    const x = rect.left;
    const y = rect.top;
    if (entry.pinned && duplicateOnScreen(entry)) {
      hideEntry(entry);
      return;
    }

    const box = playerBox(video).getBoundingClientRect();
    if (isFramed()) {
      entry.framed = true;
      entry.overlay.classList.remove('zdm-visible');
      entry.overlay.style.visibility = 'hidden';
      entry.visible = true;
      tellParent(entry, 'show');
      return;
    }
    entry.overlay.style.position = 'fixed';
    entry.overlay.style.visibility = '';
    entry.overlay.style.left = x + 'px';
    entry.overlay.style.top = y + 'px';
    entry.overlay.style.width = w + 'px';
    entry.overlay.style.height = h + 'px';
    if (!entry.pinned) {
      entry.overlay.style.zIndex = '2147483647';
    } else {
      const zBase = getEffectiveZIndex(box) || getEffectiveZIndex(video);
      entry.overlay.style.zIndex = (entry.menu && entry.menu.classList.contains('zdm-menu-open'))
        ? '2147483647'
        : String(Math.max(10, zBase + 2));
    }
    const btnH = entry.btn.offsetHeight || 36;
    const offset = buttonTopOffset(box.top, rect.top, btnH);
    entry.btn.style.top = offset + 'px';
    if (entry.menu) entry.menu.style.top = (offset + btnH + 6) + 'px';
    entry.overlay.classList.add('zdm-visible');
    entry.visible = true;
    entry.rect = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
    };
  }

  function removeEntry(entry) {
    if (activeId === entry.id) activeId = null;
    tracked.delete(entry.id);
    entry.overlay.remove();
  }

  const resizeObserver = new ResizeObserver((entries) => {
    for (const re of entries) {
      const id = trackedId(re.target);
      const entry = tracked.get(id);
      if (!entry) continue;
      if (entry.pinned) {
        updatePosition(entry);
        continue;
      }
      if (entry.id !== activeId && (!entry.video.paused || dedicatedPlayer(entry.video))) {
        onVideoPlay(entry);
        continue;
      }
      updatePosition(entry);
    }
  });

  const intersectionObserver = new IntersectionObserver((entries) => {
    for (const ie of entries) {
      const id = trackedId(ie.target);
      const entry = tracked.get(id);
      if (!entry) continue;
      if (entry.pinned) {
        if (ie.isIntersecting) updatePosition(entry);
        else hideEntry(entry);
        continue;
      }
      if (ie.isIntersecting && (!entry.video.paused || dedicatedPlayer(entry.video))) onVideoPlay(entry);
      if (entry.id !== activeId) {
        hideEntry(entry);
        continue;
      }
      if (ie.isIntersecting) updatePosition(entry);
      else hideEntry(entry);
    }
  }, { threshold: 0.1 });

  function trackedId(node) {
    if (!node) return NaN;
    const own = node.getAttribute && node.getAttribute('__zdm_id__');
    if (own) return parseInt(own, 10);
    const host = node.closest && node.closest('[__zdm_id__]');
    return host ? parseInt(host.getAttribute('__zdm_id__'), 10) : NaN;
  }

  function observeElement(entry) {
    resizeObserver.observe(entry.video);
    intersectionObserver.observe(entry.video);
    const wave = entry.pinned ? audioAnchorBox(entry.video) : null;
    if (wave && wave !== entry.video) {
      resizeObserver.observe(wave);
      intersectionObserver.observe(wave);
    }
  }

  function scanForVideos() {
    if (!pageOn) return;
    if (bindPendingDirects()) {
      refreshThreadsMenus();
      refreshOwnedMenus();
    }
    const elements = [];
    collectMedia(document, elements, new Set());
    for (const el of elements) {
      if (el.hasAttribute('__zdm_id__')) {
        const existing = Number(el.getAttribute('__zdm_id__'));
        if (tracked.has(existing)) continue;
        el.removeAttribute('__zdm_id__');
      }
      if (el.tagName === 'AUDIO') {
        const host = el.closest('[data-audio-player-preview-url-value], [data-zdm-audio-url]');
        if (host && host !== el) continue;
      }
      if (el.tagName !== 'VIDEO' && !mediaSrc(el)) continue;
      createOverlay(el);
    }
    harvestAudio(document, false);
  }

  const mutationObserver = new MutationObserver((mutations) => {
    let found = false;
    const gone = [];
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          found = true;
        } else if (node.matches && node.matches('[data-audio-player-preview-url-value], [data-zdm-audio-url]')) {
          found = true;
        } else if (node.querySelectorAll) {
          const sub = node.querySelectorAll('video, audio, [data-audio-player-preview-url-value], [data-zdm-audio-url]');
          if (sub.length) found = true;
        }
        if (isThreads()) {
          const scripts = node.tagName === 'SCRIPT' ? [node] : (node.querySelectorAll ? node.querySelectorAll('script') : []);
          for (const s of scripts) {
            if (/video_versions|video_dash_manifest/i.test(s.textContent || '')) {
              scheduleThreadsRefresh();
              break;
            }
          }
        }
        try { harvestAudio(node, true); } catch { /* ignore a partial node */ }
      }
      for (const node of m.removedNodes) {
        collectTracked(node, gone);
      }
    }
    if (found || gone.length) queueDomWork(found, gone);
    queueCoverCheck();
  });

  function collectTracked(node, gone) {
    if (!node || node.nodeType !== 1) return;
    if (node.hasAttribute && node.hasAttribute('__zdm_id__')) {
      gone.push(parseInt(node.getAttribute('__zdm_id__'), 10));
    }
    if (!node.querySelectorAll) return;
    const nested = node.querySelectorAll('[__zdm_id__]');
    for (let i = 0; i < nested.length; i++) {
      gone.push(parseInt(nested[i].getAttribute('__zdm_id__'), 10));
    }
  }

  let domRaf = 0;
  let pendingScan = false;
  let pendingGone = [];
  function queueDomWork(scan, gone) {
    if (scan) pendingScan = true;
    if (gone && gone.length) pendingGone.push.apply(pendingGone, gone);
    if (domRaf) return;
    domRaf = requestAnimationFrame(() => {
      domRaf = 0;
      const ids = pendingGone;
      const scanNow = pendingScan;
      pendingGone = [];
      pendingScan = false;
      for (let i = 0; i < ids.length; i++) {
        const entry = tracked.get(ids[i]);
        if (!entry) continue;
        if (document.contains(entry.video)) continue;
        try { removeEntry(entry); } catch { /* ignore */ }
      }
      if (!scanNow) return;
      try { scanForVideos(); } catch { /* ignore */ }
    });
  }

  function checkUncoveredVideo() {
    if (!pageOn) return;
    const focus = focusedEntry();
    const entry = activeId != null ? tracked.get(activeId) : null;
    if (focus && (!entry || focus.id !== entry.id) && (!entry || !entry.visible || shouldPrefer(focus, entry))) {
      if (!entry || !entry.menu || !entry.menu.classList.contains('zdm-menu-open')) {
        onVideoPlay(focus);
        return;
      }
    }
    if (entry && document.contains(entry.video) && engagedVideo(entry.video) && onScreen(entry.video)) {
      if (videoCovered(entry.video)) {
        if (entry.visible) hideEntry(entry);
      } else {
        updatePosition(entry);
      }
      return;
    }
    for (const other of tracked.values()) {
      if (!document.contains(other.video) || other.pinned) continue;
      if (other.video.paused && !dedicatedPlayer(other.video)) continue;
      if (!onScreen(other.video) || videoCovered(other.video)) continue;
      onVideoPlay(other);
      return;
    }
  }

  let coverTimer = 0;
  function queueCoverCheck() {
    if (coverTimer) return;
    coverTimer = setTimeout(() => {
      coverTimer = 0;
      checkUncoveredVideo();
    }, 60);
  }

  const slots = new Map();

  function frameFor(source) {
    const frames = document.querySelectorAll('iframe');
    for (const frame of frames) {
      try { if (frame.contentWindow === source) return frame; } catch { /* ignore a closed frame */ }
    }
    return null;
  }

  function retireSlot(slot) {
    if (!slot) return;
    try {
      if (slot.overlay && slot.overlay.parentElement) slot.overlay.remove();
    } catch {}
    for (const [key, value] of slots.entries()) {
      if (value === slot) slots.delete(key);
    }
  }

  function slotWindowLive(slot) {
    if (!slot || !slot.iframe || !document.contains(slot.iframe)) return false;
    try { return slot.iframe.contentWindow === slot.source; } catch { return false; }
  }

  function frameHidden(frame) {
    let node = frame;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
      node = node.parentElement;
    }
    return false;
  }

  function frameInFront(frame) {
    const rect = frame.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, rect.width - 8);
    const y = rect.top + Math.min(24, Math.max(8, rect.height / 2));
    let stack = [];
    try { stack = document.elementsFromPoint(x, y) || []; } catch { return true; }
    for (const el of stack) {
      if (!el || el === frame) return true;
      if (el.closest && el.closest('.zdm-overlay, .zdm-root')) continue;
      if (el.tagName === 'IFRAME') return el === frame;
    }
    return true;
  }

  function hideSlot(slot) {
    slot.overlay.classList.remove('zdm-visible');
    slot.overlay.style.visibility = 'hidden';
    if (slot.menu) slot.menu.classList.remove('zdm-menu-open');
  }

  function placeSlot(slot) {
    if (!pageOn) {
      if (slot && slot.overlay) hideSlot(slot);
      return;
    }
    if (!slotWindowLive(slot)) {
      retireSlot(slot);
      return;
    }
    if (frameHidden(slot.iframe)) {
      hideSlot(slot);
      return;
    }
    const rect = slot.iframe.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80 || !frameInFront(slot.iframe)) {
      hideSlot(slot);
      return;
    }
    const btnH = slot.btn.offsetHeight || 36;
    const offset = buttonTopOffset(rect.top, rect.top, btnH);
    slot.overlay.style.position = 'fixed';
    slot.overlay.style.left = rect.left + 'px';
    slot.overlay.style.top = rect.top + 'px';
    slot.overlay.style.width = rect.width + 'px';
    slot.overlay.style.height = '0px';
    slot.overlay.style.visibility = '';
    slot.overlay.classList.add('zdm-visible');
    slot.btn.style.top = offset + 'px';
    slot.menu.style.top = (offset + btnH + 6) + 'px';
  }

  function watchPlayerFrames() {
    if (isFramed() || !document.documentElement) return;
    const obs = new MutationObserver((mutations) => {
      for (const change of mutations) {
        const frame = change.target;
        if (!frame || frame.tagName !== 'IFRAME') continue;
        for (const slot of Array.from(slots.values())) {
          if (slot.iframe === frame) retireSlot(slot);
        }
      }
    });
    obs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  function makeSlot(source, iframe) {
    const overlay = document.createElement('div');
    overlay.className = 'zdm-overlay';
    const btn = document.createElement('button');
    btn.className = 'zdm-btn is-' + activeButtonStyle;
    btn.type = 'button';
    btn.replaceChildren(createButtonContent());
    btn.title = 'Download with ZDM';
    const menu = document.createElement('div');
    menu.className = 'zdm-quality-menu';
    const slot = {
      id: 0,
      video: null,
      overlay,
      btn,
      menu,
      iframe,
      source,
      pageUrl: '',
      pageTitle: '',
      userAgent: '',
      framed: false,
    };
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.classList.contains('zdm-menu-open')) {
        menu.classList.remove('zdm-menu-open');
        setButtonState(btn, 'up');
        return;
      }
      showMenuSpinner(menu);
      menu.classList.add('zdm-menu-open');
      setButtonState(btn, 'down');
      try { source.postMessage({ source: 'zdm-slot', cmd: 'click', id: slot.id }, '*'); } catch { /* the frame is gone */ }
    });
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.zdm-overlay')) return;
      menu.classList.remove('zdm-menu-open');
      setButtonState(btn, 'up');
    }, true);
    holdMenuWheel(menu);
    overlay.appendChild(btn);
    overlay.appendChild(menu);
    overlayRoot().appendChild(overlay);
    slots.set(source, slot);
    return slot;
  }

  function onSlotMessage(event) {
    const data = event.data;
    if (!data || data.source !== 'zdm-slot') return;
    if (data.cmd === 'click') {
      try { if (event.source !== window.parent) return; } catch { return; }
      const entry = tracked.get(data.id);
      if (entry && entry.btn) entry.btn.click();
      return;
    }
    if (isFramed()) return;
    if (!pageOn) return;
    const iframe = frameFor(event.source);
    if (!iframe) return;
    let slot = slots.get(event.source);
    if (!slot) slot = makeSlot(event.source, iframe);
    slot.iframe = iframe;
    slot.id = data.id || slot.id;
    if (data.pageUrl) slot.pageUrl = data.pageUrl;
    if (data.pageTitle) slot.pageTitle = data.pageTitle;
    if (data.userAgent) slot.userAgent = data.userAgent;
    if (data.cmd === 'hide') {
      slot.overlay.classList.remove('zdm-visible');
      slot.overlay.style.visibility = 'hidden';
      slot.menu.classList.remove('zdm-menu-open');
      return;
    }
    if (data.cmd === 'show') {
      placeSlot(slot);
      return;
    }
    if (data.cmd === 'wait') {
      placeSlot(slot);
      showMenuSpinner(slot.menu);
      slot.menu.classList.add('zdm-menu-open');
      return;
    }
    if (data.cmd === 'formats') {
      placeSlot(slot);
      if (data.transcript && data.transcript.url) slot.transcript = data.transcript;
      slot._formats = data.formats || [];
      slot._formatTitle = data.title || slot.pageTitle || '';
      slot._menu = usableMenu(data.menu);
      buildQualityMenu(slot, slot._formats, slot._formatTitle, slot._menu);
      slot.menu.classList.add('zdm-menu-open');
    }
  }

  function placeSlots() {
    for (const slot of slots.values()) placeSlot(slot);
  }

  function throttledUpdateAll() {
    if (positionTimer) return;
    positionTimer = requestAnimationFrame(() => {
      positionTimer = null;
      for (const entry of tracked.values()) {
        updatePosition(entry);
      }
      placeSlots();
    });
  }

  function init() {
    connect();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  function onReady() {
    scanForVideos();
    harvestAudio(document, true);

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    hookHistory();
    document.addEventListener('pointerdown', (event) => {
      const node = event.target;
      if (!node || node.nodeType !== 1 || isExtensionUi(node)) return;
      if (node.closest && node.closest('video, .html5-video-player, #movie_player, ytd-player, .jwplayer, .plyr, .video-js')) return;
      lastGesture = { el: node, time: Date.now() };
      const box = gestureBox(node);
      if (!box) return;
      setTimeout(() => {
        if (!document.contains(box)) return;
        if (pendingAudio && Date.now() - pendingAudio.time < 1200) return;
        const item = newestUnboundAudio();
        if (!item) return;
        bindAudio(box, item.url, item.filesize, item.title, item.mime);
      }, 700);
    }, true);

    document.addEventListener('visibilitychange', refreshAfterIdle);
    window.addEventListener('focus', refreshAfterIdle);
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) dropPort();
    });
    window.addEventListener('pageshow', refreshAfterIdle);
    window.addEventListener('message', onSlotMessage);
    watchPlayerFrames();
    window.addEventListener('scroll', throttledUpdateAll, { capture: true, passive: true });
    window.addEventListener('resize', throttledUpdateAll, { passive: true });
    let scrollStopTimer1 = 0;
    let scrollStopTimer2 = 0;
    let scrollStopTimer3 = 0;
    function snapFocusedAfterScroll() {
      scanForVideos();
      const best = focusedEntry();
      if (best) {
        const srcNow = best.video.currentSrc || best.video.src || '';
        const reelNow = facebookReelKey(best.video);
        const moved = srcNow !== (best._lastPlaySrc || '') || (!!reelNow && reelNow !== (best._reelKey || ''));
        if (activeId !== best.id || !best.visible || !overlayMatchesVideo(best) || moved) {
          onVideoPlay(best);
        }
        updatePosition(best);
      } else {
        checkUncoveredVideo();
      }
    }
    function onScrollActive() {
      onFeedMoved();
      clearTimeout(scrollStopTimer1);
      clearTimeout(scrollStopTimer2);
      clearTimeout(scrollStopTimer3);
      scrollStopTimer1 = setTimeout(snapFocusedAfterScroll, 80);
      scrollStopTimer2 = setTimeout(snapFocusedAfterScroll, 280);
      scrollStopTimer3 = setTimeout(snapFocusedAfterScroll, 620);
    }
    document.addEventListener('scroll', onScrollActive, { capture: true, passive: true });
    window.addEventListener('wheel', (e) => {
      const node = e.target;
      if (node && node.closest && node.closest('.zdm-quality-menu')) return;
      onScrollActive();
    }, { capture: true, passive: true });
    window.addEventListener('touchmove', onScrollActive, { capture: true, passive: true });
    document.addEventListener('scrollend', snapFocusedAfterScroll, { capture: true, passive: true });
    window.addEventListener('scrollend', snapFocusedAfterScroll, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (/^(ArrowDown|ArrowUp|PageDown|PageUp|Home|End|j|k)$/i.test(e.key)) {
        onScrollActive();
      }
    }, { capture: true, passive: true });
    window.addEventListener('click', queueCoverCheck, true);
    window.addEventListener('focusout', queueCoverCheck, true);
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') queueCoverCheck();
    }, true);

    setInterval(() => {
      scanForVideos();
      checkUncoveredVideo();
    }, 400);
  }

  init();
})();
