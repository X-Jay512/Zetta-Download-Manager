(function () {
const zdm = window.zdm;
const id = new URLSearchParams(location.search).get('id');
const $ = (name) => document.getElementById(name);

let record = null;
let filePath = '';
let finished = false;
let detailsOpen = true;
let tab = 'status';

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / Math.pow(1024, i);
  return (i === 0 ? String(Math.round(n)) : n.toFixed(3)) + ' ' + units[i];
}

function formatBytesPair(bytes) {
  const n = Math.max(0, Math.round(bytes || 0));
  if (n >= 1024 * 1024) return formatSize(n);
  return n.toLocaleString() + ' Bytes';
}

function formatTime(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return s + ' sec';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return m + ' min ' + rem + ' sec';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

function statusText() {
  if (!record) return 'Downloading';
  if (record.status === 'paused') return 'Pause';
  if (record.status === 'complete') return 'Complete';
  if (record.status === 'error') {
    if (record.errorTitle && record.error) return `${record.errorTitle}. ${record.error}`;
    return record.errorTitle || record.error || 'Failed';
  }
  if (record.status === 'queued') return 'Waiting';
  if (record.status === 'merging' || record.status === 'muxing') return 'Assembling';
  return 'Downloading';
}

function segSpan(segment) {
  if (!segment || !Number.isFinite(segment.end)) return 0;
  return Math.max(0, segment.end - segment.start + 1);
}

function segGot(segment) {
  return Math.max(0, segment.downloaded || 0);
}

function infoText(segment) {
  if (!segment) return '';
  if (segment.status === 'error') return 'Disconnect.';
  if (segment.status === 'complete') return 'Complete';
  if (segment.status === 'paused' || (record && record.status === 'paused' && segment.status !== 'complete')) return 'Pause';
  if (segment.status === 'merging' || segment.status === 'muxing') return 'Assembling';
  if (segment.status === 'downloading') return 'Downloading';
  if (segment.status === 'connecting') return 'Connecting';
  return '';
}

function partLive(segment) {
  if (!segment) return false;
  if (segGot(segment) > 0) return true;
  const status = segment.status;
  return status === 'connecting' || status === 'downloading' || status === 'complete' || status === 'paused' || status === 'error' || status === 'merging' || status === 'muxing';
}

let heldRows = [];
let rowCap = 0;

function foldToCap(list) {
  const cap = rowCap;
  if (!cap || !list.length || list.length <= cap) return list;
  const lanes = [];
  for (let i = 0; i < cap; i++) lanes.push({ downloaded: 0, status: 'waiting', busy: false });
  const weight = { downloading: 3, connecting: 2, paused: 1 };
  for (const seg of list) {
    const lane = lanes[(Number(seg.index) || 0) % cap];
    lane.downloaded += Math.max(0, Number(seg.downloaded) || 0);
    const rank = weight[seg.status] || 0;
    if (rank > (weight[lane.status] || 0)) {
      lane.status = seg.status;
      lane.busy = true;
    }
  }
  const busy = lanes.some((lane) => lane.busy);
  const total = Number(record && record.fileSize) || 0;
  const goal = total > 0 ? Math.ceil(total / cap) : 0;
  return lanes.map((lane, index) => ({
    index,
    start: 0,
    end: goal > 0 ? goal - 1 : null,
    downloaded: lane.downloaded,
    percent: goal > 0 ? Math.min(100, (lane.downloaded / goal) * 100) : 0,
    status: lane.busy ? lane.status : (lane.downloaded > 0 ? (busy ? 'downloading' : 'complete') : 'waiting'),
  }));
}

function renderConnections(segments) {
  const bar = $('segbar');
  const body = $('conn-body');
  const merging = (record && (record.status === 'merging' || record.status === 'muxing')) || (record && record.progress && (record.progress.phase === 'merging' || record.progress.status === 'merging' || record.progress.status === 'muxing'));

  if (merging) {
    heldRows = [];
    const whole = Number(record && record.progress && record.progress.total) || Number(record && record.fileSize) || 0;
    const written = Math.max(0, Number(record && record.progress && record.progress.downloaded) || 0);
    const pct = Number.isFinite(Number(record && record.progress && record.progress.percent))
      ? Number(record.progress.percent)
      : (whole > 0 ? Math.min(100, (written / whole) * 100) : 0);

    while (bar.children.length > 1) bar.removeChild(bar.lastElementChild);
    while (body.children.length > 1) body.removeChild(body.lastElementChild);

    let block = bar.children[0];
    if (!block) {
      block = document.createElement('div');
      block.className = 'seg';
      block.appendChild(document.createElement('span'));
      bar.appendChild(block);
    }
    block.style.flex = '1 1 0';
    const fill = block.firstElementChild;
    if (fill) fill.style.width = pct + '%';

    let tr = body.children[0];
    if (!tr || tr.children.length < 3) {
      tr = document.createElement('tr');
      tr.appendChild(document.createElement('td'));
      tr.appendChild(document.createElement('td'));
      tr.appendChild(document.createElement('td'));
      body.appendChild(tr);
    }
    if (tr.children[0].textContent !== '1') tr.children[0].textContent = '1';
    const bytesText = written > 0 ? formatBytesPair(written) : (whole > 0 ? '0 B' : '');
    if (tr.children[1].textContent !== bytesText) tr.children[1].textContent = bytesText;
    const info = 'Assembling';
    if (tr.children[2].textContent !== info) tr.children[2].textContent = info;
    $('details').hidden = !detailsOpen;
    return;
  }

  const incoming = foldToCap(Array.isArray(segments) ? segments : []);
  const meaningful = incoming.some((seg) => (Number(seg.downloaded) || 0) > 0 || seg.status === 'downloading' || seg.status === 'connecting' || seg.status === 'complete' || seg.status === 'paused' || seg.status === 'merging');
  if (meaningful) heldRows = incoming;
  else if (!heldRows.length && incoming.length) heldRows = incoming;
  const list = meaningful ? incoming : (heldRows.length ? heldRows : incoming);
  while (bar.children.length > list.length) bar.removeChild(bar.lastElementChild);
  while (body.children.length > list.length) body.removeChild(body.lastElementChild);
  list.forEach((segment, index) => {
    const span = segSpan(segment);
    const shown = segGot(segment);
    const got = span > 0 ? Math.min(span, shown) : shown;
    const given = Number(segment.percent);
    let segPct = Number.isFinite(given)
      ? Math.max(0, Math.min(100, given))
      : (span > 0 ? Math.max(0, Math.min(100, (got / span) * 100)) : 0);
    if (segment.status === 'complete') segPct = 100;
    const flex = span > 0 ? String(Math.max(1, Math.round(span))) : '1 1 0';
    let block = bar.children[index];
    if (!block) {
      block = document.createElement('div');
      block.className = 'seg';
      block.appendChild(document.createElement('span'));
      bar.appendChild(block);
    }
    const live = partLive(segment);
    if (block.style.flex !== flex) block.style.flex = flex;
    block.style.display = live ? '' : 'none';
    const width = live ? segPct + '%' : '0%';
    const fill = block.firstElementChild;
    if (fill && fill.style.width !== width) fill.style.width = width;

    let tr = body.children[index];
    if (!tr || tr.children.length < 3) {
      tr = document.createElement('tr');
      tr.appendChild(document.createElement('td'));
      tr.appendChild(document.createElement('td'));
      tr.appendChild(document.createElement('td'));
      body.appendChild(tr);
    }
    const number = String(index + 1);
    const status = segment.status;
    const bytes = live && shown > 0 ? formatBytesPair(shown) : '';
    const info = !live ? '' : (shown <= 0 && (status === 'connecting' || status === 'downloading') ? 'Connecting' : infoText(segment));
    if (tr.children[0].textContent !== number) tr.children[0].textContent = number;
    if (tr.children[1].textContent !== bytes) tr.children[1].textContent = bytes;
    if (tr.children[2].textContent !== info) tr.children[2].textContent = info;
  });
  if (!list.length && !body.children.length) {
    const tr = document.createElement('tr');
    tr.appendChild(document.createElement('td'));
    tr.appendChild(document.createElement('td'));
    tr.appendChild(document.createElement('td'));
    tr.children[0].textContent = '1';
    tr.children[1].textContent = '';
    tr.children[2].textContent = '';
    body.appendChild(tr);
  }
  $('details').hidden = !detailsOpen;
}


function listedBytes(progress) {
  if (!progress || !Array.isArray(progress.segments)) return 0;
  return progress.segments.reduce((sum, seg) => sum + Math.max(0, Number(seg.downloaded) || 0), 0);
}

function text(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

let coast = null;
let coastFrame = 0;

function paintMeter(pct) {
  const meter = Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
  const el = $('meter-fill');
  if (el && el.style.width !== meter) el.style.width = meter;
}

function armCoast(pct, speed, byteTotal, got) {
  const now = performance.now();
  let span = byteTotal > 0 ? byteTotal : 0;
  if (!(span > 0) && pct > 0.2 && got > 0) span = got / (pct / 100);
  if (!coast) coast = { shown: pct };
  if (pct > coast.shown) coast.shown = pct;
  coast.pct = pct;
  coast.speed = speed;
  coast.span = span;
  coast.sampleAt = now;
  const moving = !!(record && record.status === 'downloading' && speed >= 100 && span > 0);
  if (!moving || document.hidden) {
    if (coastFrame) cancelAnimationFrame(coastFrame);
    coastFrame = 0;
    coast.shown = pct;
    paintMeter(pct);
    return;
  }
  paintMeter(coast.shown);
  if (!coastFrame) coastFrame = requestAnimationFrame(coastStep);
}

function coastStep(now) {
  coastFrame = 0;
  if (document.hidden || !coast || !record || record.status !== 'downloading') return;
  const age = Math.min(0.12, Math.max(0, (now - coast.sampleAt) / 1000));
  let target = coast.pct;
  if (coast.speed >= 100 && coast.span > 0) {
    target = Math.min(99.9, coast.pct + (coast.speed * age / coast.span) * 100);
  }
  if (target > coast.shown) coast.shown = target;
  paintMeter(coast.shown);
  if (coast.speed >= 100) coastFrame = requestAnimationFrame(coastStep);
}

function render(progress) {
  progress = progress || {};
  if (record && record.status === 'queued') {
    const segs = progress.segments;
    const running = Array.isArray(segs) && segs.some((seg) => seg.status === 'connecting' || seg.status === 'downloading' || seg.status === 'complete' || (Number(seg.downloaded) || 0) > 0);
    if (running) record.status = 'downloading';
  }
  if ((progress.phase === 'merging' || progress.status === 'merging' || progress.status === 'muxing') && record && record.status !== 'paused' && record.status !== 'error' && record.status !== 'complete') {
    record.status = 'merging';
  }
  const name = (record && record.fileName) || 'Download';
  if (document.title !== name) document.title = name;
  text($('file-name'), name);
  $('file-name').title = name;
  text($('state'), statusText());

  const merging = progress.phase === 'merging' || progress.status === 'merging' || progress.status === 'muxing' || (record && (record.status === 'merging' || record.status === 'muxing'));
  const saved = record ? (Number(record.fileSize) || 0) + (Number(record.audioSize) || 0) : 0;
  const reported = Number(progress.total) || 0;
  const duration = Number(progress.duration) || Number(record && record.duration) || 0;
  if (duration > 0 && record) record.duration = duration;
  const total = reported || (duration > 0 ? 0 : saved) || 0;
  const got = merging
    ? Math.max(0, Number(progress.downloaded) || 0)
    : Math.max(Number(progress.downloaded) || 0, listedBytes(progress));
  let pct = merging && Number.isFinite(Number(progress.percent))
    ? Number(progress.percent)
    : (total > 0 ? (got / total) * 100 : (Number(progress.percent) || 0));
  if (record && record.status === 'complete') pct = 100;
  else if (pct >= 100) pct = 99.9;
  const speed = Number(progress.speed) || 0;
  const active = !!(record && (record.status === 'downloading' || record.status === 'merging' || record.status === 'connecting' || record.status === 'queued'));
  if (!(reported > 0) && duration > 0) {
    text($('size-label'), 'Duration');
    text($('file-size'), formatTime(duration));
  } else {
    text($('size-label'), 'File size');
    text($('file-size'), total > 0 ? formatSize(total) : '—');
  }
  text($('received-label'), merging ? 'Assembled' : 'Downloaded');
  const shownGot = got > 0 ? formatSize(got) : (merging ? '0 B' : formatSize(got));
  text($('received'), (merging || reported > 0 || pct > 0)
    ? shownGot + ' (' + pct.toFixed(2) + ' %)'
    : shownGot);
  const moving = speed >= 100;
  const rate = active && moving
    ? formatSize(speed) + '/sec'
    : '—';
  text($('speed'), rate);
  text($('limit-speed'), rate);
  let eta = moving ? progress.eta : null;
  if (moving && !(eta > 0) && total > got) eta = (total - got) / speed;
  text($('left'), active ? formatTime(eta) : '—');
  const savedPieces = Array.isArray(progress.segments) && progress.segments.some((segment) => (Number(segment.downloaded) || 0) > 0 && segment.end !== Infinity);
  text($('resume'), (record && record.resumable) || savedPieces ? 'Yes' : 'No');
  armCoast(pct, speed, reported > 0 ? reported : total, got);

  const save = (record && (record.path || record.savePath)) || '';
  if ($('save-to')) {
    $('save-to').textContent = save;
    $('save-to').title = save;
  }

  const caption = $('conn-caption');
  if (caption) caption.textContent = merging ? 'Assembling file' : 'Each connection';
  const customThreads = Number(record && record.customThreads) || 0;
  const capSource = customThreads > 0 ? customThreads : (Number(progress.connections) || Number(record && record.segments) || 0);
  rowCap = Math.max(0, Math.min(32, capSource));
  renderConnections(progress.segments);
  const done = record && record.status === 'complete';
  const canResume = !!(record && (record.resumable || record.duration > 0 || /\.m3u8|\.ts$/i.test(record.fileName || record.url || '')));
  const failed = record && record.status === 'error' && !canResume;
  const paused = record && (record.status === 'paused' || (record.status === 'error' && canResume));
  finished = !!(done || (record && record.status === 'error' && !canResume));
  const isPaused = !!(record && (record.status === 'paused' || (record.status === 'error' && canResume)));
  const fill = $('meter-fill');
  if (fill) fill.classList.toggle('paused', isPaused);
  const bar = document.querySelector('.bar');
  if (bar) bar.classList.toggle('paused', isPaused);
  $('btn-main').hidden = !!failed;
  $('btn-main').textContent = done ? 'Open' : (paused ? 'Resume' : 'Pause');
  $('btn-cancel').textContent = finished ? 'Close' : 'Cancel';
}

function fit() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const sheet = document.querySelector('.sheet');
      if (!sheet) return;
      const h = Math.ceil(sheet.getBoundingClientRect().height);
      if (h > 0 && zdm.invoke) zdm.invoke('progress:fit', h);
    });
  });
}

function showTab(next) {
  tab = next;
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === next);
  });
  $('panel-status').hidden = next !== 'status';
  $('panel-limit').hidden = next !== 'limit';
  $('panel-done').hidden = next !== 'done';
  fit();
}

function updatePowerAction() {
  const enabled = $('opt-power') && $('opt-power').checked;
  if ($('power-action')) $('power-action').disabled = !enabled;
}

function sendFinish() {
  zdm.send('progress:set-finish', {
    id,
    finish: {
      showDialog: $('show-dialog') ? $('show-dialog').checked : true,
      power: $('opt-power') ? $('opt-power').checked : false,
      action: $('power-action') ? $('power-action').value : 'shutdown',
    },
  });
}

let defaultThreads = 8;

function updateThreadNote() {
  const note = $('thread-note');
  if (!note) return;
  const val = Number($('thread-count') ? $('thread-count').value : 0) || 0;
  if (val <= 0) {
    note.textContent = `Use Global Settings (${defaultThreads})`;
  } else {
    note.textContent = `Custom (${val} threads)`;
  }
}

function sendThreads() {
  const val = Math.max(0, Math.min(32, Number($('thread-count') ? $('thread-count').value : 0) || 0));
  if (record) {
    record.customThreads = val;
    record.segments = val > 0 ? val : defaultThreads;
  }
  zdm.send('progress:set-threads', {
    id,
    threads: val,
  });
}

function sendLimit() {
  zdm.send('progress:set-limit', {
    id,
    enabled: $('use-limit') ? $('use-limit').checked : false,
    kbps: Number($('limit-kbps') ? $('limit-kbps').value : 0) || 0,
    remember: true,
  });
}

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});


$('btn-hide').addEventListener('click', () => {
  detailsOpen = !detailsOpen;
  $('btn-hide').classList.toggle('open', detailsOpen);
  $('btn-hide').title = detailsOpen ? 'Hide connections' : 'Show connections';
  $('btn-hide').setAttribute('aria-label', detailsOpen ? 'Hide connections' : 'Show connections');
  $('details').hidden = !detailsOpen;
  fit();
});

$('btn-main').addEventListener('click', () => {
  if (!record) return;
  if (record.status === 'complete') {
    if (filePath) zdm.send('download:open-file', filePath);
    return;
  }
  if (record.status === 'paused' || record.status === 'error') {
    record.status = 'downloading';
    record.error = '';
    record.errorTitle = '';
    render(record.progress || {});
    zdm.send('download:resume', id);
  } else {
    record.status = 'paused';
    render(record.progress || {});
    zdm.send('download:pause', id);
  }
});

let cancelAsk = true;
let cancelAction = 'keep';

function rememberCancel(action) {
  const box = $('cancel-remember');
  if (!box || !box.checked) return;
  cancelAsk = false;
  cancelAction = action;
  zdm.invoke('settings:update', { behavior: { cancelAsk: false, cancelAction: action } }).catch(() => {});
}

function runCancelChoice(action) {
  if (action !== 'abandon') action = 'keep';
  if (action === 'abandon') {
    zdm.send('download:abandon', id);
    window.close();
    return;
  }
  if (action === 'keep') zdm.send('download:pause', id);
  window.close();
}

$('btn-cancel').addEventListener('click', () => {
  if (finished) {
    window.close();
    return;
  }
  if (!cancelAsk) {
    runCancelChoice(cancelAction);
    return;
  }
  const ask = $('cancel-ask');
  if (ask) ask.hidden = false;
});
if ($('cancel-keep')) {
  $('cancel-keep').addEventListener('click', () => {
    rememberCancel('keep');
    runCancelChoice('keep');
  });
}
if ($('cancel-yes')) {
  $('cancel-yes').addEventListener('click', () => {
    rememberCancel('abandon');
    runCancelChoice('abandon');
  });
}

if ($('use-limit')) {
  $('use-limit').addEventListener('change', () => {
    if ($('limit-kbps')) $('limit-kbps').disabled = !$('use-limit').checked;
    sendLimit();
  });
}
if ($('limit-kbps')) $('limit-kbps').addEventListener('change', sendLimit);
if ($('thread-count')) {
  $('thread-count').addEventListener('input', updateThreadNote);
  $('thread-count').addEventListener('change', () => {
    updateThreadNote();
    sendThreads();
  });
}
if ($('show-dialog')) {
  $('show-dialog').addEventListener('change', sendFinish);
}
if ($('opt-power')) {
  $('opt-power').addEventListener('change', () => {
    updatePowerAction();
    sendFinish();
  });
}
if ($('power-action')) {
  $('power-action').addEventListener('change', sendFinish);
}

function applyStatus(status, extra) {
  if (!record) record = { id, status };
  record.status = status;
  if (extra) Object.assign(record, extra);
  render(record.progress || {});
}

let paintQueued = false;
let pendingPaint = null;
const traceLines = [];
let traceEvents = 0;
let tracePaints = 0;
let traceEventGapSum = 0;
let traceEventGapMax = 0;
let tracePaintGapSum = 0;
let tracePaintGapMax = 0;
let traceRenderSum = 0;
let traceRenderMax = 0;
let traceLastEvent = 0;
let traceLastPaint = 0;
let traceWindowAt = 0;
let traceFlushTimer = 0;

function traceStamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function queueWindowTrace(line) {
  traceLines.push(line);
  if (traceFlushTimer) return;
  traceFlushTimer = setTimeout(() => {
    traceFlushTimer = 0;
    if (!traceLines.length || !zdm.send) return;
    const lines = traceLines.splice(0, traceLines.length);
    zdm.send('progress:trace', { lines });
  }, 400);
}

function noteWindowEvent(data) {
  const now = performance.now();
  const gap = traceLastEvent ? now - traceLastEvent : 0;
  traceLastEvent = now;
  traceEvents += 1;
  traceEventGapSum += gap;
  if (gap > traceEventGapMax) traceEventGapMax = gap;
  if (gap >= 180) {
    const segs = Array.isArray(data.segments) ? data.segments.length : 0;
    queueWindowTrace(`${traceStamp()} WIN hitch event gap=${Math.round(gap)}ms segs=${segs} pct=${Number(data.percent || 0).toFixed(2)} total=${Number(data.total) || 0}`);
  }
}

function noteWindowPaint(data, renderMs) {
  const now = performance.now();
  const gap = traceLastPaint ? now - traceLastPaint : 0;
  traceLastPaint = now;
  tracePaints += 1;
  tracePaintGapSum += gap;
  traceRenderSum += renderMs;
  if (gap > tracePaintGapMax) tracePaintGapMax = gap;
  if (renderMs > traceRenderMax) traceRenderMax = renderMs;
  if (gap >= 180 || renderMs >= 12) {
    const segs = Array.isArray(data.segments) ? data.segments.length : 0;
    queueWindowTrace(`${traceStamp()} WIN hitch paint gap=${Math.round(gap)}ms render=${renderMs.toFixed(1)}ms segs=${segs} pct=${Number(data.percent || 0).toFixed(2)}`);
  }
  if (!traceWindowAt) traceWindowAt = now;
  if (now - traceWindowAt < 1000) return;
  const kind = !(Number(data.total) > 0) && (Number(data.duration) || (record && record.duration)) ? 'hls' : 'file';
  const ev = traceEvents || 1;
  const paints = tracePaints || 1;
  queueWindowTrace(`${traceStamp()} WIN ${kind} ${(record && record.fileName) || ''} events=${traceEvents} eventGapAvg=${Math.round(traceEventGapSum / ev)}ms eventGapMax=${Math.round(traceEventGapMax)}ms paints=${tracePaints} paintGapAvg=${Math.round(tracePaintGapSum / paints)}ms paintGapMax=${Math.round(tracePaintGapMax)}ms renderAvg=${(traceRenderSum / paints).toFixed(1)}ms renderMax=${traceRenderMax.toFixed(1)}ms segs=${Array.isArray(data.segments) ? data.segments.length : 0} pct=${Number(data.percent || 0).toFixed(2)} total=${Number(data.total) || 0}`);
  traceEvents = 0;
  tracePaints = 0;
  traceEventGapSum = 0;
  traceEventGapMax = 0;
  tracePaintGapSum = 0;
  tracePaintGapMax = 0;
  traceRenderSum = 0;
  traceRenderMax = 0;
  traceWindowAt = now;
}

function showProgress(data) {
  pendingPaint = data;
  if (document.hidden || paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const next = pendingPaint;
    pendingPaint = null;
    if (!next || !record || record.status === 'complete') return;
    const started = performance.now();
    render(next);
    noteWindowPaint(next, performance.now() - started);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (coastFrame) cancelAnimationFrame(coastFrame);
    coastFrame = 0;
    paintQueued = false;
    return;
  }
  if (pendingPaint) showProgress(pendingPaint);
  else if (coast && record && record.status === 'downloading' && coast.speed >= 100) armCoast(coast.pct, coast.speed, coast.span, 0);
});

zdm.on('download:progress', (data) => {
  if (!data || data.id !== id || !record) return;
  if (record.status === 'complete') {
    if (data.status === 'downloading' || (data.percent != null && data.percent < 100)) {
      record.status = 'downloading';
    } else {
      return;
    }
  }
  if (record.status !== 'paused') {
    if (data.phase === 'merging' || data.status === 'merging' || data.status === 'muxing') record.status = 'merging';
    else if (record.status !== 'error' && record.status !== 'merging') record.status = 'downloading';
  }
  record.progress = data;
  noteWindowEvent(data);
  if (record.status === 'paused') {
    render(data);
    return;
  }
  showProgress(data);
});

if ($('btn-copy-link')) {
  $('btn-copy-link').addEventListener('click', () => {
    const text = (record && record.url) ? String(record.url) : '';
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

zdm.on('download:metadata', (data) => {
  if (!data || data.id !== id || !record) return;
  if (data.url) record.url = data.url;
  if (data.fileName) record.fileName = data.fileName;
  if (data.fileSize) record.fileSize = data.fileSize;
  if (data.duration) record.duration = data.duration;
  if (data.resumable != null) record.resumable = !!data.resumable;
  render(record.progress || {});
});

zdm.on('download:paused', (data) => {
  if (data && data.id === id) applyStatus('paused');
});

zdm.on('download:resumed', (data) => {
  if (!data || data.id !== id) return;
  if (record) {
    record.error = '';
    record.errorTitle = '';
    if (data.redownload) {
      record.progress = { downloaded: 0, total: record.fileSize || 0, percent: 0, speed: 0, eta: null, segments: [] };
    }
  }
  applyStatus('downloading');
});

let completeQueued = false;

function revealComplete() {
  if (completeQueued) return;
  completeQueued = true;
  zdm.send('progress:reveal-complete', id);
  window.close();
}

zdm.on('download:complete', (data) => {
  if (!data || data.id !== id) return;
  filePath = data.path || filePath;
  if (!record) record = { id, status: 'complete' };
  record.path = filePath;
  record.status = 'complete';
  record.progress = Object.assign({}, record.progress, { percent: 100, downloaded: record.progress && record.progress.total ? record.progress.total : record.progress && record.progress.downloaded });
  render(record.progress);
  $('meter-fill').style.width = '100%';
  $('state').textContent = 'Complete';
  $('left').textContent = '0 sec';
  $('btn-main').textContent = 'Open';
  $('btn-cancel').textContent = 'Close';
  // A minimized window stops painting, so requestAnimationFrame never runs
  // and the complete dialog stayed hidden until the window was restored.
  if (document.hidden) {
    revealComplete();
    return;
  }
  setTimeout(revealComplete, 450);
});

zdm.on('download:error', (data) => {
  if (!data || data.id !== id) return;
  applyStatus('error', { error: data.error, errorTitle: data.errorTitle || '' });
});

async function init() {
  let data = null;
  try {
    data = await zdm.invoke('progress:get', id);
  } catch {
    data = null;
  }
  record = (data && data.record) || { id, status: 'downloading', fileName: 'Download', url: '' };
  filePath = record.path || '';
  defaultThreads = (data && data.globalThreads) || 8;
  cancelAsk = !data || data.cancelAsk !== false;
  cancelAction = (data && data.cancelAction) || 'keep';
  if (record.speedLimit) {
    if ($('use-limit')) $('use-limit').checked = !!record.speedLimit.enabled;
    if (record.speedLimit.kbps && $('limit-kbps')) $('limit-kbps').value = record.speedLimit.kbps;
    if ($('limit-kbps') && $('use-limit')) $('limit-kbps').disabled = !$('use-limit').checked;
  }
  if (record && record.customThreads > 0) {
    if ($('thread-count')) $('thread-count').value = record.customThreads;
  } else if ($('thread-count')) {
    $('thread-count').value = 0;
  }
  updateThreadNote();
  if (record.finish) {
    if ($('show-dialog') && typeof record.finish.showDialog === 'boolean') {
      $('show-dialog').checked = record.finish.showDialog;
    }
    if ($('opt-power')) $('opt-power').checked = !!record.finish.power;
    if ($('power-action') && record.finish.action) $('power-action').value = record.finish.action;
  }
  updatePowerAction();
  sendFinish();
  render((data && data.progress) || {});
  fit();
}

init();
})();
