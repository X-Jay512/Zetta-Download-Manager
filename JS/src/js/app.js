if (!window.zdm) {
  document.body.innerHTML = `
    <div style="padding:40px;color:#ff5252;font-family:monospace;background:#111;height:100vh;">
      <h2>ZDM - Bridge Error</h2>
      <p style="color:#ccc;margin-top:12px;">The preload bridge failed to load.<br>
      Make sure you launched via <b>Start-ZDM.bat</b> (not from VS Code terminal).</p>
    </div>`;
  throw new Error('zdm bridge not available');
}

const EXT_TO_TYPE = {
  '.mp4': 'video', '.mkv': 'video', '.avi': 'video', '.mov': 'video', '.webm': 'video', '.flv': 'video',
  '.mp3': 'music', '.flac': 'music', '.wav': 'music', '.aac': 'music', '.ogg': 'music',
  '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive', '.gz': 'archive',
  '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.txt': 'document', '.xls': 'document',
  '.exe': 'program', '.msi': 'program', '.dmg': 'program',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
};

const state = {
  downloads: [],
  selectedIds: new Set(),
  lastSelectedId: null,
  activeCategory: 'all',
  sortConfig: { col: null, asc: true }
};
window.zdmState = state;

function listedBytes(dl) {
  const progress = dl.progress || {};
  const live = Number(progress.total) || 0;
  if (live > 0) return live;
  return (Number(dl.fileSize) || 0) + (Number(dl.audioSize) || 0);
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0) + ' ' + units[i];
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '—';
  return formatSize(bps) + '/s';
}

function formatTime(seconds) {
  if (!seconds || seconds === Infinity || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return '—';
  if (s < 60) return s + ' sec';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return m + ' min ' + rem + ' sec';
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return mins ? h + ' h ' + mins + ' min' : h + ' h';
}

function formatAdded(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function getFileType(fileName) {
  const ext = '.' + (fileName || '').split('.').pop().toLowerCase();
  return EXT_TO_TYPE[ext] || 'other';
}

const shellIconCache = new Map();
const shellIconPending = new Set();

function shellExt(fileName) {
  const raw = String(fileName || '');
  const dot = raw.lastIndexOf('.');
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : '';
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

function iconCacheKey(dl) {
  return `ext:${shellExt(dl.fileName || dl.path)}`;
}

function requestShellIcon(dl) {
  const key = iconCacheKey(dl);
  if (shellIconCache.has(key) || shellIconPending.has(key)) return;
  shellIconPending.add(key);
  const pending = window.zdm.invoke('shell:file-icon', { fileName: dl.fileName || dl.path || 'file.bin' });
  if (!pending || typeof pending.then !== 'function') {
    shellIconPending.delete(key);
    return;
  }
  pending.then((url) => {
    shellIconCache.set(key, url || '');
    shellIconPending.delete(key);
    document.querySelectorAll('.shell-icon').forEach((img) => {
      if (img.dataset.key === key && url) img.src = url;
    });
  }).catch(() => {
    shellIconCache.set(key, '');
    shellIconPending.delete(key);
  });
}

function statusLabel(status) {
  if (status === 'complete') return 'Complete';
  if (status === 'downloading') return 'Downloading';
  if (status === 'paused') return 'Paused';
  if (status === 'queued') return 'Queued';
  if (status === 'error') return 'Failed';
  if (status === 'merging' || status === 'muxing') return 'Assembling';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '';
}

function queueCell(dl) {
  const queue = window.zdmScheduler && window.zdmScheduler.queueOf(dl.id);
  if (!queue) return '<div class="col q-col"></div>';
  const title = String(queue.name || 'Queue').replace(/"/g, '&quot;');
  if (queue.id === 'main') return `<div class="col q-col" title="${title}"><img class="q-cell-icon" src="assets/ui/main-queues.png" alt=""></div>`;
  if (queue.id === 'sync') return `<div class="col q-col" title="${title}"><img class="q-cell-icon" src="assets/ui/sync.png" alt=""></div>`;
  const customs = (window.zdmScheduler.listQueues ? window.zdmScheduler.listQueues() : []).filter((item) => item.kind === 'custom');
  const index = Math.max(0, customs.findIndex((item) => item.id === queue.id));
  const mark = window.zdmScheduler.queueNumberHtml
    ? window.zdmScheduler.queueNumberHtml(index + 1)
    : `<span class="q-num">${index + 1}</span>`;
  return `<div class="col q-col" title="${title}">${mark}</div>`;
}

function renderDownloadRow(dl) {
  const progress = dl.progress || {};
  const div = document.createElement('div');
  div.className = `download-row${state.selectedIds.has(dl.id) ? ' selected' : ''}${dl.status === 'downloading' ? ' downloading' : ''}`;
  div.dataset.id = dl.id;
  const iconKey = iconCacheKey(dl);

  const pct = progress.percent != null ? progress.percent : null;
  const showBar = dl.status === 'downloading' || dl.status === 'merging' || dl.status === 'paused' || dl.status === 'muxing';
  const barClass = dl.status === 'paused' ? 'bar-paused' : (dl.status === 'muxing' || dl.status === 'merging') ? 'bar-muxing' : 'bar-downloading';
  const statusText = pct != null && showBar ? `${pct}% ${statusLabel(dl.status)}` : statusLabel(dl.status);
  const statusCell = showBar
    ? `<div class="col status-cell">
        <span class="status-text ${dl.status}">${statusText}</span>
        <div class="status-bar"><div class="status-bar-fill ${barClass}" style="width:${pct || 0}%"></div></div>
       </div>`
    : `<div class="col"><span class="status-badge ${dl.status}" title="${dl.status === 'error' ? String(dl.error || '').replace(/"/g, '&quot;') : ''}">${statusText}</span></div>`;

  div.innerHTML = `
    <div class="file-icon"><img class="shell-icon" alt=""></div>
    <div class="file-name-wrapper">
      <div class="file-name">${dl.fileName || 'Unknown'}</div>
    </div>
    ${queueCell(dl)}
    <div class="col size-cell">${dl.duration > 0 ? formatDuration(dl.duration) : formatSize(listedBytes(dl))}</div>
    ${statusCell}
    <div class="col speed">${dl.status === 'downloading' || dl.status === 'merging' ? formatSpeed(progress.speed) : ''}</div>
    <div class="col eta-cell">${dl.status === 'downloading' || dl.status === 'merging' ? formatTime(progress.eta) : ''}</div>
    <div class="col">${formatAdded(dl.createdAt)}</div>
  `;

  const icon = div.querySelector('.shell-icon');
  icon.dataset.key = iconKey;
  const cachedIcon = shellIconCache.get(iconKey);
  if (cachedIcon) icon.src = cachedIcon;
  else requestShellIcon(dl);

  div.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (state.selectedIds.has(dl.id)) state.selectedIds.delete(dl.id);
      else state.selectedIds.add(dl.id);
      state.lastSelectedId = dl.id;
    } else if (e.shiftKey && state.lastSelectedId) {
      const list = Array.from(document.querySelectorAll('.download-row')).map(r => r.dataset.id);
      const start = list.indexOf(state.lastSelectedId);
      const end = list.indexOf(dl.id);
      const [min, max] = [Math.min(start, end), Math.max(start, end)];
      state.selectedIds.clear();
      for (let i = min; i <= max; i++) {
        if (list[i]) state.selectedIds.add(list[i]);
      }
    } else {
      state.selectedIds.clear();
      state.selectedIds.add(dl.id);
      state.lastSelectedId = dl.id;
    }
    renderList();
  });

  div.addEventListener('dblclick', () => {
    const current = state.downloads.find(d => d.id === dl.id) || dl;
    if (current.status === 'complete' && current.path) {
      window.zdm.send('download:open-file', current.path);
    } else {
      window.zdm.send('progress:open', current.id);
    }
  });

  return div;
}

function findDownloadRow(id) {
  const list = document.getElementById('download-list');
  if (!list) return null;
  const want = String(id);
  const rows = list.children;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].dataset && rows[i].dataset.id === want) return rows[i];
  }
  return null;
}

function patchDownloadRow(dl) {
  const row = findDownloadRow(dl.id);
  if (!row) return false;
  const progress = dl.progress || {};
  const pct = progress.percent != null ? progress.percent : 0;
  const showBar = dl.status === 'downloading' || dl.status === 'merging' || dl.status === 'paused' || dl.status === 'muxing';
  if (showBar !== !!row.querySelector('.status-bar')) return false;
  row.classList.toggle('selected', state.selectedIds.has(dl.id));
  row.classList.toggle('downloading', dl.status === 'downloading');
  const sizeEl = row.querySelector('.size-cell');
  if (sizeEl) {
    const sizeText = dl.duration > 0 ? formatDuration(dl.duration) : formatSize(listedBytes(dl));
    if (sizeEl.textContent !== sizeText) sizeEl.textContent = sizeText;
  }
  if (showBar) {
    const barClass = dl.status === 'paused' ? 'bar-paused' : (dl.status === 'muxing' || dl.status === 'merging') ? 'bar-muxing' : 'bar-downloading';
    const statusText = `${pct}% ${statusLabel(dl.status)}`;
    const textEl = row.querySelector('.status-text');
    const fill = row.querySelector('.status-bar-fill');
    if (textEl) {
      const nextClass = `status-text ${dl.status}`;
      if (textEl.className !== nextClass) textEl.className = nextClass;
      if (textEl.textContent !== statusText) textEl.textContent = statusText;
    }
    if (fill) {
      const nextClass = `status-bar-fill ${barClass}`;
      if (fill.className !== nextClass) fill.className = nextClass;
      const width = `${pct || 0}%`;
      if (fill.style.width !== width) fill.style.width = width;
    }
  }
  const speedEl = row.querySelector('.speed');
  const speedText = dl.status === 'downloading' || dl.status === 'merging' ? formatSpeed(progress.speed) : '';
  if (speedEl && speedEl.textContent !== speedText) speedEl.textContent = speedText;
  const etaEl = row.querySelector('.eta-cell');
  const etaText = dl.status === 'downloading' || dl.status === 'merging' ? formatTime(progress.eta) : '';
  if (etaEl && etaEl.textContent !== etaText) etaEl.textContent = etaText;
  return true;
}

const pendingPaintIds = new Set();
let paintQueued = false;

function scheduleRowPaint(id) {
  pendingPaintIds.add(id);
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const ids = [...pendingPaintIds];
    pendingPaintIds.clear();
    let missing = false;
    for (const pid of ids) {
      const dl = state.downloads.find((item) => item.id === pid);
      if (!dl || !patchDownloadRow(dl)) missing = true;
    }
    if (missing) renderList(false);
    updateStatusBar();
    updateToolbar();
  });
}

function renderList(paintTheme) {
  const list = document.getElementById('download-list');
  const filtered = filterByCategory(state.downloads, state.activeCategory);

  if (state.sortConfig.col) {
    filtered.sort((a, b) => {
      let valA, valB;
      switch(state.sortConfig.col) {
        case 'fileName': 
          valA = a.fileName?.toLowerCase() || ''; valB = b.fileName?.toLowerCase() || ''; 
          break;
        case 'size': 
          valA = listedBytes(a); valB = listedBytes(b); 
          break;
        case 'status': 
          valA = a.status; valB = b.status; 
          break;
        case 'speed': 
          valA = a.progress?.speed || 0; valB = b.progress?.speed || 0; 
          break;
        case 'time': 
          valA = a.progress?.eta || Infinity; valB = b.progress?.eta || Infinity; 
          break;
        case 'progress': 
          valA = a.progress?.percent || 0; valB = b.progress?.percent || 0; 
          break;
        case 'tried':
          valA = Date.parse(a.createdAt) || 0;
          valB = Date.parse(b.createdAt) || 0;
          break;
      }
      if (valA < valB) return state.sortConfig.asc ? -1 : 1;
      if (valA > valB) return state.sortConfig.asc ? 1 : -1;
      return 0;
    });
  }

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state" id="empty-state" style="display: flex;">
        <img class="empty-icon" src="assets/ui/download.png" alt="">
        <p>No downloads yet — press Add URL or install the browser extension</p>
      </div>`;
  } else {
    filtered.forEach(dl => list.appendChild(renderDownloadRow(dl)));
  }
  if (paintTheme !== false && window.zdmTheme) window.zdmTheme.paint();
  updateStatusBar();
  updateToolbar();
}

function getPlaylistKey(url) {
  if (!url) return '';
  const str = String(url).trim();
  const match = str.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) return 'yt:' + match[1];
  return str.split('#')[0].replace(/\/+$/, '');
}

function isPlaylistDownload(item, pUrl) {
  if (!item) return false;
  const itemPlaylistKey = getPlaylistKey(item.playlistUrl);
  const itemSourceKey = getPlaylistKey(item.sourcePage);

  if (pUrl) {
    const targetKey = getPlaylistKey(pUrl);
    if (targetKey) {
      if (itemPlaylistKey && itemPlaylistKey === targetKey) return true;
      if (itemSourceKey && itemSourceKey === targetKey) return true;
    }
    return false;
  }

  if (item.playlistUrl) return true;
  const list = state.savedPlaylists || [];
  if (list.length > 0) {
    const keys = new Set(list.map((p) => getPlaylistKey(p.url)).filter(Boolean));
    if (itemPlaylistKey && keys.has(itemPlaylistKey)) return true;
    if (itemSourceKey && keys.has(itemSourceKey)) return true;
  }
  return false;
}

function filterByCategory(downloads, cat) {
  if (cat === 'all') return downloads;
  if (cat === 'queues' && window.zdmScheduler) {
    return downloads.filter((item) => window.zdmScheduler.queueOf(item.id));
  }
  if (cat && cat.startsWith('queue_') && window.zdmScheduler) {
    const queueId = cat.slice('queue_'.length);
    return downloads.filter((item) => window.zdmScheduler.queueOf(item.id)?.id === queueId);
  }
  if (cat === 'playlists') {
    return downloads.filter((item) => isPlaylistDownload(item));
  }
  if (cat && cat.startsWith('playlist_')) {
    const pUrl = cat.slice('playlist_'.length);
    return downloads.filter((item) => isPlaylistDownload(item, pUrl));
  }
  if (!cat || cat === 'grabber') return [];
  
  let target = downloads;
  if (cat.startsWith('unfinished')) {
    target = target.filter(d => d.status !== 'complete');
  } else if (cat.startsWith('finished')) {
    target = target.filter(d => d.status === 'complete');
  }
  
  const sub = cat.split('_')[1];
  if (!sub) return target;
  
  return target.filter(d => {
    const type = getFileType(d.fileName);
    const catMap = { compressed: 'archive', documents: 'document', programs: 'program', images: 'image' };
    return type === (catMap[sub] || sub);
  });
}

window.refreshZdmStatus = updateStatusBar;

function updateStatusBar() {
  const allBadge = document.getElementById('badge-all');
  if (allBadge) allBadge.textContent = state.downloads.length;
}

function selectAll() {
  const visible = filterByCategory(state.downloads, state.activeCategory);
  if (!visible.length) return;
  state.selectedIds.clear();
  visible.forEach((d) => state.selectedIds.add(d.id));
  state.lastSelectedId = visible[visible.length - 1].id;
  document.querySelectorAll('.download-row').forEach((row) => {
    row.classList.add('selected');
  });
  updateToolbar();
}

function selectedDownloads() {
  return [...state.selectedIds]
    .map((id) => state.downloads.find((d) => d.id === id))
    .filter(Boolean);
}

function setToolbarEnabled(id, enabled) {
  const btn = $(id);
  if (!btn) return;
  btn.disabled = !enabled;
}

function updateToolbar() {
  const selected = selectedDownloads();
  const canResume = selected.some((d) => d.status === 'paused' || d.status === 'error' || d.status === 'queued');
  const canStop = selected.some((d) => d.status === 'downloading' || d.status === 'merging');
  const canStopAll = state.downloads.some((d) => d.status === 'downloading' || d.status === 'merging');
  const canStartQueue = state.downloads.some((d) => d.status === 'paused' || d.status === 'error' || d.status === 'queued');
  const canDelete = selected.length > 0;
  const only = selected.length === 1 ? selected[0] : null;
  const canOpenFolder = !!(only && only.status === 'complete' && only.path);
  setToolbarEnabled('btn-resume', canResume);
  setToolbarEnabled('btn-stop', canStop);
  setToolbarEnabled('btn-stop-all', canStopAll);
  setToolbarEnabled('btn-start-queue', canStartQueue);
  setToolbarEnabled('btn-stop-queue', canStopAll);
  setToolbarEnabled('btn-delete', canDelete);
  setToolbarEnabled('btn-open-folder', canOpenFolder);
  if (!canDelete) {
    const menu = $('delete-menu');
    if (menu) menu.classList.remove('visible');
  }
}

function $(id) { return document.getElementById(id); }

document.querySelector('.sidebar-tree').addEventListener('click', (e) => {
  const dlBtn = e.target.closest('.playlist-dl-btn');
  if (dlBtn) {
    e.stopPropagation();
    const pItem = dlBtn.closest('.tree-item');
    if (pItem && pItem.dataset.playlistUrl) {
      window.zdm.send('window:open-playlist', pItem.dataset.playlistUrl);
    }
    return;
  }

  const item = e.target.closest('.tree-item');
  if (!item) return;

  if (e.target.classList.contains('caret')) {
    item.classList.toggle('collapsed');
    const children = item.id === 'playlists-toggle' ? $('playlist-tree') : item.nextElementSibling;
    if (children && children.classList.contains('tree-children')) {
      children.style.display = item.classList.contains('collapsed') ? 'none' : 'flex';
    }
    return;
  }

  if (item.id === 'playlists-toggle' && item.classList.contains('collapsed')) {
    item.classList.remove('collapsed');
    const children = $('playlist-tree');
    if (children) children.style.display = 'flex';
  }

  document.querySelectorAll('.tree-item').forEach((row) => row.classList.remove('active'));
  item.classList.add('active');
  state.activeCategory = item.dataset.category;
  if (window.zdmTheme) window.zdmTheme.paint();
  renderList();
});

const SORT_COLUMNS = ['fileName', 'size', 'status', 'speed', 'time', 'tried', 'progress'];

function paintSortIcons() {
  document.querySelectorAll('.sort-icon').forEach((icon) => { icon.textContent = ''; });
  if (!state.sortConfig.col) return;
  const icon = document.querySelector(`.download-list-header [data-sort="${state.sortConfig.col}"] .sort-icon`);
  if (icon) icon.textContent = state.sortConfig.asc ? ' ▲' : ' ▼';
}

function saveSort() {
  window.zdm.invoke('settings:update', {
    list: { sortCol: state.sortConfig.col, sortAsc: !!state.sortConfig.asc },
  }).catch(() => {});
}

// Sorting behavior: descending, then ascending, then the program's original order.
document.querySelectorAll('.download-list-header .sortable').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('resizer')) return;

    const col = el.dataset.sort;
    if (state.sortConfig.col !== col) {
      state.sortConfig.col = col;
      state.sortConfig.asc = false;
    } else if (!state.sortConfig.asc) {
      state.sortConfig.asc = true;
    } else {
      state.sortConfig.col = null;
      state.sortConfig.asc = true;
    }

    paintSortIcons();
    renderList();
    saveSort();
  });
});

// Column Resizing
let isResizing = false;
let startX, startWidth;
let activeColVar = null;

document.querySelectorAll('.resizer').forEach(resizer => {
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    activeColVar = `--col-${resizer.dataset.col}`;
    startWidth = resizer.parentElement.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    e.stopPropagation();
  });
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newWidth = Math.max(40, startWidth + (e.clientX - startX));
  document.documentElement.style.setProperty(activeColVar, `${newWidth}px`);
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.querySelectorAll('.resizer').forEach(r => r.classList.remove('dragging'));
  }
});

const sidebarResizer = $('sidebar-resizer');
let sidebarDrag = null;
if (sidebarResizer) {
  sidebarResizer.addEventListener('mousedown', (e) => {
    const sidebar = sidebarResizer.parentElement;
    sidebarDrag = { startX: e.clientX, startW: sidebar.getBoundingClientRect().width };
    sidebarResizer.classList.add('dragging');
    e.preventDefault();
    e.stopPropagation();
  });
}

document.addEventListener('mousemove', (e) => {
  if (!sidebarDrag) return;
  const width = Math.max(160, Math.min(420, sidebarDrag.startW + (e.clientX - sidebarDrag.startX)));
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
});

document.addEventListener('mouseup', () => {
  if (!sidebarDrag) return;
  sidebarDrag = null;
  if (sidebarResizer) sidebarResizer.classList.remove('dragging');
});



$('btn-add-url').addEventListener('click', () => {
  window.zdm.send('window:open-address-dialog');
});

function closeDeleteMenu() {
  const menu = $('delete-menu');
  if (menu) menu.classList.remove('visible');
}

function forgetSelected() {
  state.downloads = state.downloads.filter((d) => !state.selectedIds.has(d.id));
  state.selectedIds.clear();
  state.lastSelectedId = null;
  renderList();
}

function applyDeleteChoice(deleteFiles) {
  const ids = [...state.selectedIds];
  closeDeleteMenu();
  if (!ids.length) return;
  const n = ids.length;
  const label = n === 1 ? 'download' : 'downloads';
  const msg = deleteFiles
    ? `Delete ${n} ${label} and the files on disk?`
    : `Remove ${n} ${label} from the list? The files stay on disk.`;
  const ask = !window.zdmSettings || window.zdmSettings.behavior?.confirmDelete !== false;
  if (ask && !confirm(msg)) return;
  ids.forEach((id) => window.zdm.send('download:remove', { id, deleteFiles }));
  forgetSelected();
}

function openDeleteMenu() {
  const menu = $('delete-menu');
  const btn = $('btn-delete');
  if (!menu || !btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.classList.add('visible');
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth) {
    menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
  }
}

$('btn-resume').addEventListener('click', () => {
  if ($('btn-resume').disabled) return;
  selectedDownloads()
    .filter((d) => d.status === 'paused' || d.status === 'error' || d.status === 'queued')
    .forEach((d) => {
      d.status = 'downloading';
      scheduleRowPaint(d.id);
      window.zdm.send('download:resume', d.id);
    });
  updateToolbar();
});

$('btn-stop').addEventListener('click', () => {
  if ($('btn-stop').disabled) return;
  selectedDownloads()
    .filter((d) => d.status === 'downloading' || d.status === 'merging')
    .forEach((d) => {
      d.status = 'paused';
      scheduleRowPaint(d.id);
      window.zdm.send('download:pause', d.id);
    });
  updateToolbar();
});

$('btn-delete').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('btn-delete').disabled) return;
  const menu = $('delete-menu');
  if (menu && menu.classList.contains('visible')) closeDeleteMenu();
  else openDeleteMenu();
});

$('btn-open-folder').addEventListener('click', () => {
  if ($('btn-open-folder').disabled) return;
  const dl = selectedDownloads()[0];
  if (!dl || dl.status !== 'complete' || !dl.path) return;
  window.zdm.send('download:open-folder', dl.path);
});

$('btn-stop-all').addEventListener('click', () => {
  if ($('btn-stop-all').disabled) return;
  window.zdmScheduler?.stopAllQueues?.();
  state.downloads.filter(d => d.status === 'downloading' || d.status === 'merging').forEach(d => {
    d.status = 'paused';
    scheduleRowPaint(d.id);
    window.zdm.send('download:pause', d.id);
  });
  updateToolbar();
});

$('btn-options').addEventListener('click', () => {
  window.zdm.send('window:open-settings');
});

$('btn-scheduler').addEventListener('click', () => window.zdmScheduler?.open());
if ($('btn-extension-setup')) $('btn-extension-setup').addEventListener('click', () => window.zdm.send('window:open-extension-setup'));
function closeQueueMenus() {
  $('start-queue-menu').hidden = true;
  $('stop-queue-menu').hidden = true;
}

function queueHas(queueId, verb) {
  return state.downloads.some((item) => {
    const queue = window.zdmScheduler?.queueOf?.(item.id);
    if (!queue || queue.id !== queueId) return false;
    if (verb === 'Start') return item.status === 'paused' || item.status === 'error' || item.status === 'queued';
    return item.status === 'downloading' || item.status === 'merging';
  });
}

function openQueueMenu(menu, verb) {
  const open = menu.hidden;
  closeQueueMenus();
  if (!open) return;
  const queues = window.zdmScheduler?.listQueues?.() || [];
  menu.innerHTML = queues.map((queue) => {
    const ready = queueHas(queue.id, verb);
    const name = queue.name.replace(/[&<>]/g, '');
    return `<button type="button" data-queue="${queue.id}" ${ready ? '' : 'disabled'}>${verb} ${name}</button>`;
  }).join('');
  menu.hidden = false;
}

$('btn-start-queue').addEventListener('click', () => {
  if ($('btn-start-queue').disabled) return;
  const cat = state.activeCategory;
  const queueId = cat && cat.startsWith('queue_')
    ? (cat === 'queue_main' ? 'main' : cat === 'queue_sync' ? 'sync' : cat.slice(6))
    : 'main';
  window.zdmScheduler?.startNow(queueId);
});
$('btn-stop-queue').addEventListener('click', () => {
  if ($('btn-stop-queue').disabled) return;
  const cat = state.activeCategory;
  const queueId = cat && cat.startsWith('queue_')
    ? (cat === 'queue_main' ? 'main' : cat === 'queue_sync' ? 'sync' : cat.slice(6))
    : 'main';
  window.zdmScheduler?.stopNow(queueId);
});
$('btn-start-queue-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  openQueueMenu($('start-queue-menu'), 'Start');
});
$('btn-stop-queue-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  openQueueMenu($('stop-queue-menu'), 'Stop');
});
function runQueueMenu(e, verb) {
  e.stopPropagation();
  const btn = e.target.closest('button');
  if (!btn || btn.disabled || !btn.dataset.queue) return;
  if (verb === 'Start') window.zdmScheduler?.startNow(btn.dataset.queue);
  else window.zdmScheduler?.stopNow(btn.dataset.queue);
  closeQueueMenus();
}
$('start-queue-menu').addEventListener('click', (e) => runQueueMenu(e, 'Start'));
$('stop-queue-menu').addEventListener('click', (e) => runQueueMenu(e, 'Stop'));
document.addEventListener('click', (e) => {
  if (e.target.closest('.queue-menu')) return;
  closeQueueMenus();
});
if ($('btn-playlist')) $('btn-playlist').addEventListener('click', () => window.zdm.send('window:open-playlist'));

async function renderPlaylistTree() {
  const box = $('playlist-tree');
  if (!box) return;
  let saved = [];
  try { saved = await window.zdm.invoke('playlist:saved') || []; } catch { saved = []; }
  state.savedPlaylists = saved;
  box.replaceChildren();
  saved.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'tree-item';
    row.dataset.category = 'playlist_' + item.url;
    row.dataset.playlistUrl = item.url;
    if (state.activeCategory === row.dataset.category) {
      row.classList.add('active');
    }
    row.title = item.name || 'Playlist';
    row.innerHTML = '<button type="button" class="playlist-dl-btn" title="Open playlist dialog" aria-label="Open playlist"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.5M5 7l3 3 3-3M3 13.5h10"/></svg></button><span class="file-glyph"></span><span class="label"></span>';
    row.querySelector('.label').textContent = item.name || 'Playlist';
    box.appendChild(row);
  });
}
renderPlaylistTree();
if (window.zdm.on) window.zdm.on('playlists:changed', renderPlaylistTree);

const playlistMenu = $('playlist-context-menu');
let playlistMenuUrl = '';
document.querySelector('.sidebar-tree')?.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('#playlist-tree .tree-item');
  if (!item || !item.dataset.playlistUrl) return;
  e.preventDefault();
  e.stopPropagation();
  playlistMenuUrl = item.dataset.playlistUrl;
  if (!playlistMenu) return;
  playlistMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  playlistMenu.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
  playlistMenu.classList.add('visible');
});
document.addEventListener('click', (e) => {
  if (!playlistMenu || e.target.closest('#playlist-context-menu')) return;
  playlistMenu.classList.remove('visible');
});
playlistMenu?.addEventListener('click', (e) => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]');
  if (!act) return;
  playlistMenu.classList.remove('visible');
  if (act.dataset.act === 'open') {
    window.zdm.send('window:open-playlist', playlistMenuUrl);
  } else if (act.dataset.act === 'copy') {
    navigator.clipboard?.writeText(playlistMenuUrl).catch(() => {});
  } else if (act.dataset.act === 'delete') {
    window.zdm.invoke('playlist:remove', playlistMenuUrl).catch(() => {});
  }
});

window.zdm.on('download:progress', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (!dl || dl.status === 'paused' || dl.status === 'error') return;
  if (dl.status === 'complete' && data.status !== 'downloading' && (data.percent == null || data.percent === 100)) return;
  dl.status = (data.phase === 'merging' || data.status === 'merging' || data.status === 'muxing') ? 'merging' : 'downloading';
  dl.progress = data;
  if (data.duration) dl.duration = data.duration;
  scheduleRowPaint(dl.id);
  updateToolbar();
});

window.zdm.on('download:complete', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (dl) {
    dl.status = 'complete';
    dl.path = data.path;
    dl.fileName = data.path ? data.path.split(/[\\/]/).pop() : dl.fileName;
    renderList();
  }
});

async function hideCompleteSheet() {
  if ($('complete-dont-show') && $('complete-dont-show').checked) {
    try {
      const next = await window.zdm.invoke('settings:update', { behavior: { showCompleteDialog: false } });
      if (next) window.zdmSettings = next;
    } catch { /* ignore */ }
  }
  $('complete-dialog').classList.remove('visible');
}

if ($('btn-complete-open')) {
  $('btn-complete-open').addEventListener('click', () => {
    const p = $('complete-dialog').dataset.path;
    if (p) window.zdm.send('download:open-file', p);
    hideCompleteSheet();
  });
}
if ($('btn-complete-folder')) {
  $('btn-complete-folder').addEventListener('click', () => {
    const p = $('complete-dialog').dataset.path;
    if (p) window.zdm.send('download:open-folder', p);
    hideCompleteSheet();
  });
}
if ($('btn-complete-open-with')) {
  $('btn-complete-open-with').addEventListener('click', () => {
    const p = $('complete-dialog').dataset.path;
    if (p) window.zdm.send('download:open-with', p);
  });
}
if ($('btn-complete-close')) {
  $('btn-complete-close').addEventListener('click', hideCompleteSheet);
}
if ($('complete-dialog')) {
  $('complete-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'complete-dialog') hideCompleteSheet();
  });
}
if ($('duplicate-dialog')) {
  $('duplicate-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'duplicate-dialog') {
      $('duplicate-dialog').classList.remove('visible');
      pendingAddOpts = null;
    }
  });
}

window.zdm.on('download:metadata', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (dl) {
    if (data.fileName) dl.fileName = data.fileName;
    if (data.fileSize) dl.fileSize = data.fileSize;
    if (data.audioSize) dl.audioSize = data.audioSize;
    if (data.duration) dl.duration = data.duration;
    if (data.lastTriedAt) dl.lastTriedAt = data.lastTriedAt;
    renderList();
  }
});

window.zdm.on('download:error', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (dl) {
    dl.status = 'error';
    dl.error = data.error;
    dl.errorKind = data.errorKind || '';
    dl.errorTitle = data.errorTitle || 'Failed';
    renderList();
  }
});

window.zdm.on('download:reset', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (!dl) return;
  dl.status = 'queued';
  dl.error = '';
  dl.errorKind = '';
  dl.errorTitle = '';
  dl.resumable = false;
  dl.progress = { downloaded: 0, total: 0, speed: 0, percent: 0 };
  scheduleRowPaint(dl.id);
  updateToolbar();
});

window.zdm.on('download:paused', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (dl) {
    dl.status = 'paused';
    if (data && Number.isFinite(Number(data.savedPercent))) {
      dl.savedPercent = Number(data.savedPercent);
      dl.progress = Object.assign({}, dl.progress, { percent: dl.savedPercent, speed: 0, eta: null });
    }
    scheduleRowPaint(dl.id);
    updateToolbar();
  }
});

window.zdm.on('download:resumed', (data) => {
  const dl = state.downloads.find(d => d.id === data.id);
  if (dl) {
    dl.status = 'downloading';
    dl.error = '';
    dl.errorKind = '';
    dl.errorTitle = '';
    if (data.redownload) {
      dl.downloaded = 0;
      dl.percent = 0;
      dl.savedPercent = 0;
      dl.progress = { downloaded: 0, total: dl.fileSize || 0, percent: 0, speed: 0, eta: null };
    }
    if (data.lastTriedAt) dl.lastTriedAt = data.lastTriedAt;
    scheduleRowPaint(dl.id);
    updateToolbar();
  }
});

window.zdm.on('download:added', (data) => {
  if (!state.downloads.find(d => d.id === data.id)) {
    state.downloads.push(data);
    renderList();
  }
});

window.zdm.on('download:removed', (data) => {
  const ids = new Set((data && data.ids) || []);
  if (!ids.size) return;
  state.downloads = state.downloads.filter((item) => !ids.has(item.id));
  renderList();
});

window.zdm.on('queue:start-all', () => {
  state.downloads
    .filter((d) => d.status === 'paused' || d.status === 'error' || d.status === 'queued')
    .forEach((d) => {
      d.status = 'downloading';
      scheduleRowPaint(d.id);
      window.zdm.send('download:resume', d.id);
    });
  updateToolbar();
});

window.zdm.on('queue:stop-all', () => {
  window.zdmScheduler?.stopAllQueues?.();
  state.downloads
    .filter((d) => d.status === 'downloading' || d.status === 'merging')
    .forEach((d) => {
      d.status = 'paused';
      scheduleRowPaint(d.id);
      window.zdm.send('download:pause', d.id);
    });
  updateToolbar();
});

async function init() {
  const allDownloads = await window.zdm.invoke('category:get-downloads', 'all');
  if (allDownloads && Array.isArray(allDownloads)) {
    state.downloads = allDownloads;
  }
  try {
    const settings = await window.zdm.invoke('settings:get');
    window.zdmSettings = settings;
    const savePath = settings?.library?.defaultPath || settings?.general?.defaultSavePath;
    if (savePath) $('input-save-path').value = savePath;
    const savedCol = settings?.list?.sortCol;
    if (SORT_COLUMNS.includes(savedCol)) {
      state.sortConfig.col = savedCol;
      state.sortConfig.asc = settings.list.sortAsc !== false;
      paintSortIcons();
    }
  } catch { /* keep placeholder */ }
  renderList();
  console.log('ZDM UI initialized successfully.');
}

const ctxMenu = $('row-context-menu');

document.addEventListener('click', () => {
  if (ctxMenu) ctxMenu.classList.remove('visible');
  closeDeleteMenu();
});

document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.download-row');
  if (row) {
    e.preventDefault();
    const id = row.dataset.id;
    if (!state.selectedIds.has(id)) {
      state.selectedIds.clear();
      state.selectedIds.add(id);
      state.lastSelectedId = id;
      renderList();
    }
    
    closeDeleteMenu();
    if (ctxMenu) {
      const selectedArr = Array.from(state.selectedIds).map(pid => state.downloads.find(d => d.id === pid)).filter(Boolean);
      const allComplete = selectedArr.every(d => d.status === 'complete');
      const allDownloading = selectedArr.every(d => d.status === 'downloading');
      
      $('ctx-open').classList.toggle('disabled', selectedArr.length !== 1 || !allComplete || !selectedArr[0].path);
      $('ctx-open-with').classList.toggle('disabled', selectedArr.length !== 1 || !allComplete || !selectedArr[0].path);
      $('ctx-open-folder').classList.toggle('disabled', selectedArr.length !== 1 || !allComplete || !selectedArr[0].path);
      $('ctx-resume').classList.toggle('disabled', allComplete || allDownloading);
      $('ctx-stop').classList.toggle('disabled', !selectedArr.some(d => d.status === 'downloading' || d.status === 'merging'));
      $('ctx-redownload').classList.toggle('disabled', false);
      if ($('ctx-select-all')) $('ctx-select-all').classList.toggle('disabled', filterByCategory(state.downloads, state.activeCategory).length === 0);
      if ($('ctx-properties')) $('ctx-properties').classList.toggle('disabled', selectedArr.length !== 1);
      const ids = selectedArr.map((d) => d.id);
      const choices = window.zdmScheduler?.queueChoices?.(ids) || [];
      const sub = $('ctx-queue-sub');
      if (sub) {
        const escName = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        sub.innerHTML = choices.map((q) => `<div class="menu-item" data-queue="${escName(q.id)}">${escName(q.name)}</div>`).join('')
          + '<div class="menu-item" data-queue="new">Create new queue</div>';
      }
      const inQueue = ids.some((id) => window.zdmScheduler?.queueOf?.(id));
      if ($('ctx-leave-queue')) $('ctx-leave-queue').classList.toggle('disabled', !inQueue); 
      
      ctxMenu.style.left = `${e.clientX}px`;
      ctxMenu.style.top = `${e.clientY}px`;
      ctxMenu.classList.add('visible');
      
      const rect = ctxMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        ctxMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
      }
      if (rect.bottom > window.innerHeight) {
        ctxMenu.style.top = `${window.innerHeight - rect.height - 5}px`;
      }
    }
  } else {
    if (ctxMenu) ctxMenu.classList.remove('visible');
  }
});

// Configure context menu actions
if (ctxMenu) {
  $('ctx-open').addEventListener('click', () => {
    if (state.selectedIds.size === 1) {
      const dl = state.downloads.find(d => d.id === Array.from(state.selectedIds)[0]);
      if (dl && dl.status === 'complete' && dl.path) window.zdm.send('download:open-file', dl.path);
    }
  });
  $('ctx-open-folder').addEventListener('click', () => {
    if (state.selectedIds.size === 1) {
      const dl = state.downloads.find(d => d.id === Array.from(state.selectedIds)[0]);
      if (dl && dl.status === 'complete' && dl.path) window.zdm.send('download:open-folder', dl.path);
    }
  });
  $('ctx-resume').addEventListener('click', () => {
    state.selectedIds.forEach((id) => {
      const dl = state.downloads.find((d) => d.id === id);
      if (dl && (dl.status === 'paused' || dl.status === 'error' || dl.status === 'queued')) {
        dl.status = 'downloading';
        scheduleRowPaint(dl.id);
      }
      window.zdm.send('download:resume', id);
    });
    updateToolbar();
  });
  $('ctx-stop').addEventListener('click', () => {
    state.selectedIds.forEach((id) => {
      const dl = state.downloads.find((d) => d.id === id);
      if (dl && (dl.status === 'downloading' || dl.status === 'merging')) {
        dl.status = 'paused';
        scheduleRowPaint(dl.id);
      }
      window.zdm.send('download:pause', id);
    });
    updateToolbar();
  });
  if ($('ctx-select-all')) {
    $('ctx-select-all').addEventListener('click', () => {
      selectAll();
      ctxMenu.classList.remove('visible');
    });
  }
  if ($('ctx-queue-sub')) {
    $('ctx-queue-sub').addEventListener('click', (e) => {
      const item = e.target.closest('[data-queue]');
      if (!item) return;
      e.stopPropagation();
      const ids = [...state.selectedIds];
      if (item.dataset.queue === 'new') {
        const name = prompt('Queue name');
        if (!name || !name.trim()) return;
        const created = window.zdmScheduler.createQueue(name.trim());
        window.zdmScheduler.assign(ids, created.id);
      } else {
        window.zdmScheduler.assign(ids, item.dataset.queue);
      }
      ctxMenu.classList.remove('visible');
    });
  }
  if ($('ctx-leave-queue')) {
    $('ctx-leave-queue').addEventListener('click', () => {
      if ($('ctx-leave-queue').classList.contains('disabled')) return;
      window.zdmScheduler.removeFromQueue([...state.selectedIds]);
    });
  }
  $('ctx-remove').addEventListener('click', () => {
    const ask = !window.zdmSettings || window.zdmSettings.behavior?.confirmDelete !== false;
    if (state.selectedIds.size > 0 && (!ask || confirm(`Remove ${state.selectedIds.size} downloads?`))) {
      state.selectedIds.forEach(id => window.zdm.send('download:remove', id));
      state.downloads = state.downloads.filter(d => !state.selectedIds.has(d.id));
      state.selectedIds.clear();
      renderList();
    }
  });
  if ($('ctx-redownload')) {
    $('ctx-redownload').addEventListener('click', () => {
      state.selectedIds.forEach(id => {
        const dl = state.downloads.find(d => d.id === id);
        if (dl) {
          dl.status = 'downloading';
          dl.downloaded = 0;
          dl.percent = 0;
          dl.savedPercent = 0;
          dl.progress = { downloaded: 0, total: dl.fileSize || 0, percent: 0, speed: 0, eta: null };
          window.zdm.send('download:redownload', id);
        }
      });
      renderList();
    });
  }
  if ($('ctx-properties')) {
    $('ctx-properties').addEventListener('click', () => {
      if (state.selectedIds.size === 1) {
        const dl = state.downloads.find(d => d.id === Array.from(state.selectedIds)[0]);
        if (dl) window.zdm.send('window:open-properties', dl);
      }
    });
  }
}

const deleteMenu = $('delete-menu');
if (deleteMenu) {
  deleteMenu.addEventListener('click', (e) => e.stopPropagation());
  $('delete-menu-delete').addEventListener('click', () => applyDeleteChoice(true));
  $('delete-menu-remove').addEventListener('click', () => applyDeleteChoice(false));
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if ($('complete-dialog') && $('complete-dialog').classList.contains('visible')) return;
    e.preventDefault();
    selectAll();
  }
});

const dlList = document.getElementById('download-list');
if (dlList) {
  dlList.addEventListener('click', (e) => {
    if (e.target === dlList || e.target.id === 'empty-state' || e.target.closest('#empty-state')) {
      state.selectedIds.clear();
      state.lastSelectedId = null;
      document.querySelectorAll('.download-row').forEach((row) => row.classList.remove('selected'));
      updateToolbar();
    }
  });
}

init();
