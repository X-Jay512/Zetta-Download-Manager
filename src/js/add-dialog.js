(function () {
const zdm = window.zdm;

const $ = id => document.getElementById(id);

const KIND_EXTS = {
  compressed: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso', '.xz'],
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'],
  music: ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a'],
  programs: ['.exe', '.msi', '.dmg', '.deb', '.rpm', '.apk'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m3u8', '.ts', '.ogv'],
  images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'],
};

let selectedVideoUrl = null;
let selectedAudioUrl = null;
let pendingBrowserMeta = {};
let pendingAddOpts = null;
let userPickedPath = false;
let zdmSettings = {};
let dialogManual = false;
let knownSize = 0;
let knownDuration = 0;
let armedId = null;
let arming = false;
let sheetClosed = false;

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '';
  const s = Math.round(seconds);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m} m ${rem} s` : `${m} m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h} h ${remM} m` : `${h} h`;
}

function patternHost(raw) {
  let host = String(raw || '').trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  return host.replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^www\./, '');
}

function classifyKind(fileName, url) {
  const patterns = window.zdmSettings && window.zdmSettings.categories && window.zdmSettings.categories.patterns;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { host = ''; }
  if (host && patterns) {
    for (const kind of ['video', 'music', 'programs', 'compressed', 'documents', 'images']) {
      const list = patterns[kind] || [];
      if (list.some((pattern) => {
        const needle = patternHost(pattern);
        return needle && (host === needle || host.endsWith('.' + needle));
      })) return kind;
    }
  }
  const hay = `${fileName || ''} ${url || ''}`.toLowerCase();
  const clean = (fileName || url || '').split('?')[0];
  const extMatch = clean.match(/\.[a-z0-9]+$/i);
  if (extMatch) {
    const ext = extMatch[0].toLowerCase();
    for (const [kind, list] of Object.entries(KIND_EXTS)) {
      if (list.includes(ext)) return kind;
    }
  }
  if (/youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|dailymotion\.com/.test(hay)) {
    return 'video';
  }
  return 'general';
}

const KIND_LABELS = {
  general: 'General',
  compressed: 'Compressed',
  documents: 'Documents',
  music: 'Sounds',
  programs: 'Programs',
  video: 'Video',
  images: 'Images',
};

function folderForKind(kind) {
  const lib = zdmSettings?.library;
  return (lib?.folders && lib.folders[kind]) || lib?.defaultPath || '';
}

function paintRememberLabel() {
  const kind = $('input-kind') ? $('input-kind').value : 'general';
  const label = KIND_LABELS[kind] || 'General';
  if ($('remember-label')) $('remember-label').textContent = `Remember this folder for ${label}`;
}

async function paintFileIcon(fileName) {
  const icon = $('file-type-icon');
  if (!icon || !zdm.invoke) return;
  try {
    const url = await zdm.invoke('shell:file-icon', fileName || 'file.bin');
    if (url) icon.src = url;
  } catch { /* generic icon stays empty */ }
}

function siteReferrer(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'ftp:'].includes(parsed.protocol)) return '';
    return `${parsed.origin}/`;
  } catch {
    return '';
  }
}

function usableFileName(name) {
  let base = String(name || '').trim().split(/[/\\]/).pop() || '';
  base = base.replace(/\.crdownload$/i, '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || /^unconfirmed\b/i.test(base)) return '';
  return base;
}

function suggestFileName(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    const clean = usableFileName(name);
    if (!clean || clean.length > 180) return '';
    return clean;
  } catch {
    return '';
  }
}

function isGrabSite(url) {
  return /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|dailymotion\.com|facebook\.com|fb\.watch/i.test(url || '');
}

function resetGrabFields() {
  selectedVideoUrl = null;
  selectedAudioUrl = null;
}

function fitWindow() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const visible = document.querySelector('.dialog-overlay.visible .dialog');
        if (!visible || !zdm.invoke) return;
        const isDup = !!visible.closest('#duplicate-dialog');
        const h = Math.max(isDup ? 180 : 0, Math.ceil(visible.getBoundingClientRect().height));
        const w = isDup ? 500 : 520;
        if (h > 0) zdm.invoke('window:fit-add-dialog', { height: h, width: w, isDup });
      }, 30);
    });
  });
}

function applyDetectedKind(fileName, url, size) {
  if (size) knownSize = Number(size) || 0;
  const kind = classifyKind(fileName, url);
  if ($('input-kind')) $('input-kind').value = kind;
  if (!userPickedPath) {
    const folder = folderForKind(kind);
    if (folder) $('input-save-path').value = folder;
  }
  if ($('dl-size')) $('dl-size').textContent = size ? formatSize(size) : '';
  paintRememberLabel();
  paintFileIcon($('input-filename') ? $('input-filename').value : fileName);
}

async function extractGrab(showEmptyAlert = true) {
  const url = $('input-url').value.trim();
  if (!url) return false;
  if ($('grab-spinner')) $('grab-spinner').style.display = 'inline-block';
  try {
    const data = await zdm.invoke('grabber:extract', url);
    if (data.formats && data.formats.length > 0) {
      const picked = data.formats[0];
      const audios = data.audioFormats || [];
      selectedVideoUrl = picked.url;
      selectedAudioUrl = (!picked.hasAudio && audios[0]) ? audios[0].url : null;
      const currentVal = $('input-filename').value.trim();
      const isGeneric = ['watch', 'videoplayback', 'video', 'media', ''].includes(currentVal.toLowerCase().replace(/\.[a-z0-9]+$/i, ''));
      if (data.title && isGeneric) {
        $('input-filename').value = data.title.replace(/[\/\\?%*:|"<>]/g, '-') + '.mp4';
      }
      applyDetectedKind($('input-filename').value, url);
      let totalSize = picked.filesize || 0;
      if (selectedAudioUrl && audios[0]?.filesize) totalSize += audios[0].filesize;
      if (totalSize) knownSize = totalSize;
      if (totalSize && $('dl-size')) $('dl-size').textContent = formatSize(totalSize);
      const dur = data.duration || 0;
      const size = data.filesize || 0;
      if (dur > 0) knownDuration = Number(dur) || knownDuration;
      if (dur > 0 && $('dl-duration')) $('dl-duration').textContent = formatTime(dur);
      if (size && $('dl-size')) $('dl-size').textContent = formatSize(size);
      return true;
    }
    if (showEmptyAlert) alert('No media formats found on this page.');
    return false;
  } catch (err) {
    if (showEmptyAlert) alert('Extraction failed: ' + err.message);
    return false;
  } finally {
    if ($('grab-spinner')) $('grab-spinner').style.display = 'none';
    fitWindow();
  }
}

if ($('btn-grab-url')) {
  $('btn-grab-url').addEventListener('click', () => extractGrab(true));
}

async function submitAdd(extra = {}) {
  let url = extra.url || selectedVideoUrl || $('input-url').value.trim();
  if (!url) return null;
  let audioUrl = extra.audioUrl || selectedAudioUrl || pendingBrowserMeta.audioUrl || null;
  const keepOpen = !!extra.keepOpen;
  const sendExtra = { ...extra };
  delete sendExtra.keepOpen;

  const opts = pendingAddOpts || {
    url,
    audioUrl,
    needsMux: !!audioUrl,
    savePath: $('input-save-path').value.trim() || '',
    fileName: $('input-filename').value.trim() || '',
    category: $('input-kind') ? $('input-kind').value : '',
    headers: pendingBrowserMeta.headers || {},
    referrer: pendingBrowserMeta.referrer || siteReferrer($('input-url').value.trim()) || '',
    login: pendingBrowserMeta.login || '',
    password: pendingBrowserMeta.password || '',
    cookies: pendingBrowserMeta.cookies || '',
    manual: dialogManual,
    sourcePage: pendingBrowserMeta.sourcePage || '',
    formatId: pendingBrowserMeta.formatId || '',
    audioFormatId: pendingBrowserMeta.audioFormatId || '',
    confirmId: pendingBrowserMeta.confirmId || '',
    browserPull: pendingBrowserMeta.browserPull === true,
    audioOnly: !!(pendingBrowserMeta.audioOnly || extra.audioOnly),
    audioSize: Number(pendingBrowserMeta.audioSize) || 0,
    catchToken: pendingBrowserMeta.catchToken || '',
    exactHeaders: pendingBrowserMeta.exactHeaders === true,
    description: $('input-description') ? $('input-description').value.trim() : '',
    rememberPath: $('remember-path') ? $('remember-path').checked : false,
    fileSize: knownSize || 0,
    size: knownSize || 0,
    duration: knownDuration || 0,
  };

  try {
    const record = await zdm.invoke('download:add', { ...opts, ...sendExtra, manual: dialogManual, fromDialog: true });
    if (record && record.duplicate) {
      pendingAddOpts = opts;
      $('duplicate-filename').textContent = record.existing?.fileName || record.existing?.url || opts.url;
      const resumePick = document.querySelector('input[name="dup-action"][value="resume"]');
      if (resumePick) resumePick.checked = true;
      if ($('dup-remember')) $('dup-remember').checked = false;
      document.title = 'This file is already in your list.';
      $('add-url-dialog').classList.remove('visible');
      $('duplicate-dialog').classList.add('visible');
      fitWindow();
      return record;
    }
    if (record && record.skipped) {
      if (!keepOpen) window.close();
      return record;
    }
    if (keepOpen) return record;
  } catch (err) {
    alert('Download failed to start: ' + err.message);
    return null;
  }
  window.close();
  return null;
}

function showQueuePanel(open) {
  const panel = $('queue-panel');
  const footer = $('add-footer');
  if (panel) panel.hidden = !open;
  if (footer) footer.hidden = !!open;
  fitWindow();
}

async function parkLater() {
  if (armedId) {
    zdm.send('download:pause', armedId);
    window.close();
    return;
  }
  if (zdmSettings?.behavior?.queueOnLater !== false) {
    showQueuePanel(true);
    return;
  }
  await submitAdd({ queueOnly: true });
}

$('btn-start-download').addEventListener('click', () => {
  if (arming) return;
  if (armedId) {
    window.close();
    return;
  }
  submitAdd();
});
if ($('btn-download-later')) {
  $('btn-download-later').addEventListener('click', () => parkLater());
}
if ($('btn-queue-back')) {
  $('btn-queue-back').addEventListener('click', () => showQueuePanel(false));
}
if ($('btn-queue-yes')) {
  $('btn-queue-yes').addEventListener('click', () => submitAdd({ queueOnly: true }));
}

function chosenDupAction() {
  const picked = document.querySelector('input[name="dup-action"]:checked');
  return picked ? picked.value : 'resume';
}

if ($('btn-dup-skip')) {
  $('btn-dup-skip').addEventListener('click', () => {
    $('duplicate-dialog').classList.remove('visible');
    abandonConfirm();
    window.close();
  });
}
if ($('btn-dup-ok')) {
  $('btn-dup-ok').addEventListener('click', async () => {
    const action = chosenDupAction();
    if ($('dup-remember') && $('dup-remember').checked) {
      try { await zdm.invoke('settings:update', { behavior: { duplicateAction: action } }); } catch { /* ask again next time */ }
    }
    $('duplicate-dialog').classList.remove('visible');
    submitAdd({ duplicateConfirmed: action });
  });
}

function abandonConfirm() {
  if (pendingBrowserMeta.confirmId) {
    zdm.send('download:confirm-cancel', pendingBrowserMeta.confirmId);
    pendingBrowserMeta.confirmId = '';
  }
}

$('btn-cancel-add').addEventListener('click', () => {
  sheetClosed = true;
  abandonConfirm();
  if (armedId) zdm.send('download:cancel', armedId);
  window.close();
});
window.addEventListener('beforeunload', abandonConfirm);

if ($('input-kind')) {
  $('input-kind').addEventListener('change', () => {
    userPickedPath = false;
    const folder = folderForKind($('input-kind').value);
    if (folder) $('input-save-path').value = folder;
    paintRememberLabel();
  });
}

if ($('input-url')) {
  $('input-url').addEventListener('change', () => {
    applyDetectedKind($('input-filename').value, $('input-url').value);
  });
}
if ($('btn-copy-link')) {
  $('btn-copy-link').addEventListener('click', () => {
    const text = ($('input-url').value || '').trim();
    const button = $('btn-copy-link');
    if (!text) return;
    const done = () => {
      button.classList.add('copied');
      button.title = 'Copied';
      setTimeout(() => {
        button.classList.remove('copied');
        button.title = 'Copy link';
      }, 1200);
    };
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  });
}
if ($('input-filename')) {
  $('input-filename').addEventListener('change', () => {
    applyDetectedKind($('input-filename').value, $('input-url').value);
    paintFileIcon($('input-filename').value);
  });
}

if ($('btn-browse-save')) {
  $('btn-browse-save').addEventListener('click', async () => {
    const picked = await zdm.invoke('settings:pick-folder');
    if (!picked) return;
    userPickedPath = true;
    $('input-save-path').value = picked;
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return;
  if ($('grab-spinner') && $('grab-spinner').style.display !== 'none') return;
  if ($('duplicate-dialog').classList.contains('visible')) {
    e.preventDefault();
    if ($('btn-dup-ok')) $('btn-dup-ok').click();
    return;
  }
  if ($('queue-panel') && !$('queue-panel').hidden) return;
  e.preventDefault();
  $('btn-start-download').click();
});

// Init
async function init() {
  try {
  zdmSettings = await zdm.invoke('settings:get');
  const data = await zdm.invoke('app:get-add-dialog-data');
  if (data) {
    const { url = '', fileName = '', size = 0, autoGrab = false, isPageGrab, duration = 0 } = data;
    pendingBrowserMeta = data.meta || {
      headers: data.headers || {},
      referrer: data.referrer || '',
      cookies: data.cookies || '',
      audioUrl: data.audioUrl || null,
      sourcePage: data.sourcePage || '',
      formatId: data.formatId || '',
      audioFormatId: data.audioFormatId || '',
    };
    pendingBrowserMeta.login = data.login || pendingBrowserMeta.login || '';
    pendingBrowserMeta.password = data.password || pendingBrowserMeta.password || '';
    pendingBrowserMeta.sourcePage = pendingBrowserMeta.sourcePage || data.sourcePage || '';
    pendingBrowserMeta.formatId = pendingBrowserMeta.formatId || data.formatId || '';
    pendingBrowserMeta.audioFormatId = pendingBrowserMeta.audioFormatId || data.audioFormatId || '';
    pendingBrowserMeta.confirmId = data.confirmId || pendingBrowserMeta.confirmId || '';
    pendingBrowserMeta.browserPull = data.browserPull === true || pendingBrowserMeta.browserPull === true;
    pendingBrowserMeta.audioOnly = !!(data.audioOnly || pendingBrowserMeta.audioOnly);
    pendingBrowserMeta.audioSize = Number(data.audioSize || pendingBrowserMeta.audioSize) || 0;
    pendingBrowserMeta.catchToken = data.catchToken || pendingBrowserMeta.catchToken || '';
    pendingBrowserMeta.exactHeaders = data.exactHeaders === true || pendingBrowserMeta.exactHeaders === true;
    dialogManual = data.manual === true || pendingBrowserMeta.manual === true;
    if (!pendingBrowserMeta.referrer) pendingBrowserMeta.referrer = data.referrer || siteReferrer(url);
    userPickedPath = false;
    resetGrabFields();
    $('input-url').value = url;
    let pickedName = usableFileName(fileName) || suggestFileName(url);
    if (pickedName && !/\.[a-z0-9]{1,8}$/i.test(pickedName)) {
      const urlExt = (suggestFileName(url).match(/\.([a-z0-9]{1,8})$/i) || [])[1];
      if (urlExt) pickedName = `${pickedName}.${urlExt}`;
    }
    $('input-filename').value = pickedName;
    applyDetectedKind(fileName, url, size);
    const audioBytes = Number(data.audioSize) || 0;
    if (audioBytes && $('dl-size')) {
      const shown = (Number(size) || 0) + audioBytes;
      if (shown) $('dl-size').textContent = formatSize(shown);
    }
    knownDuration = Number(duration) || 0;
    if (knownDuration > 0 && $('dl-duration')) $('dl-duration').textContent = formatTime(knownDuration);

    if ($('url-group')) $('url-group').style.display = '';

    const resolvedFile = !!(url && fileName && isPageGrab !== true);
    const shouldGrab = !resolvedFile && (autoGrab || isGrabSite(url));
    if (shouldGrab) {
      if ($('btn-grab-url')) $('btn-grab-url').style.display = 'none';
      await extractGrab(false);
    } else if ($('btn-grab-url')) {
      $('btn-grab-url').style.display = 'inline-block';
    }
  }
  if ($('remember-path')) {
    $('remember-path').checked = zdmSettings?.library?.rememberLastFolder !== false;
  }
  paintRememberLabel();
  fitWindow();
  } catch {
    fitWindow();
  }
}

init();
})();
