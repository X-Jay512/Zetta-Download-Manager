const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { Grabber } = require('../engine/grabber');
const { rescueTikTok, enrichFormats, expandPlaylists, formatsFromPageScripts, pickHlsVariant, decideDownload, buildMenu, ingestCapture, sniffBatch, downloadPlan, resolveFacts, pageActive, pageRules } = require('../capture');
const { resolveFormats } = require('./formats-for');

const PIPE_NAME = '\\\\.\\pipe\\zdm_native_host';
const HTTP_PORT = 29512;
const BROWSER_SEEN_MS = 150000;

class NativeHostServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.httpServer = null;
    this.tickServer = null;
    this.clients = new Set();
    this.extensionSettings = null;
    this.confirmWaiters = new Map();
    this.grabber = new Grabber();
    this.connectedBrowsers = new Map();
    this.extensionDist = '';
  }

  setExtensionDist(dir) {
    this.extensionDist = dir || '';
  }

  markBrowserSeen(id) {
    if (!id) return;
    const cleanId = String(id).toLowerCase().trim();
    const wasConnected = this.isBrowserConnected(cleanId);
    this.connectedBrowsers.set(cleanId, Date.now());
    if (!wasConnected) {
      this.emit('browser-connected', { id: cleanId, connected: true });
    }
  }

  isBrowserConnected(id) {
    if (!id) return false;
    const cleanId = String(id).toLowerCase().trim();
    const last = this.connectedBrowsers.get(cleanId);
    if (!last) return false;
    return (Date.now() - last) < BROWSER_SEEN_MS;
  }

  getConnectedBrowsers() {
    const list = [];
    const now = Date.now();
    for (const [id, ts] of this.connectedBrowsers.entries()) {
      if (now - ts < BROWSER_SEEN_MS) {
        list.push(id);
      }
    }
    return list;
  }

  confirmResult(id, result) {
    const resolve = this.confirmWaiters && this.confirmWaiters.get(id);
    if (!resolve) return;
    this.confirmWaiters.delete(id);
    resolve(result || { go: false });
  }

  setExtensionSettings(slice) {
    this.extensionSettings = slice;
    this.broadcast({ type: 'settings-sync', ...slice });
  }

  broadcast(data) {
    for (const socket of this.clients) {
      this._respond(socket, data);
    }
  }

  start() {
    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            this._handleMessage(msg, socket);
          } catch { /* skip malformed JSON */ }
        }
      });

      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });

    this.server.on('error', (err) => {
      console.error('[ZDM] Native host pipe error:', err.message);
    });
    this.server.listen(PIPE_NAME);

    const onRequest = (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZDM-Id, X-ZDM-Index, X-ZDM-Total, X-ZDM-Name, X-ZDM-Page, X-ZDM-Source, X-ZDM-Browser, X-ZDM-Audio');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const browserHdr = req.headers['x-zdm-browser'];
      if (browserHdr) {
        this.markBrowserSeen(browserHdr);
      } else {
        const ua = req.headers['user-agent'] || '';
        if (/Brave\//i.test(ua)) this.markBrowserSeen('brave');
        else if (/Edg\//i.test(ua)) this.markBrowserSeen('edge');
        else if (/OPR\//i.test(ua) || /Opera\//i.test(ua)) this.markBrowserSeen('opera');
        else if (/Firefox\//i.test(ua)) this.markBrowserSeen('firefox');
        else if (/Vivaldi\//i.test(ua)) this.markBrowserSeen('vivaldi');
      }

      const urlPath = (req.url || '').split('?')[0];
      if (req.method === 'GET' && urlPath.startsWith('/extension/')) {
        const name = path.basename(urlPath);
        const allowed = name === 'update.xml' || name === 'zdm.crx' || name === 'zdm.xpi';
        const file = allowed && this.extensionDist ? path.join(this.extensionDist, name) : '';
        if (!file || !fs.existsSync(file)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const type = name.endsWith('.xml') ? 'application/xml' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        fs.createReadStream(file).pipe(res);
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/capture/interpret') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 6000000) {
            tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ formats: [], source: '' }));
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          if (msg && msg.kind === 'ingest') {
            let stored = { ok: false };
            try { stored = ingestCapture(msg) || stored; } catch { stored = { ok: false }; }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(stored));
            return;
          }
          const blank = { identity: { url: '', title: '' }, rows: [], menu: { video: [], audio: [], choices: [] }, collect: {}, ask: true };
          let resolved = blank;
          try { resolved = resolveFacts(msg) || blank; } catch { resolved = blank; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(resolved));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ formats: [], source: '' }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/capture/tiktok-rescue') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2000000) {
            tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', async () => {
          const blank = { urls: [], source: '' };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          let result = blank;
          try { result = await rescueTikTok(msg) || blank; } catch { result = blank; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ urls: result.urls || [], source: result.source || '' }));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ urls: [], source: '' }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/capture/hls-variant') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2000000) {
            tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          const blank = { url: '', source: '' };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          let url = '';
          try { url = pickHlsVariant(msg.text, msg.url, msg.wanted) || ''; } catch { url = ''; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(url ? { url, source: 'app' } : blank));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ url: '', source: '' }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/capture/playlists') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 6000000) {
            tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          const blank = { formats: [], source: '', need: [] };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          let result = blank;
          try { result = expandPlaylists(msg) || blank; } catch { result = blank; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({
            formats: result.formats || [],
            source: result.source || '',
            need: result.need || [],
          }));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ formats: [], source: '', need: [] }));
        });
        return;
      }

      if (req.method === 'POST' && urlPath === '/capture/formats') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 6000000) tooBig = true;
          else chunks.push(chunk);
        });
        req.on('end', async () => {
          const blank = { formats: [], title: '', duration: 0, transcript: null, cookieHosts: [], complete: false };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
          try {
            const result = await resolveFormats(body, {
              expandPlaylists,
              enrichFormats,
              rescueTikTok,
              grabber: this.grabber,
            }) || blank;
            try {
              result.menu = buildMenu(result.formats, {
                qualityMode: body.qualityMode,
                fpsDisplay: body.fpsDisplay,
              });
            } catch { /* the format list still stands */ }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(result));
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
          }
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ formats: [], title: '', duration: 0, transcript: null, cookieHosts: [], complete: false }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/capture/enrich') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2000000) {
            tooBig = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', async () => {
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ formats: [], enriched: false }));
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          try {
            const formats = await enrichFormats(msg);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ formats, enriched: true }));
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ formats: [], enriched: false }));
          }
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ formats: [], enriched: false }));
        });
        return;
      }

      if (req.method === 'GET' && (req.url || '').split('?')[0] === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify({ status: 'ok', version: require('../../package.json').version }));
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/settings') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const patch = JSON.parse(body || '{}');
            this.emit('settings-patch', patch);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error' }));
          }
        });
        return;
      }

      if (req.method === 'POST' && urlPath === '/sniff/batch') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1000000) tooBig = true;
          else chunks.push(chunk);
        });
        req.on('end', () => {
          const blank = { media: [] };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
          let result = blank;
          try { result = sniffBatch(body) || blank; } catch { result = blank; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ media: [] }));
        });
        return;
      }

      if (req.method === 'POST' && urlPath === '/download/plan') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65536) tooBig = true;
          else chunks.push(chunk);
        });
        req.on('end', () => {
          const blank = { steps: [], direct: false };
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(blank));
            return;
          }
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
          let result = blank;
          try { result = downloadPlan(body) || blank; } catch { result = blank; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ steps: [], direct: false }));
        });
        return;
      }

      if (req.method === 'POST' && urlPath === '/browser/gate') {
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65536) tooBig = true;
          else chunks.push(chunk);
        });
        req.on('end', () => {
          if (tooBig) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ take: false, name: '', wait: false, headers: null }));
            return;
          }
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
          const browserId = String(req.headers['x-zdm-browser'] || '').toLowerCase().trim();
          const result = decideDownload(body, this.extensionSettings, browserId);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ take: false, name: '', wait: false, headers: null }));
        });
        return;
      }

      if (req.method === 'GET' && urlPath === '/settings') {
        const browserId = String(req.headers['x-zdm-browser'] || '').toLowerCase().trim();
        const settings = this.extensionSettings || {};
        const body = Object.assign({}, settings, { active: pageActive(settings, browserId), rules: pageRules() });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify(body));
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/browser-save') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const decode = (value) => {
            try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
          };
          this.emit('browser-save', {
            name: decode(req.headers['x-zdm-name']),
            page: decode(req.headers['x-zdm-page']),
            source: decode(req.headers['x-zdm-source']),
            body: Buffer.concat(chunks),
            id: String(req.headers['x-zdm-id'] || ''),
            audio: req.headers['x-zdm-audio'] === '1',
          });
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(JSON.stringify({ status: 'ok', size: chunks.reduce((n, c) => n + c.length, 0) }));
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-hls/hold') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          this.emit('session-hls-hold', msg);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && urlPath === '/session-hls/next') {
        const finish = (value) => {
          if (res.headersSent) return;
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(value || { stopped: true }));
        };
        if (req.method === 'GET') {
          let id = '';
          try { id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { id = ''; }
          this.emit('session-hls-next', { id }, finish);
          return;
        }
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 3000000) tooBig = true;
          else chunks.push(chunk);
        });
        req.on('end', () => {
          if (tooBig) {
            finish({ stopped: true });
            return;
          }
          let msg = {};
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { msg = {}; }
          this.emit('session-hls-next', msg, finish);
        });
        req.on('error', () => finish({ stopped: true }));
        return;
      }

      if (req.method === 'GET' && urlPath === '/session/pending') {
        let result = { pulls: [], files: [] };
        this.emit('session-pending', (value) => { result = value || result; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'GET' && (req.url || '').split('?')[0] === '/session-hls/pending') {
        let result = [];
        this.emit('session-hls-pending', (value) => { result = value || result; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'GET' && (req.url || '').startsWith('/session-hls/status')) {
        let id = '';
        try { id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { /* bad query */ }
        let result = { stopped: true };
        this.emit('session-hls-status', id, (value) => { result = value || result; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-hls/lanes') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          this.emit('session-hls-lanes', msg);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-hls/tick') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          this.emit('session-hls-tick', msg);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-hls/piece') {
        const chunks = [];
        let length = 0;
        req.on('data', (chunk) => {
          chunks.push(chunk);
          length += chunk.length;
        });
        req.on('end', () => {
          const done = (value) => {
            if (res.headersSent) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify(value || { status: 'error' }));
          };
          this.emit('session-hls-piece', {
            id: String(req.headers['x-zdm-id'] || ''),
            index: Number(req.headers['x-zdm-index'] || 0),
            total: Number(req.headers['x-zdm-total'] || 0),
            lane: Number(req.headers['x-zdm-lane'] || 0),
            lanes: Number(req.headers['x-zdm-lanes'] || 0),
            range: String(req.headers['x-zdm-range'] || ''),
            chunks,
            length,
          }, done);
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return;
      }

      if (req.method === 'GET' && (req.url || '').split('?')[0] === '/session-file/pending') {
        let result = [];
        this.emit('session-file-pending', (value) => { result = value || result; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'GET' && (req.url || '').startsWith('/session-file/status')) {
        let id = '';
        try { id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { /* bad query */ }
        let result = { status: 'stopped' };
        this.emit('session-file-status', id, (value) => { result = value || result; });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-file/chunk') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const done = (value) => {
            if (res.headersSent) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify(value || { status: 'error' }));
          };
          this.emit('session-file-chunk', {
            id: String(req.headers['x-zdm-id'] || ''),
            offset: Number(req.headers['x-zdm-offset'] || 0),
            total: Number(req.headers['x-zdm-total'] || 0),
            body: Buffer.concat(chunks),
          }, done);
        });
        req.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return;
      }

      if (req.method === 'POST' && ((req.url || '').split('?')[0] === '/session-file/arm' || (req.url || '').split('?')[0] === '/session-file/drop')) {
        const action = (req.url || '').split('?')[0].endsWith('/drop') ? 'drop' : 'arm';
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          if (action === 'drop') {
            this.emit('session-file-drop', msg);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ status: 'ok' }));
            return;
          }
          const done = (value) => {
            if (res.headersSent) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(value || { status: 'error' }));
          };
          this.emit('session-file-arm', msg, done);
        });
        return;
      }

      if (req.method === 'POST' && (req.url || '').split('?')[0] === '/session-file/restart') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          const done = (value) => {
            if (res.headersSent) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify(value || { status: 'error' }));
          };
          this.emit('session-file-restart', msg, done);
        });
        return;
      }

      if (req.method === 'POST' && ((req.url || '').split('?')[0] === '/session-file/finish' || (req.url || '').split('?')[0] === '/session-file/fail')) {
        const action = (req.url || '').split('?')[0].endsWith('/fail') ? 'fail' : 'finish';
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          this.emit(action === 'fail' ? 'session-file-fail' : 'session-file-finish', msg);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
      }

      if (req.method === 'POST' && ((req.url || '').split('?')[0] === '/session-hls/finish' || (req.url || '').split('?')[0] === '/session-hls/fail')) {
        const action = (req.url || '').split('?')[0].endsWith('/fail') ? 'fail' : 'finish';
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let msg = {};
          try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
          const done = (value) => {
            if (res.headersSent) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify(value || { status: 'ok' }));
          };
          this.emit(action === 'fail' ? 'session-hls-fail' : 'session-hls-finish', msg, done);
        });
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => body += chunk);
        req.on('end', async () => {
          try {
            const msg = JSON.parse(body);

            if (msg.type === 'new-download' && msg.browserPull && !msg.confirm) {
              const result = await new Promise((resolve) => {
                let settled = false;
                const finish = (value) => {
                  if (settled) return;
                  settled = true;
                  resolve(value || { status: 'error' });
                };
                this.emit('session-hls-start', msg, finish);
                setTimeout(() => finish({ status: 'error', message: 'The app did not start the download.' }), 20000);
              });
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
              res.end(JSON.stringify(result));
              return;
            }

            if (msg.type === 'grab-extract' && /threads\.(com|net)\//i.test(String(msg.url || ''))) {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ status: 'ok', formats: [], audioFormats: [], title: '', duration: 0 }));
              return;
            }

            if (msg.type === 'grab-extract') {
              const fs = require('fs');
              const path = require('path');
              const os = require('os');
              let cookieFile = null;
              if (msg.cookies) {
                cookieFile = path.join(os.tmpdir(), 'zdm_ext_cookies_' + Date.now() + '.txt');
                const domain = (() => { try { return new URL(msg.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
                let nc = '# Netscape HTTP Cookie File\n';
                msg.cookies.split('; ').forEach(pair => {
                  const eq = pair.indexOf('=');
                  if (eq < 1) return;
                  nc += `.${domain}\tTRUE\t/\tTRUE\t0\t${pair.slice(0, eq)}\t${pair.slice(eq + 1)}\n`;
                });
                fs.writeFileSync(cookieFile, nc, 'utf8');
              }
              try {
                const result = await this.grabber.extract(msg.url, {
                  referer: msg.referrer || msg.url,
                  cookieFile,
                });
                if (cookieFile) try { fs.unlinkSync(cookieFile); } catch {}
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
                res.end(JSON.stringify({ status: 'ok', ...result }));
              } catch (err) {
                console.error('[ZDM] yt-dlp extraction failed for', msg.url, ':', err.message);
                if (cookieFile) try { fs.unlinkSync(cookieFile); } catch {}
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
                res.end(JSON.stringify({ status: 'error', message: err.message }));
              }
              return;
            }

            if (msg.type === 'new-download' && msg.confirm) {
              const confirmId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
              this.emit('new-download', {
                url: msg.url,
                audioUrl: msg.audioUrl || null,
                fileName: msg.fileName,
                size: msg.size || 0,
                audioSize: msg.audioSize || 0,
                duration: Number(msg.duration) || 0,
                headers: msg.headers || {},
                referrer: msg.referrer,
                cookies: msg.cookies,
                isPageGrab: false,
                sourcePage: msg.sourcePage || '',
                formatId: msg.formatId || '',
                audioFormatId: msg.audioFormatId || '',
                confirm: true,
                confirmId,
                browserPull: msg.browserPull === true,
                frameId: Number(msg.frameId) || 0,
                audioOnly: !!msg.audioOnly,
              });
              const result = await new Promise((resolve) => {
                this.confirmWaiters.set(confirmId, resolve);
                setTimeout(() => {
                  if (this.confirmWaiters.get(confirmId) !== resolve) return;
                  this.confirmWaiters.delete(confirmId);
                  resolve({ go: false });
                }, 180000);
              });
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
              res.end(JSON.stringify(result));
              return;
            }

            if (msg.type === 'new-download' && msg.immediate && !msg.confirm && !msg.browserPull) {
              const catchToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
              const result = await new Promise((resolve) => {
                if (!this.catchWaiters) this.catchWaiters = new Map();
                this.catchWaiters.set(catchToken, resolve);
                setTimeout(() => {
                  if (this.catchWaiters.get(catchToken) !== resolve) return;
                  this.catchWaiters.delete(catchToken);
                  resolve({ status: 'timeout' });
                }, 180000);
                this.emit('new-download', {
                  url: msg.url,
                  audioUrl: msg.audioUrl || null,
                  fileName: msg.fileName,
                  size: msg.size || 0,
                  audioSize: msg.audioSize || 0,
                  duration: Number(msg.duration) || 0,
                  headers: msg.headers || {},
                  referrer: msg.referrer,
                  cookies: msg.cookies,
                  isPageGrab: msg.isPageGrab,
                  sourcePage: msg.sourcePage || '',
                  formatId: msg.formatId || '',
                  audioFormatId: msg.audioFormatId || '',
                  exactHeaders: msg.exactHeaders === true,
                  notice: !!msg.notice,
                  noticeTitle: msg.noticeTitle || '',
                  noticeBody: msg.noticeBody || '',
                  audioOnly: !!msg.audioOnly,
                  immediate: true,
                  catchToken,
                });
              });
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
              res.end(JSON.stringify(result || { status: 'error' }));
              return;
            }

            this._handleMessage(msg, null);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(JSON.stringify({ status: 'accepted' }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };
    this.httpServer = http.createServer(onRequest);
    this.tickServer = http.createServer(onRequest);

    this.httpServer.on('error', (err) => {
      console.error('[ZDM] HTTP bridge error:', err.message);
    });
    this.tickServer.on('error', (err) => {
      console.error('[ZDM] Progress bridge error:', err.message);
    });
    this.httpServer.listen(HTTP_PORT, '127.0.0.1');
    this.tickServer.listen(HTTP_PORT + 1, '127.0.0.1');
  }

  settleCatch(token, value) {
    if (!this.catchWaiters || !token) return;
    const resolve = this.catchWaiters.get(token);
    if (!resolve) return;
    this.catchWaiters.delete(token);
    resolve(value || { status: 'started' });
  }

  _handleMessage(msg, socket) {
    switch (msg.type) {
      case 'new-download':
        this.emit('new-download', {
          url: msg.url,
          audioUrl: msg.audioUrl || null,
          fileName: msg.fileName,
          size: msg.size || 0,
          audioSize: msg.audioSize || 0,
          duration: Number(msg.duration) || 0,
          headers: msg.headers || {},
          referrer: msg.referrer,
          cookies: msg.cookies,
          isPageGrab: msg.isPageGrab,
          sourcePage: msg.sourcePage || '',
          formatId: msg.formatId || '',
          audioFormatId: msg.audioFormatId || '',
          notice: !!msg.notice,
          noticeTitle: msg.noticeTitle || '',
          noticeBody: msg.noticeBody || '',
          audioOnly: !!msg.audioOnly,
        });
        if (socket) this._respond(socket, { status: 'accepted', id: msg.id });
        break;

      case 'video-detected':
        this.emit('video-detected', {
          url: msg.url,
          fileName: msg.fileName,
          headers: msg.headers || {},
          referrer: msg.referrer,
          isVideo: true,
        });
        if (socket) this._respond(socket, { status: 'accepted', id: msg.id });
        break;

      case 'hello':
      case 'ping':
        if (socket) {
          this._respond(socket, {
            status: 'pong',
            version: require('../../package.json').version,
            type: 'settings-sync',
            ...(this.extensionSettings || {}),
          });
        }
        break;

      case 'grab-extract': {
        if (/threads\.(com|net)\//i.test(String(msg.url || ''))) {
          if (socket) this._respond(socket, { type: 'grab-result', requestId: msg.requestId, status: 'ok', formats: [], audioFormats: [], title: '', duration: 0 });
          break;
        }
        const fs = require('fs');
        const path = require('path');
        let cookieFile = null;
        if (msg.cookies) {
          const os = require('os');
          cookieFile = path.join(os.tmpdir(), 'zdm_cookies_' + Date.now() + '.txt');
          const domain = (() => { try { return new URL(msg.url).hostname.replace(/^www\./, ''); } catch { return 'instagram.com'; } })();
          let nscookies = '# Netscape HTTP Cookie File\n';
          msg.cookies.split('; ').forEach(pair => {
            const eq = pair.indexOf('=');
            if (eq < 1) return;
            const name = pair.slice(0, eq);
            const val = pair.slice(eq + 1);
            nscookies += `.${domain}\tTRUE\t/\tTRUE\t0\t${name}\t${val}\n`;
          });
          fs.writeFileSync(cookieFile, nscookies, 'utf8');
        }
        this.grabber.extract(msg.url, { cookieFile, referer: msg.referrer || msg.url })
          .then(result => {
            if (cookieFile) try { fs.unlinkSync(cookieFile); } catch {}
            if (socket) this._respond(socket, { type: 'grab-result', requestId: msg.requestId, ...result });
          })
          .catch(err => {
            if (cookieFile) try { fs.unlinkSync(cookieFile); } catch {}
            if (socket) this._respond(socket, { type: 'grab-result', requestId: msg.requestId, error: err.message });
          });
        break;
      }

      case 'get-qualities': {
        this.emit('get-qualities', {
          url: msg.url,
          pageUrl: msg.pageUrl,
          tabId: msg.tabId,
        });
        if (socket) this._respond(socket, { status: 'accepted', id: msg.id });
        break;
      }
    }
  }

  _respond(socket, data) {
    try { socket.write(JSON.stringify(data) + '\n'); } catch { /* socket closed */ }
  }

  stop() {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    if (this.server) this.server.close();
    if (this.httpServer) this.httpServer.close();
    if (this.tickServer) this.tickServer.close();
  }
}

module.exports = { NativeHostServer };
