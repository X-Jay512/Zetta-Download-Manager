(function () {
  const zdm = window.zdm;
  if (!zdm) return;

  const $ = (id) => document.getElementById(id);

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  const DAYS = [
    ['sun', 'Sun'], ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'],
    ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'],
  ];
  const DAY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function queueDefaults(extra) {
    return Object.assign({
      id: 'q-' + Date.now(),
      name: 'New queue',
      kind: 'custom',
      mode: 'once',
      startOnLaunch: false,
      startAtEnabled: false,
      startAt: '23:00',
      when: 'daily',
      onceDate: new Date().toISOString().slice(0, 10),
      days: { sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true },
      everyEnabled: false,
      everyHours: 2,
      everyMins: 0,
      stopAtEnabled: false,
      stopAt: '07:30',
      retriesEnabled: false,
      retries: 10,
      openFileEnabled: false,
      openFile: '',
      hangup: false,
      exitApp: false,
      shutdown: false,
      shutdownAction: 'shutdown',
      forceTerminate: false,
      fileIds: [],
    }, extra || {});
  }

  const model = {
    activeId: 'main',
    tab: 'schedule',
    selectedFileId: null,
    concurrent: 1,
    removed: [],
    queues: [
      queueDefaults({ id: 'main', name: 'General queue', kind: 'main', mode: 'once' }),
      queueDefaults({ id: 'sync', name: 'Repeat queue', kind: 'sync', mode: 'periodic', everyEnabled: true }),
    ],
    limits: { enabled: false, mb: 200, hours: 5, warn: true },
  };
  const fired = new Set();
  const runningQueues = new Set();
  const failedInRun = new Set();
  const skippedInRun = new Set();
  let launched = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function current() {
    return model.queues.find((q) => q.id === model.activeId) || model.queues[0];
  }

  let cachedDownloads = [];
  function downloads() {
    if (window.zdmState?.downloads) return window.zdmState.downloads;
    return cachedDownloads;
  }

  function paintActions() {
    const list = downloads();
    const start = $('scheduler-start');
    const stop = $('scheduler-stop');
    if (start) start.disabled = !list.some((d) => d.status === 'paused' || d.status === 'error' || d.status === 'queued');
    if (stop) stop.disabled = !list.some((d) => d.status === 'downloading' || d.status === 'merging');
  }

  function filesIn(queueId) {
    const q = model.queues.find((entry) => entry.id === (queueId || 'main')) || (queueId === 'main' ? model.queues[0] : null);
    return q ? filesFor(q) : [];
  }

  function processQueue(queueId) {
    if (!runningQueues.has(queueId)) return;
    const q = model.queues.find((entry) => entry.id === queueId) || (queueId === 'main' ? model.queues[0] : null);
    if (!q) {
      runningQueues.delete(queueId);
      return;
    }
    const files = filesFor(q);
    const activeFiles = files.filter((item) => item.status === 'downloading' || item.status === 'merging');
    const pendingFiles = files.filter((item) => !failedInRun.has(item.id) && !skippedInRun.has(item.id) && (item.status === 'paused' || item.status === 'error' || item.status === 'queued'));

    if (!activeFiles.length && !pendingFiles.length) {
      runningQueues.delete(queueId);
      afterStop(q);
      paintActions();
      return;
    }

    const limit = Math.max(1, parseInt(model.concurrent || 1, 10) || 1);
    const needed = limit - activeFiles.length;
    if (needed > 0) {
      const toStart = pendingFiles.slice(0, needed);
      toStart.forEach((item) => {
        item.status = 'downloading';
        zdm.send('download:resume', item.id);
      });
    }
    paintActions();
  }

  function checkRunningQueues() {
    runningQueues.forEach((queueId) => {
      processQueue(queueId);
    });
  }

  function startNow(queueId) {
    queueId = queueId || 'main';
    runningQueues.add(queueId);
    failedInRun.clear();
    skippedInRun.clear();
    processQueue(queueId);
  }

  function stopNow(queueId) {
    queueId = queueId || 'main';
    runningQueues.delete(queueId);
    failedInRun.clear();
    skippedInRun.clear();
    const q = model.queues.find((entry) => entry.id === queueId) || (queueId === 'main' ? model.queues[0] : null);
    const files = q ? filesFor(q) : [];
    files
      .filter((item) => item.status === 'downloading' || item.status === 'merging')
      .forEach((item) => zdm.send('download:pause', item.id));
    paintActions();
  }

  function stopAllQueues() {
    runningQueues.clear();
    failedInRun.clear();
    skippedInRun.clear();
    paintActions();
  }

  function readPane() {
    if (model.activeId === 'limits') {
      if (!$('lim-mb')) return;
      const on = (id) => !!($(id) && $(id).checked);
      const val = (id, fallback) => ($(id) && $(id).value) || fallback;
      model.limits.enabled = on('lim-on');
      model.limits.mb = Math.max(1, parseInt(val('lim-mb', '200'), 10) || 200);
      model.limits.hours = Math.max(1, parseInt(val('lim-hours', '5'), 10) || 5);
      model.limits.warn = on('lim-warn');
      return;
    }
    const q = current();
    if (!q || !$('sch-start-at')) return;
    const on = (id) => !!($(id) && $(id).checked);
    const val = (id, fallback) => ($(id) && $(id).value) || fallback;
    q.mode = on('sch-mode-periodic') ? 'periodic' : 'once';
    q.startOnLaunch = on('sch-launch');
    q.startAtEnabled = on('sch-start-on');
    q.startAt = val('sch-start-at', '23:00');
    q.when = on('sch-when-once') ? 'once' : 'daily';
    if ($('sch-once-date')) q.onceDate = val('sch-once-date', q.onceDate);
    DAYS.forEach(([key]) => {
      const box = $('sch-day-' + key);
      if (box) q.days[key] = box.classList.contains('on');
    });
    if ($('sch-every-on')) {
      q.everyEnabled = on('sch-every-on');
      q.everyHours = Math.max(0, parseInt(val('sch-every-h', '0'), 10) || 0);
      q.everyMins = Math.max(0, parseInt(val('sch-every-m', '0'), 10) || 0);
    }
    q.stopAtEnabled = on('sch-stop-on');
    q.stopAt = val('sch-stop-at', '07:30');
    q.retriesEnabled = on('sch-retry-on');
    q.retries = Math.max(0, parseInt(val('sch-retry-n', '0'), 10) || 0);
    q.openFileEnabled = on('sch-open-on');
    q.openFile = val('sch-open-path', '');
    q.hangup = false;
    q.exitApp = on('sch-exit');
    q.shutdown = on('sch-shutdown');
    q.shutdownAction = val('sch-power', 'sleep');
    q.forceTerminate = on('sch-force');
  }

  function lockRow(boxId, inputIds) {
    const on = $(boxId) && $(boxId).checked;
    inputIds.forEach((id) => { if ($(id)) $(id).disabled = !on; });
  }

  function lockControls() {
    if (!$('sch-start-on')) return;
    lockRow('sch-start-on', ['sch-start-at']);
    lockRow('sch-stop-on', ['sch-stop-at']);
    lockRow('sch-retry-on', ['sch-retry-n']);
    lockRow('sch-open-on', ['sch-open-path']);
    if ($('sch-every-on')) lockRow('sch-every-on', ['sch-every-h', 'sch-every-m']);
    const once = $('sch-when-once') && $('sch-when-once').checked;
    if ($('sch-once-date')) $('sch-once-date').disabled = !once;
  }

  function dayButtons(days) {
    return `<div class="day-chips">${DAYS.map(([key, label]) =>
      `<button type="button" class="${days[key] ? 'on' : ''}" id="sch-day-${key}" data-day="${key}"><span>${label}</span></button>`
    ).join('')}</div>`;
  }

  function scheduleHtml(q) {
    const periodic = q.mode === 'periodic';
    return `
      <p class="step-kicker">When it runs</p>
      <label class="check-line"><input type="radio" name="sch-mode" id="sch-mode-once" ${periodic ? '' : 'checked'}> Run this queue once</label>
      <label class="check-line"><input type="radio" name="sch-mode" id="sch-mode-periodic" ${periodic ? 'checked' : ''}> Repeat this queue</label>
      <label class="check-line"><input type="checkbox" id="sch-launch" ${q.startOnLaunch ? 'checked' : ''}> Also run it when ZDM opens</label>
      <div class="sched-row"><label class="check-line"><input type="checkbox" id="sch-start-on" ${q.startAtEnabled ? 'checked' : ''}> Begin at</label>
        <input type="time" id="sch-start-at" value="${esc(q.startAt)}"></div>
      ${periodic ? `
        <div class="sched-row"><label class="check-line"><input type="checkbox" id="sch-every-on" ${q.everyEnabled ? 'checked' : ''}> Repeat every</label>
          <input type="number" id="sch-every-h" min="0" max="168" value="${q.everyHours}"> hours
          <input type="number" id="sch-every-m" min="0" max="59" value="${q.everyMins}"> min</div>
        <p class="step-kicker">On these days</p>
        ${dayButtons(q.days)}
      ` : `
        <label class="check-line"><input type="radio" name="sch-when" id="sch-when-once" ${q.when === 'once' ? 'checked' : ''}> On this date
          <input type="date" id="sch-once-date" value="${esc(q.onceDate)}"></label>
        <label class="check-line"><input type="radio" name="sch-when" id="sch-when-daily" ${q.when === 'daily' ? 'checked' : ''}> On selected days</label>
        ${dayButtons(q.days)}
      `}
      <div class="sched-row"><label class="check-line"><input type="checkbox" id="sch-stop-on" ${q.stopAtEnabled ? 'checked' : ''}> Pause at</label>
        <input type="time" id="sch-stop-at" value="${esc(q.stopAt)}"></div>
      <p class="step-kicker">If a file fails</p>
      <div class="sched-row"><label class="check-line"><input type="checkbox" id="sch-retry-on" ${q.retriesEnabled ? 'checked' : ''}> Try again</label>
        <input type="number" id="sch-retry-n" min="0" max="99" value="${q.retries}"> times</div>
      <p class="step-kicker">When the queue finishes</p>
      <label class="check-line"><input type="checkbox" id="sch-open-on" ${q.openFileEnabled ? 'checked' : ''}> Open a file</label>
      <div class="path-row"><input type="text" id="sch-open-path" value="${esc(q.openFile)}"><button class="btn btn-secondary" type="button" id="sch-browse">Browse</button></div>
      <label class="check-line"><input type="checkbox" id="sch-exit" ${q.exitApp ? 'checked' : ''}> Quit ZDM</label>
      <div class="sched-row"><label class="check-line"><input type="checkbox" id="sch-shutdown" ${q.shutdown ? 'checked' : ''}> Then</label>
        <select id="sch-power">
          <option value="sleep" ${q.shutdownAction === 'sleep' ? 'selected' : ''}>Sleep</option>
          <option value="shutdown" ${q.shutdownAction === 'shutdown' ? 'selected' : ''}>Shut down</option>
        </select></div>
    `;
  }

  function limitsHtml() {
    const lim = model.limits;
    return `
      <label class="check-line"><input type="checkbox" id="lim-on" ${lim.enabled ? 'checked' : ''}> Limit how much can download</label>
      <div class="sched-row">No more than
        <input type="number" id="lim-mb" min="1" value="${lim.mb}"> MB
        in <input type="number" id="lim-hours" min="1" value="${lim.hours}"> hours</div>
      <label class="check-line"><input type="checkbox" id="lim-warn" ${lim.warn ? 'checked' : ''}> Ask me before this limit pauses downloads</label>
    `;
  }

  function queueOf(id) {
    if ((model.removed || []).includes(id)) return null;
    const dl = downloads().find((d) => d.id === id);
    if (!dl || dl.status === 'complete') return null;
    const explicit = model.queues.find((q) => (q.fileIds || []).includes(id));
    if (explicit) return explicit;
    return model.queues.find((q) => q.id === 'main') || null;
  }

  function filesFor(q) {
    const list = downloads();
    const inThisQueue = list.filter((d) => {
      const targetQ = queueOf(d.id);
      return targetQ && targetQ.id === q.id;
    });

    const orderMap = new Map((q.fileIds || []).map((id, idx) => [id, idx]));
    inThisQueue.sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999999;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999999;
      return idxA - idxB;
    });

    return inThisQueue;
  }

  function materialize(q) {
    q.fileIds = filesFor(q).map((d) => d.id);
    return q.fileIds;
  }

  const QUEUE_COLORS = ['#7c6cff', '#00e676', '#f2cc8f', '#64b5f6', '#f48fb1', '#ce93d8', '#ffb74d', '#80deea'];

  function queueNumberHtml(n) {
    const color = QUEUE_COLORS[(Math.max(1, n) - 1) % QUEUE_COLORS.length];
    const digits = String(n).split('').map((digit) => {
      const file = digit === '0' ? 'zero.png' : `number-${digit}.png`;
      return `<img src="assets/ui/num/${file}" alt="">`;
    }).join('');
    return `<span class="q-num" style="--q-glow:${color}">${digits}</span>`;
  }

  let queueMenuId = 'main';

  function renderSidebarQueues() {
    const parent = document.querySelector('.tree-item[data-category="queues"]');
    const box = parent && parent.nextElementSibling;
    if (!box) return;
    box.querySelectorAll('[data-custom="1"]').forEach((row) => row.remove());
    model.queues.filter((queue) => queue.kind === 'custom').forEach((queue, index) => {
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.dataset.category = 'queue_' + queue.id;
      row.dataset.custom = '1';
      row.innerHTML = `${queueNumberHtml(index + 1)}<span class="label"></span>`;
      row.querySelector('.label').textContent = queue.name;
      box.appendChild(row);
    });
    if (window.zdmTheme) window.zdmTheme.paint();
  }

  function remember() {
    zdm.invoke('settings:update', { scheduler: model }).then((next) => {
      if (next) window.zdmSettings = next;
    }).catch(() => {});
    renderSidebarQueues();
    if (window.renderList) window.renderList();
  }

  function filesHtml() {
    const q = current();
    const waiting = filesFor(q);
    const rows = waiting.map((d) => {
      const pct = d.progress?.percent != null ? d.progress.percent + '%' : '—';
      return `<tr draggable="true" data-id="${esc(d.id)}" class="${d.id === model.selectedFileId ? 'on' : ''}"><td>${esc(d.fileName || 'Unknown')}</td><td>${formatSize(d.fileSize || d.progress?.total)}</td><td>${esc(d.status)}</td><td>${pct}</td></tr>`;
    }).join('');
    return `
      <div class="queue-files-wrap">
        <label class="sched-row">Run
          <input type="number" id="sch-concurrent" min="1" max="10" value="${model.concurrent}">
          files together</label>
        <div class="queue-files-scroll">
          ${rows ? `<table class="file-table"><thead><tr><th>File name</th><th>Size</th><th>Status</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="step-note">Nothing is in this queue. Right-click a download and choose Add to queue.</p>'}
        </div>
        <div class="queue-file-actions">
          <button type="button" id="q-down" title="Move down">↓</button>
          <button type="button" id="q-up" title="Move up">↑</button>
          <button type="button" id="q-remove" title="Remove from queue">✕</button>
        </div>
      </div>`;
  }

  function moveFile(dir) {
    const q = current();
    if (!q || !model.selectedFileId) return;
    const ids = materialize(q);
    const index = ids.indexOf(model.selectedFileId);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const swap = ids[index];
    ids[index] = ids[next];
    ids[next] = swap;
    q.fileIds = ids;
    paintPane();
    remember();
  }

  function moveFileTo(sourceId, targetId, insertAfter) {
    const q = current();
    if (!q || !sourceId || !targetId || sourceId === targetId) return;
    const ids = materialize(q);
    const fromIndex = ids.indexOf(sourceId);
    if (fromIndex < 0) return;
    ids.splice(fromIndex, 1);
    let toIndex = ids.indexOf(targetId);
    if (toIndex < 0) toIndex = ids.length;
    else if (insertAfter) toIndex += 1;
    ids.splice(toIndex, 0, sourceId);
    q.fileIds = ids;
    model.selectedFileId = sourceId;
    paintPane();
    remember();
  }

  function removeSelectedFile() {
    const q = current();
    if (!q || !model.selectedFileId) return;
    const id = model.selectedFileId;
    q.fileIds = (q.fileIds || []).filter((item) => item !== id);
    if (!model.removed.includes(id)) model.removed.push(id);
    model.selectedFileId = null;
    paintPane();
    remember();
  }

  function paintQueues() {
    const box = $('scheduler-queues');
    if (!box) return;
    const marks = { main: '#3dd6ff', sync: '#7dffa1', custom: '#c9a6ff', limits: '#ff8b8b' };
    const items = model.queues.map((q) => `
      <button type="button" class="queue-item ${q.id === model.activeId ? 'on' : ''}" data-id="${esc(q.id)}">
        <span class="mark" style="color:${marks[q.kind] || marks.custom}"></span>${esc(q.name)}
      </button>`).join('');
    const limitsOn = model.activeId === 'limits' ? 'on' : '';
    box.innerHTML = items + `
      <button type="button" class="queue-item ${limitsOn}" data-id="limits">
        <span class="mark" style="color:${marks.limits}"></span>Data cap
      </button>`;
    const del = $('scheduler-delete');
    if (del) del.disabled = model.activeId === 'limits' || ['main', 'sync'].includes(model.activeId);
  }

  function paintPane() {
    const pane = $('scheduler-pane');
    if (!pane) return;
    const heading = $('scheduler-heading');
    const tabs = $('scheduler-tabs');
    if (tabs) tabs.style.visibility = model.activeId === 'limits' ? 'hidden' : 'visible';
    if (model.activeId === 'limits') {
      pane.classList.remove('files-pane-mode');
      if (heading) heading.textContent = 'Data cap';
      pane.innerHTML = limitsHtml();
      return;
    }
    const q = current();
    if (heading) heading.textContent = q.name;
    const oldScroll = pane.querySelector('.queue-files-scroll')?.scrollTop || 0;
    pane.classList.toggle('files-pane-mode', model.tab === 'files');
    pane.innerHTML = model.tab === 'files' ? filesHtml() : scheduleHtml(q);
    if (oldScroll && model.tab === 'files') {
      const scrollEl = pane.querySelector('.queue-files-scroll');
      if (scrollEl) scrollEl.scrollTop = oldScroll;
    }
    if (model.tab === 'schedule') lockControls();
  }

  function show(id) {
    readPane();
    model.activeId = id;
    if (id === 'limits') model.tab = 'schedule';
    paintQueues();
    paintPane();
    paintActions();
  }

  async function save() {
    readPane();
    const speed = {
      limitEnabled: !!model.limits.enabled,
      limitMB: model.limits.mb,
      limitHours: model.limits.hours,
      warnBeforeStop: !!model.limits.warn,
    };
    const next = await zdm.invoke('settings:update', { scheduler: model, speed });
    if (next) window.zdmSettings = next;
    const apply = $('scheduler-apply');
    const old = apply.textContent;
    apply.textContent = 'Saved';
    setTimeout(() => { apply.textContent = old; }, 900);
  }

  function dayMatches(q, now) {
    if (q.mode === 'periodic') return !!q.days[DAY_INDEX[now.getDay()]];
    if (q.when === 'once') return q.onceDate === now.toISOString().slice(0, 10);
    return !!q.days[DAY_INDEX[now.getDay()]];
  }

  function minute(now) {
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  async function afterStop(q) {
    if (q.openFileEnabled && q.openFile) zdm.send('download:open-file', q.openFile);
    if (q.exitApp && confirm('Exit Zetta Download Manager?')) zdm.send('window:close');
    if (q.shutdown && confirm('Turn off the computer now?')) {
      await zdm.invoke('system:power', { action: q.shutdownAction || 'shutdown', force: !!q.forceTerminate });
    }
  }

  function tick() {
    const now = new Date();
    const stamp = now.toDateString() + minute(now);
    model.queues.forEach((q) => {
      if (q.startAtEnabled && q.startAt === minute(now) && dayMatches(q, now) && !fired.has(q.id + ':start:' + stamp)) {
        fired.add(q.id + ':start:' + stamp);
        startNow(q.id);
      }
      if (q.mode === 'periodic' && q.everyEnabled && dayMatches(q, now)) {
        const span = ((Number(q.everyHours) || 0) * 60 + (Number(q.everyMins) || 0)) * 60000;
        if (span >= 60000) {
          if (!q.nextEvery) q.nextEvery = Date.now() + span;
          if (Date.now() >= q.nextEvery && !fired.has(q.id + ':every:' + stamp)) {
            fired.add(q.id + ':every:' + stamp);
            q.nextEvery = Date.now() + span;
            startNow(q.id);
          }
        }
      }
      if (q.stopAtEnabled && q.stopAt === minute(now) && !fired.has(q.id + ':stop:' + stamp)) {
        fired.add(q.id + ':stop:' + stamp);
        stopNow(q.id);
        afterStop(q);
      }
    });
    paintActions();

  }

  function open(id, tab) {
    if (typeof zdm.send === 'function' && document.body.dataset.window !== 'scheduler') {
      zdm.send('window:open-scheduler', { queueId: id, tab: tab });
      return;
    }
    if (typeof id === 'string' && id) model.activeId = id;
    if (tab === 'files' || tab === 'schedule') model.tab = tab;
    const dialog = $('scheduler-dialog');
    if (dialog) dialog.classList.add('visible');
    paintQueues();
    paintPane();
    paintActions();
  }

  function close() {
    readPane();
    const dialog = $('scheduler-dialog');
    if (dialog && dialog.classList.contains('visible')) {
      dialog.classList.remove('visible');
      if ($('scheduler-help')) $('scheduler-help').hidden = true;
    } else {
      window.close();
    }
  }

  $('scheduler-queues')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (item) show(item.dataset.id);
  });
  $('scheduler-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    readPane();
    model.tab = tab.dataset.tab;
    $('scheduler-tabs').querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn === tab));
    paintPane();
  });
  $('scheduler-pane')?.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      day.classList.toggle('on');
      readPane();
      return;
    }
    if (e.target.id === 'sch-browse') {
      const picked = await zdm.invoke('shell:pick-file');
      if (picked && $('sch-open-path')) $('sch-open-path').value = picked;
      return;
    }
    if (e.target.id === 'q-down') { moveFile(1); return; }
    if (e.target.id === 'q-up') { moveFile(-1); return; }
    if (e.target.id === 'q-remove') { removeSelectedFile(); return; }
    const row = e.target.closest('tr[data-id]');
    if (row) {
      model.selectedFileId = row.dataset.id;
      paintPane();
    }
  });

  let draggedFileId = null;
  let dragInsertAfter = false;

  $('scheduler-pane')?.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    draggedFileId = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedFileId);
  });

  $('scheduler-pane')?.addEventListener('dragover', (e) => {
    if (!draggedFileId) return;
    const row = e.target.closest('tr[data-id]');
    if (!row || row.dataset.id === draggedFileId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = e.clientY >= (rect.top + rect.height / 2);
    dragInsertAfter = after;
    $('scheduler-pane').querySelectorAll('.file-table tr').forEach((r) => {
      r.classList.remove('drop-above', 'drop-below');
    });
    row.classList.toggle('drop-below', after);
    row.classList.toggle('drop-above', !after);
  });

  $('scheduler-pane')?.addEventListener('dragleave', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) {
      row.classList.remove('drop-above', 'drop-below');
    }
  });

  $('scheduler-pane')?.addEventListener('drop', (e) => {
    if (!draggedFileId) return;
    const row = e.target.closest('tr[data-id]');
    $('scheduler-pane').querySelectorAll('.file-table tr').forEach((r) => {
      r.classList.remove('drop-above', 'drop-below', 'dragging');
    });
    if (!row) {
      draggedFileId = null;
      return;
    }
    e.preventDefault();
    const targetId = row.dataset.id;
    if (targetId && targetId !== draggedFileId) {
      moveFileTo(draggedFileId, targetId, dragInsertAfter);
    }
    draggedFileId = null;
  });

  $('scheduler-pane')?.addEventListener('dragend', () => {
    draggedFileId = null;
    $('scheduler-pane').querySelectorAll('.file-table tr').forEach((r) => {
      r.classList.remove('drop-above', 'drop-below', 'dragging');
    });
  });
  $('scheduler-pane')?.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'sch-concurrent') {
      model.concurrent = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1));
      zdm.send('queue:set-limit', model.concurrent);
      remember();
      return;
    }
    readPane();
    if (e.target && e.target.name === 'sch-mode') paintPane();
    else lockControls();
  });
  $('scheduler-new')?.addEventListener('click', () => {
    if ($('scheduler-name-form')) {
      $('scheduler-name-form').hidden = false;
      $('scheduler-name-input')?.focus();
    }
  });
  $('scheduler-name-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('scheduler-name-input')?.value.trim();
    if (!name) return;
    const q = queueDefaults({ name });
    model.queues.push(q);
    if ($('scheduler-name-input')) $('scheduler-name-input').value = '';
    if ($('scheduler-name-form')) $('scheduler-name-form').hidden = true;
    show(q.id);
  });
  $('scheduler-delete')?.addEventListener('click', () => {
    const q = current();
    if (!q || q.kind !== 'custom') return;
    model.queues = model.queues.filter((item) => item.id !== q.id);
    remember();
    show('main');
  });
  $('scheduler-start')?.addEventListener('click', () => startNow(model.activeId === 'limits' ? 'main' : model.activeId));
  $('scheduler-stop')?.addEventListener('click', () => stopNow(model.activeId === 'limits' ? 'main' : model.activeId));
  $('scheduler-apply')?.addEventListener('click', save);
  $('scheduler-close')?.addEventListener('click', close);
  $('scheduler-x')?.addEventListener('click', close);
  $('scheduler-help-btn')?.addEventListener('click', () => {
    const card = $('scheduler-help');
    if (card) {
      card.hidden = !card.hidden;
      card.textContent = 'Start now runs every paused, failed, or waiting file. Stop pauses what is downloading. A checked time runs only while ZDM is open. Apply stores the queues and the download cap.';
    }
  });

  function applySavedSettings(settings) {
    const saved = settings?.scheduler;
    if (saved?.queues?.length) {
      model.queues = saved.queues.map((q) => queueDefaults(q));
      model.queues.forEach((q) => {
        if (q.id === 'main' && (q.name === 'Main download queue' || q.name === 'Everyday queue')) q.name = 'General queue';
        if (q.id === 'sync' && q.name === 'Synchronization queue') q.name = 'Repeat queue';
      });
      model.limits = Object.assign(model.limits, saved.limits || {});
      model.activeId = saved.activeId || 'main';
      model.removed = Array.isArray(saved.removed) ? saved.removed : [];
      model.concurrent = (saved.concurrent && saved.concurrent !== 4) ? saved.concurrent : 1;
    } else if (settings?.speed) {
      model.limits.enabled = !!settings.speed.limitEnabled;
      model.limits.mb = settings.speed.limitMB || 200;
      model.limits.hours = settings.speed.limitHours || 5;
      model.limits.warn = settings.speed.warnBeforeStop !== false;
    }
  }

  async function boot() {
    try {
      const settings = window.zdmSettings || await zdm.invoke('settings:get');
      window.zdmSettings = settings;
      applySavedSettings(settings);
      if (!window.zdmState?.downloads) {
        const list = await zdm.invoke('category:get-downloads', 'all');
        if (Array.isArray(list)) cachedDownloads = list;
      }
      launched = true;
    } catch { /* keep defaults */ }
    setInterval(tick, 20000);
    renderSidebarQueues();
    if (document.body.dataset.window === 'scheduler' || !$('scheduler-dialog')) {
      paintQueues();
      paintPane();
      paintActions();
    }
  }

  function assign(ids, queueId) {
    const target = model.queues.find((q) => q.id === queueId);
    if (!target) return;
    model.queues.forEach((q) => {
      q.fileIds = (q.fileIds || []).filter((id) => !ids.includes(id));
    });
    ids.forEach((id) => {
      if (!target.fileIds.includes(id)) target.fileIds.push(id);
      model.removed = model.removed.filter((item) => item !== id);
    });
    remember();
    if ($('scheduler-dialog')?.classList.contains('visible') || document.body.dataset.window === 'scheduler') paintPane();
  }

  function removeFromQueue(ids) {
    model.queues.forEach((q) => {
      q.fileIds = (q.fileIds || []).filter((id) => !ids.includes(id));
    });
    ids.forEach((id) => { if (!model.removed.includes(id)) model.removed.push(id); });
    remember();
    if ($('scheduler-dialog')?.classList.contains('visible') || document.body.dataset.window === 'scheduler') paintPane();
  }

  function createQueue(name) {
    const q = queueDefaults({ name });
    model.queues.push(q);
    remember();
    const parent = document.querySelector('.tree-item[data-category="queues"]');
    if (parent) {
      parent.classList.remove('collapsed');
      const children = parent.nextElementSibling;
      if (children && children.classList.contains('tree-children')) children.style.display = 'flex';
    }
    return q;
  }

  const queueMenu = document.getElementById('queue-context-menu');
  document.querySelector('.sidebar-tree')?.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.tree-item');
    const category = item && item.dataset.category;
    if (!category || (category !== 'queues' && !category.startsWith('queue_'))) return;
    e.preventDefault();
    e.stopPropagation();
    queueMenuId = category === 'queues' ? 'main' : category.slice('queue_'.length);
    const queue = model.queues.find((entry) => entry.id === queueMenuId);
    const files = downloads().filter((item) => queueOf(item.id)?.id === queueMenuId);
    const canStart = files.some((item) => item.status === 'paused' || item.status === 'error' || item.status === 'queued');
    const canStop = files.some((item) => item.status === 'downloading');
    queueMenu.querySelector('[data-act="start"]')?.classList.toggle('disabled', !canStart);
    queueMenu.querySelector('[data-act="stop"]')?.classList.toggle('disabled', !canStop);
    const del = queueMenu.querySelector('[data-act="delete"]');
    if (del) del.classList.toggle('disabled', !queue || queue.kind !== 'custom');
    queueMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    queueMenu.style.top = Math.min(e.clientY, window.innerHeight - 220) + 'px';
    queueMenu.classList.add('visible');
  });
  document.addEventListener('click', (e) => {
    if (!queueMenu || e.target.closest('#queue-context-menu')) return;
    queueMenu.classList.remove('visible');
  });
  queueMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('[data-act]');
    if (!act || act.classList.contains('disabled')) return;
    queueMenu.classList.remove('visible');
    if (act.dataset.act === 'start') startNow(queueMenuId);
    else if (act.dataset.act === 'stop') stopNow(queueMenuId);
    else if (act.dataset.act === 'files') open(queueMenuId, 'files');
    else if (act.dataset.act === 'schedule') open(queueMenuId, 'schedule');
    else if (act.dataset.act === 'delete') {
      const queue = model.queues.find((entry) => entry.id === queueMenuId);
      if (!queue || queue.kind !== 'custom') return;
      model.queues = model.queues.filter((entry) => entry.id !== queue.id);
      if (model.activeId === queue.id) model.activeId = 'main';
      remember();
    } else if (act.dataset.act === 'create') {
      const name = prompt('Queue name');
      if (name && name.trim()) createQueue(name.trim());
    }
  });

  function updateRowProgress(data) {
    const row = document.querySelector(`tr[data-id="${data.id}"]`);
    if (!row) return;
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) {
      if (data.status) cells[2].textContent = data.status;
      if (data.percent != null) cells[3].textContent = data.percent + '%';
      if (data.total) cells[1].textContent = formatSize(data.total);
    }
  }

  zdm.on('scheduler:navigate', (opts) => {
    if (opts?.queueId) model.activeId = opts.queueId;
    if (opts?.tab) model.tab = opts.tab;
    paintQueues();
    paintPane();
    paintActions();
  });

  zdm.on('settings:changed', (next) => {
    if (!next) return;
    window.zdmSettings = next;
    applySavedSettings(next);
    renderSidebarQueues();
    paintQueues();
    paintPane();
    paintActions();
  });

  zdm.on('download:progress', (data) => {
    if (!data?.id) return;
    const dl = downloads().find((d) => d.id === data.id);
    if (dl) {
      dl.progress = Object.assign(dl.progress || {}, data);
      if (data.status) dl.status = data.status;
      if (model.tab === 'files') {
        updateRowProgress(data);
      }
    }
  });

  zdm.on('queue:start', (queueId) => {
    if (queueId === 'all') {
      model.queues.forEach((q) => startNow(q.id));
    } else {
      startNow(queueId || 'main');
    }
  });

  zdm.on('download:complete', (data) => {
    if (!data?.id) return;
    const dl = downloads().find((d) => d.id === data.id);
    if (dl) dl.status = 'complete';
    if (model.tab === 'files') paintPane();
    paintActions();
    checkRunningQueues();
  });

  zdm.on('download:error', (data) => {
    if (!data?.id) return;
    const dl = downloads().find((d) => d.id === data.id);
    if (dl) dl.status = 'error';
    if (model.tab === 'files') paintPane();
    paintActions();
    const q = queueOf(data.id);
    if (q && q.retriesEnabled && (q.retries || 0) > 0) {
      if (!dl._retryCount) dl._retryCount = 0;
      if (dl._retryCount < q.retries) {
        dl._retryCount++;
        setTimeout(() => {
          if (runningQueues.has(q.id)) {
            zdm.send('download:resume', dl.id);
          }
        }, 3000);
        return;
      }
    }
    failedInRun.add(data.id);
    checkRunningQueues();
  });

  zdm.on('download:paused', (data) => {
    if (!data?.id) return;
    const dl = downloads().find((d) => d.id === data.id);
    if (dl) dl.status = 'paused';
    if (model.tab === 'files') paintPane();
    paintActions();
    const q = queueOf(data.id);
    if (q && runningQueues.has(q.id)) {
      skippedInRun.add(data.id);
      checkRunningQueues();
    }
  });

  zdm.on('download:resumed', (data) => {
    if (!data?.id) return;
    const dl = downloads().find((d) => d.id === data.id);
    if (dl) dl.status = 'downloading';
    if (model.tab === 'files') paintPane();
    paintActions();
    checkRunningQueues();
  });

  zdm.on('download:removed', (data) => {
    const removedIds = Array.isArray(data?.ids) ? data.ids : (data?.id ? [data.id] : []);
    if (removedIds.length) {
      cachedDownloads = cachedDownloads.filter((d) => !removedIds.includes(d.id));
    } else {
      zdm.invoke('category:get-downloads', 'all').then((list) => {
        if (Array.isArray(list)) cachedDownloads = list;
        if (model.tab === 'files') paintPane();
        paintActions();
      }).catch(() => {});
    }
    if (model.tab === 'files') paintPane();
    paintActions();
    checkRunningQueues();
  });

  zdm.on('download:added', (record) => {
    if (record && !cachedDownloads.some((d) => d.id === record.id)) {
      cachedDownloads.push(record);
    }
    if (model.tab === 'files') paintPane();
    paintActions();
    checkRunningQueues();
  });

  window.zdmScheduler = {
    open,
    startNow,
    stopNow,
    stopAllQueues,
    isQueueRunning(queueId) {
      return runningQueues.has(queueId || 'main');
    },
    assign,
    removeFromQueue,
    createQueue,
    listQueues() {
      return model.queues.map((queue) => ({ id: queue.id, name: queue.name, kind: queue.kind }));
    },
    queueNumberHtml,
    queueOf,
    queueChoices(ids) {
      const taken = new Set(ids.map((id) => queueOf(id)?.id).filter(Boolean));
      const unique = taken.size === 1 && ids.length;
      return model.queues.filter((q) => !unique || q.id !== [...taken][0]);
    },
  };
  boot();
})();
