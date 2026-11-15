const APP = 'http://127.0.0.1:29512';
const DEFAULTS = { qualityMode: 'full', fpsDisplay: '60', contextMenu: true };
const SIZE_PRESETS = ['102400', '512000', '1048576'];
const DEFAULT_EXTENSIONS = [
  '3gp', '7z', 'aac', 'ace', 'aif', 'apk', 'arj', 'asf', 'avi', 'bin', 'bz2',
  'exe', 'flv', 'gz', 'gzip', 'img', 'iso', 'lzh', 'm4a', 'm4v', 'mkv', 'mov',
  'mp3', 'mp4', 'mpa', 'mpe', 'mpeg', 'mpg', 'msi', 'msu', 'ogg', 'ogv', 'pdf',
  'ppt', 'pptx', 'plj', 'pps', 'qt', 'ra', 'rar', 'rm', 'rmvb', 'sea', 'sit',
  'sitx', 'tar', 'tif', 'tiff', 'wav', 'webm', 'wma', 'wmv', 'z', 'zip', 'xz',
  'dmg', 'deb', 'rpm', 'doc', 'docx', 'xls', 'xlsx',
];
const CATALOG = [...new Set([
  ...DEFAULT_EXTENSIONS,
  'flac',
])].sort();
const DEFAULT_HOSTS = [
  '*.update.microsoft.com',
  'download.windowsupdate.com',
  '*.download.windowsupdate.com',
  'siteseal.thawte.com',
  'ecom.cimet2.com',
  '*.voice2page.com',
];
const SORT_FIELDS = ['video', 'music', 'programs', 'compressed', 'documents', 'images'];
const sortValues = { video: '', music: '', programs: '', compressed: '', documents: '', images: '' };
let sortKey = 'video';
let enabledExtensions = new Set();
let catalogSet = new Set(CATALOG);
let deletedExtensions = new Set();
let isDeleteMode = false;

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['zdmDeletedExtensions'], (data) => {
    if (data && Array.isArray(data.zdmDeletedExtensions)) {
      deletedExtensions = new Set(data.zdmDeletedExtensions);
      for (const d of deletedExtensions) {
        catalogSet.delete(d);
        enabledExtensions.delete(d);
      }
      paintExtensionChips();
    }
  });
}

function flushSort() {
  const field = document.getElementById('sort-sites');
  if (field) sortValues[sortKey] = field.value;
}

function showSort(key, skipFlush) {
  if (!skipFlush) flushSort();
  sortKey = key;
  const field = document.getElementById('sort-sites');
  const kind = document.getElementById('sort-kind');
  if (kind) kind.value = key;
  if (field) field.value = sortValues[key] || '';
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setAppStatus(text, ok) {
  const el = document.getElementById('app-status');
  if (el) {
    el.textContent = text;
    if (ok != null) el.style.color = ok ? '#8fd18f' : '#ff7a7a';
  }
}

function paintExtensionChips() {
  const cloud = document.getElementById('ext-cloud');
  if (!cloud) return;
  cloud.classList.toggle('delete-mode', isDeleteMode);
  const all = [...new Set([...catalogSet, ...enabledExtensions])].filter((ext) => !deletedExtensions.has(ext)).sort();
  cloud.replaceChildren();
  all.forEach((ext) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (enabledExtensions.has(ext) ? ' on' : '');
    btn.textContent = ext;
    btn.addEventListener('click', () => {
      if (isDeleteMode) {
        catalogSet.delete(ext);
        enabledExtensions.delete(ext);
        deletedExtensions.add(ext);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ zdmDeletedExtensions: [...deletedExtensions] });
        }
        paintExtensionChips();
        saveCapture();
        return;
      }
      if (enabledExtensions.has(ext)) enabledExtensions.delete(ext);
      else enabledExtensions.add(ext);
      paintExtensionChips();
      saveCapture();
    });
    cloud.appendChild(btn);
  });
}

function applySizePreset(kb) {
  const select = document.getElementById('min-preset');
  const input = document.getElementById('min-kb');
  if (!select || !input) return;
  const value = String(Number(kb) || 0);
  select.value = SIZE_PRESETS.includes(value) ? value : 'custom';
  input.hidden = false;
  input.value = value;
}

async function loadCapture() {
  const capture = document.getElementById('capture');
  const silent = document.getElementById('add-silently');
  const ignored = document.getElementById('ignored');
  if (!capture) return;
  try {
    const ping = await fetch(APP + '/ping?t=' + Date.now(), { cache: 'no-store' });
    if (!ping.ok) throw new Error('down');
    const res = await fetch(APP + '/settings?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('down');
    const data = await res.json();
    const catchSettings = data.catch || {};
    const types = data.types || {};
    capture.checked = catchSettings.interceptDownloads !== false;
    const findMedia = document.getElementById('find-media');
    if (findMedia) findMedia.checked = catchSettings.sniffVideos !== false;
    silent.checked = catchSettings.addSilently === true;
    applySizePreset(catchSettings.minCaptureKB);
    const stored = (types.extensions || []).map((ext) => String(ext).replace(/^\./, '').toLowerCase()).filter(Boolean);
    enabledExtensions = new Set((stored.length ? stored : DEFAULT_EXTENSIONS).filter((ext) => !deletedExtensions.has(ext)));
    paintExtensionChips();
    ignored.value = (types.skipAddresses || []).join('\n');
    const hosts = document.getElementById('hosts');
    if (hosts) hosts.value = (types.skipSites || []).join('\n');
    const patterns = (data.categories && data.categories.patterns) || {};
    SORT_FIELDS.forEach((key) => {
      sortValues[key] = (patterns[key] || []).join('\n');
    });
    sortKey = 'video';
    showSort('video', true);
    setAppStatus('Connected to ZDM.', true);
  } catch {
    setAppStatus('App is not running', false);
  }
}

async function saveCapture() {
  const capture = document.getElementById('capture');
  if (!capture) return;
  flushSort();
  try {
    const res = await fetch(APP + '/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catch: {
          interceptDownloads: capture.checked,
          sniffVideos: document.getElementById('find-media').checked,
          addSilently: document.getElementById('add-silently').checked,
          minCaptureKB: Number(document.getElementById('min-kb').value) || 0,
        },
        types: {
          extensions: [...enabledExtensions],
          skipSites: lines(document.getElementById('hosts').value),
          skipAddresses: lines(document.getElementById('ignored').value),
        },
        categories: {
          patterns: SORT_FIELDS.reduce((all, key) => {
            all[key] = lines(sortValues[key] || '');
            return all;
          }, {}),
        },
      }),
    });
    setAppStatus(res.ok ? 'Saved in ZDM.' : 'ZDM did not save that.', res.ok);
    chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => {});
  } catch {
    setAppStatus('App is not running', false);
  }
}

document.addEventListener('change', (event) => {
  const id = event.target && event.target.id;
  if (id === 'min-kb') applySizePreset(event.target.value);
  if (id === 'sort-kind') {
    showSort(event.target.value);
    return;
  }
  if (id === 'sort-sites') flushSort();
  const watched = id === 'capture' || id === 'find-media' || id === 'add-silently' || id === 'ignored' || id === 'hosts' || id === 'min-kb' || id === 'sort-sites';
  if (watched) saveCapture();
  if (id === 'min-preset') {
    const input = document.getElementById('min-kb');
    input.hidden = false;
    input.value = event.target.value === 'custom' ? '0' : event.target.value;
    saveCapture();
  }
});

const extAdd = document.getElementById('ext-add-btn');
if (extAdd) {
  extAdd.addEventListener('click', () => {
    const input = document.getElementById('ext-add-input');
    const raw = (input.value || '').replace(/^\./, '').trim().toLowerCase();
    if (!raw) return;
    enabledExtensions.add(raw);
    catalogSet.add(raw);
    deletedExtensions.delete(raw);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ zdmDeletedExtensions: [...deletedExtensions] });
    }
    input.value = '';
    paintExtensionChips();
    saveCapture();
  });
}
const extDelete = document.getElementById('ext-delete-btn');
if (extDelete) {
  extDelete.addEventListener('click', () => {
    isDeleteMode = !isDeleteMode;
    extDelete.textContent = isDeleteMode ? 'Done' : 'Delete';
    extDelete.classList.toggle('done', isDeleteMode);
    paintExtensionChips();
    if (!isDeleteMode) {
      saveCapture();
    }
  });
}
const extDefault = document.getElementById('ext-default');
if (extDefault) {
  extDefault.addEventListener('click', () => {
    catalogSet = new Set(CATALOG);
    deletedExtensions.clear();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ zdmDeletedExtensions: [] });
    }
    enabledExtensions = new Set(DEFAULT_EXTENSIONS);
    paintExtensionChips();
    saveCapture();
  });
}
const sitesDefault = document.getElementById('sites-default');
if (sitesDefault) {
  sitesDefault.addEventListener('click', () => {
    const hosts = document.getElementById('hosts');
    if (hosts) hosts.value = DEFAULT_HOSTS.join('\n');
    saveCapture();
  });
}

loadCapture();

const VALID_MODES = ['full', 'average', 'simple'];

function readForm() {
  const mode = document.querySelector('input[name="qualityMode"]:checked');
  const fps = document.querySelector('input[name="fpsDisplay"]:checked');
  const contextMenu = document.getElementById('context-menu');
  return {
    qualityMode: mode && VALID_MODES.includes(mode.value) ? mode.value : 'full',
    fpsDisplay: fps && (fps.value === '30' || fps.value === 'off') ? fps.value : '60',
    contextMenu: contextMenu ? contextMenu.checked : true,
  };
}

function writeForm(data) {
  const mode = data && VALID_MODES.includes(data.qualityMode) ? data.qualityMode : 'full';
  const fps = data && (data.fpsDisplay === '30' || data.fpsDisplay === 'off') ? data.fpsDisplay : '60';
  const modeInput = document.querySelector(`input[name="qualityMode"][value="${mode}"]`);
  const fpsInput = document.querySelector(`input[name="fpsDisplay"][value="${fps}"]`);
  if (modeInput) modeInput.checked = true;
  if (fpsInput) fpsInput.checked = true;
  const contextMenu = document.getElementById('context-menu');
  if (contextMenu) contextMenu.checked = data.contextMenu !== false;
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target) return;
  if (target.id === 'context-menu') {
    const next = readForm();
    chrome.storage.local.set({ contextMenu: next.contextMenu }, () => {
      void chrome.runtime.lastError;
      setStatus('Saved.');
    });
    return;
  }
  if (!target.name) return;
  if (target.name !== 'qualityMode' && target.name !== 'fpsDisplay') return;
  const next = readForm();
  fetch(APP + '/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video: {
        qualityMode: next.qualityMode,
        fpsDisplay: next.fpsDisplay,
        qualityStamp: Date.now(),
      },
    }),
  }).then((res) => {
    if (!res.ok) throw new Error('down');
    chrome.runtime.sendMessage({ type: 'settings-changed' });
    setStatus('Saved. The page updates when you open its tab.');
  }).catch(() => {
    setStatus('Open ZDM to save this.');
  });
});

function loadQualityForm() {
  chrome.storage.local.get(DEFAULTS, writeForm);
  fetch(APP + '/settings').then((res) => {
    if (!res.ok) return null;
    return res.json();
  }).then((data) => {
    if (!data || !data.quality) return;
    chrome.storage.local.get({ contextMenu: true }, (stored) => {
      writeForm({
        qualityMode: data.quality.qualityMode,
        fpsDisplay: data.quality.fpsDisplay,
        contextMenu: !stored || stored.contextMenu !== false,
      });
    });
  }).catch(() => { /* the stored mirror stays on the form */ });
}

loadQualityForm();
setInterval(loadCapture, 3000);
