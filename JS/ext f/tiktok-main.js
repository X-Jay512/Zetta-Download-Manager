(function () {
  if (!window.__zdmMediaCache) {
    const cache = new Map();
    window.__zdmMediaCache = cache;
    const order = [];
    const maxItems = 6;
    const maxBytes = 32 * 1024 * 1024;
    let used = 0;
    const drop = (index) => {
      const row = order[index];
      if (!row) return;
      order.splice(index, 1);
      used -= row.bytes;
      for (let i = 0; i < row.keys.length; i++) {
        if (cache.get(row.keys[i]) === row.buf) cache.delete(row.keys[i]);
      }
    };
    const keep = (url, buf) => {
      if (!url || !buf || buf.byteLength < 50000 || buf.byteLength > maxBytes) return;
      const keys = [String(url)];
      try { keys.push(new URL(url, location.href).pathname); } catch { /* ignore */ }
      for (let i = order.length - 1; i >= 0; i--) {
        const row = order[i];
        if (row.keys.some((key) => keys.indexOf(key) !== -1)) drop(i);
      }
      while (order.length && (order.length >= maxItems || used + buf.byteLength > maxBytes)) drop(0);
      if (order.length >= maxItems || used + buf.byteLength > maxBytes) return;
      for (let i = 0; i < keys.length; i++) cache.set(keys[i], buf);
      order.push({ keys, buf, bytes: buf.byteLength });
      used += buf.byteLength;
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__zdmUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => {
        try {
          if (this.response instanceof ArrayBuffer) keep(this.__zdmUrl, this.response);
        } catch { /* ignore */ }
      });
      return origSend.apply(this, arguments);
    };
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        const input = arguments[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const pending = origFetch.apply(this, arguments);
        return Promise.resolve(pending).then((res) => {
          try {
            const type = (res.headers && res.headers.get('content-type')) || '';
            if (res.ok && /video|audio|mp4|mpeg|octet-stream/i.test(type)) {
              res.clone().arrayBuffer().then((buf) => keep(url, buf)).catch(() => {});
            }
          } catch { /* ignore */ }
          return res;
        });
      };
    }
  }

  if (window.__zdmTikTokShare) return;

  function awemeId(value) {
    if (typeof value === 'string' && /^\d{15,22}$/.test(value)) return value;
    if (typeof value === 'number' && value > 1e14 && value < 1e22) return String(Math.trunc(value));
    return '';
  }

  function userName(value) {
    if (!value || typeof value !== 'object') return '';
    const name = value.uniqueId || value.unique_id;
    if (typeof name === 'string' && name && !/^\d+$/.test(name)) return name;
    return '';
  }

  function fromObj(obj, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 5 || seen.has(obj)) return null;
    seen.add(obj);
    const id = awemeId(obj.id) || awemeId(obj.awemeId) || awemeId(obj.aweme_id) || awemeId(obj.itemId) || awemeId(obj.item_id) || awemeId(obj.videoId) || (obj.itemStruct && awemeId(obj.itemStruct.id));
    const author = obj.author || obj.authorInfo || obj.user || (obj.itemStruct && obj.itemStruct.author);
    const uniqueId = userName(author) || (typeof obj.uniqueId === 'string' && !/^\d+$/.test(obj.uniqueId) ? obj.uniqueId : '');
    
    if (id && uniqueId) return { id: id, uniqueId: uniqueId };
    
    const nested = ['item', 'itemInfo', 'itemStruct', 'videoData', 'awemeInfo', 'aweme', 'data', 'video', 'props'];
    for (let i = 0; i < nested.length; i++) {
        const found = fromObj(obj[nested[i]], depth + 1, seen);
        if (found && found.id && found.uniqueId) return found;
    }
    return id ? { id: id, uniqueId: uniqueId } : null;
  }

  function fiberOf(node) {
    if (!node) return null;
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('__reactFiber$') || keys[i].startsWith('__reactInternalInstance$')) return node[keys[i]];
    }
    return null;
  }

  function itemRoot(node) {
    if (!node || !node.closest) return node || null;
    try {
      return node.closest('[data-e2e="recommend-list-item-container"], [data-e2e="browse-video"], [data-e2e="feed-item"], [class*="DivItemContainer" i], article') || node;
    } catch (e) { return node; }
  }

  function shareUrl(hit) {
    if (!hit || !hit.id) return '';
    const res = 'https://www.tiktok.com/@' + (hit.uniqueId || 'user') + '/video/' + hit.id;
    try { console.log('[ZDM-MAIN] Extracted video share:', { id: hit.id, author: hit.uniqueId, url: res }); } catch {}
    return res;
  }

  function propsShare(el) {
    if (!el) return '';
    let keys = [];
    try { keys = Object.keys(el); } catch (e) { return ''; }
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactProps$') !== 0) continue;
      const url = shareUrl(fromObj(el[keys[i]], 0, new Set()));
      if (url) return url;
    }
    return '';
  }

  function shareFromFiber(node) {
    const root = itemRoot(node) || node;
    const fiber = fiberOf(root);
    if (!fiber) return '';
    const bags = [fiber.memoizedProps, fiber.pendingProps];
    if (fiber.stateNode && fiber.stateNode.props) bags.push(fiber.stateNode.props);
    for (let b = 0; b < bags.length; b++) {
      const url = shareUrl(fromObj(bags[b], 0, new Set()));
      if (url) return url;
    }
    let child = fiber.child;
    for (let n = 0; child && n < 40; n++) {
      const host = child.stateNode;
      if (host && host.nodeType === 1 && root && host !== root && !root.contains(host)) {
        child = child.sibling;
        continue;
      }
      const url = shareUrl(fromObj(child.memoizedProps, 0, new Set())) || shareUrl(fromObj(child.pendingProps, 0, new Set()));
      if (url) return url;
      child = child.sibling;
    }
    return '';
  }

  function shareFromContainer(node) {
    const root = itemRoot(node) || node;
    return propsShare(root) || shareFromFiber(root);
  }

  window.__zdmTikTokShare = shareFromContainer;
  function isRealVideo(buf) {
    if (!buf || buf.byteLength < 50000) return false;
    const head = new Uint8Array(buf.slice(0, 16));
    let text = '';
    for (let i = 0; i < head.length; i++) text += String.fromCharCode(head[i]);
    if (text.indexOf('ftyp') !== -1) return true;
    return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }

  document.addEventListener('zdm-fetch-media', async function (event) {
    const detail = (event && event.detail) || {};
    const done = (payload) => {
      window.postMessage(Object.assign({ source: 'zdm-media' }, payload), '*');
    };
    try {
      const cache = window.__zdmMediaCache;
      let cached = cache && cache.get(detail.url);
      if (!cached) {
        try { cached = cache && cache.get(new URL(detail.url, location.href).pathname); } catch { /* ignore */ }
      }
      if (cached && isRealVideo(cached)) {
        done({ requestId: detail.requestId, ok: true, status: 200, bytes: cached });
        return;
      }
      const res = await fetch(detail.url, { credentials: 'include' });
      if (!res.ok) {
        done({ requestId: detail.requestId, ok: false, status: res.status });
        return;
      }
      const bytes = await res.arrayBuffer();
      done({ requestId: detail.requestId, ok: isRealVideo(bytes), status: res.status, bytes });
    } catch {
      done({ requestId: detail.requestId, ok: false, status: 0 });
    }
  });

  document.addEventListener('zdm-tiktok-probe', function (event) {
    const node = event.target;
    if (!node || !node.getAttribute) return;
    const url = shareFromContainer(node);
    if (url) {
      node.setAttribute('data-zdm-share', url);
      try { console.log('[ZDM-MAIN] Probe attached data-zdm-share:', url); } catch {}
    }
  }, true);
})();
