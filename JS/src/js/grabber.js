(function () {
  const zdm = window.zdm;
  if (!zdm) return;

  const TEMPLATES = {
    video: 'mp4, mkv, webm, avi, mov',
    music: 'mp3, flac, wav, aac, ogg',
    documents: 'pdf, doc, docx, xls, xlsx, ppt, pptx, txt',
    programs: 'exe, msi, zip, rar, 7z',
    custom: 'All Files (*.*)',
  };
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABEL = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

  const ui = {
    step: 1,
    view: 'all',
    node: '',
    open: new Set(),
    files: [],
    run: 0,
    saved: false,
    startedIds: [],
    projects: [],
    templates: [],
    stats: { status: 'Idle', simple: 0, advanced: 0, total: 0, explored: 0, matched: 0, downloaded: 0 },
    schedule: {
      type: 'once', action: 'explore', hangup: false, exitApp: false, power: false,
      powerAction: 'shutdown', force: false, startOn: false, startAt: '23:00',
      when: 'once', date: new Date().toISOString().slice(0, 10),
      days: { sun: true, mon: true, tue: true, wed: true, thu: true, fri: true, sat: true },
      stopOn: false, stopAt: '07:30', openOn: false, openPath: '',
    },
    settings: { explore: 4, download: 4, cache: true, text: true, advanced: true },
  };
  const fired = new Set();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function projectSnapshot() {
    const saveMode = document.querySelector('input[name="g-save"]:checked')?.value || 'category';
    return {
      name: $('g-name').value.trim() || 'project_1',
      url: $('g-url').value.trim(),
      template: $('g-template').value,
      auth: $('g-auth').checked,
      login: $('g-login').value,
      password: $('g-password').value,
      manualLogin: $('g-manual-login').checked,
      loginPage: $('g-login-page').value,
      skipLogout: $('g-skip-logout').checked,
      logoutPattern: $('g-logout-pattern').value,
      saveMode,
      category: $('g-category').value,
      folder: $('g-folder').value,
      subfolders: $('g-subfolders').checked,
      overwrite: $('g-overwrite').checked,
      queueOnClose: $('g-queue-on-close').checked,
      depthMode: document.querySelector('input[name="g-depth"]:checked')?.value || 'levels',
      levels: Number($('g-levels').value) || 0,
      otherLevels: Number($('g-other-levels').value) || 0,
      popups: $('g-popups').checked,
      parents: $('g-parents').checked,
      domain: $('g-domain').checked,
      js: $('g-js').checked,
      include: $('g-include').value,
      exclude: $('g-exclude').value,
      siteOnly: $('g-site-only').checked,
      dupes: $('g-dupes').checked,
      immediate: $('g-immediate').checked,
      schedule: ui.schedule,
      savedAt: new Date().toISOString(),
    };
  }

  function applyProject(project) {
    $('g-name').value = project.name || 'project_1';
    $('g-url').value = project.url || '';
    $('g-template').value = project.template || 'custom';
    $('g-auth').checked = !!project.auth;
    $('g-login').value = project.login || '';
    $('g-password').value = project.password || '';
    $('g-manual-login').checked = !!project.manualLogin;
    $('g-login-page').value = project.loginPage || '';
    $('g-skip-logout').checked = !!project.skipLogout;
    $('g-logout-pattern').value = project.logoutPattern || '';
    const save = document.querySelector(`input[name="g-save"][value="${project.saveMode || 'category'}"]`);
    if (save) save.checked = true;
    if (project.category) $('g-category').value = project.category;
    $('g-folder').value = project.folder || $('g-folder').value;
    $('g-subfolders').checked = !!project.subfolders;
    $('g-overwrite').checked = !!project.overwrite;
    $('g-queue-on-close').checked = !!project.queueOnClose;
    const depth = document.querySelector(`input[name="g-depth"][value="${project.depthMode || 'levels'}"]`);
    if (depth) depth.checked = true;
    $('g-levels').value = project.levels ?? 2;
    $('g-other-levels').value = project.otherLevels ?? 0;
    $('g-popups').checked = project.popups !== false;
    $('g-parents').checked = !!project.parents;
    $('g-domain').checked = project.domain !== false;
    $('g-js').checked = !!project.js;
    $('g-include').value = project.include || TEMPLATES.custom;
    $('g-exclude').value = project.exclude || '';
    $('g-site-only').checked = !!project.siteOnly;
    $('g-dupes').checked = project.dupes !== false;
    $('g-immediate').checked = !!project.immediate;
    ui.schedule = Object.assign(ui.schedule, project.schedule || {});
    syncAuth();
  }

  function syncAuth() {
    const on = $('g-auth').checked;
    $('g-login').disabled = !on;
    $('g-password').disabled = !on;
  }

  function showStep(step) {
    ui.step = step;
    $('grabber-wizard').hidden = false;
    $('grabber-files').hidden = true;
    document.querySelectorAll('.step-panel').forEach((panel) => {
      panel.classList.toggle('on', Number(panel.dataset.step) === step);
    });
    document.querySelectorAll('#grabber-steps li').forEach((item) => {
      item.classList.toggle('on', Number(item.dataset.step) === step);
    });
    const titles = ['Set start page', 'Save files', 'Set explorer filters', 'Set file filters'];
    $('grabber-subtitle').textContent = `Step ${step} — ${titles[step - 1]}`;
    $('g-back').disabled = step === 1;
    $('g-next').hidden = false;
    $('g-next').textContent = step === 4 ? 'Explore' : 'Next >';
  }

  function showFiles() {
    $('grabber-wizard').hidden = true;
    $('grabber-files').hidden = false;
    $('grabber-subtitle').textContent = $('g-name').value.trim() || 'Project';
    $('g-back').disabled = false;
    $('g-next').hidden = true;
    paintFiles();
  }

  function paintStats() {
    $('g-stat-status').textContent = ui.stats.status;
    $('g-stat-simple').textContent = ui.stats.simple;
    $('g-stat-advanced').textContent = ui.stats.advanced;
    $('g-stat-total').textContent = ui.stats.total;
    $('g-stat-explored').textContent = ui.stats.explored;
    $('g-stat-matched').textContent = ui.stats.matched;
    $('g-stat-downloaded').textContent = ui.stats.downloaded;
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }
  function pathOf(url) {
    try { return new URL(url).pathname || '/'; } catch { return '/'; }
  }
  function dirOf(url) {
    try {
      const path = new URL(url).pathname;
      return path.split('/').slice(0, -1).join('/') || '/';
    } catch { return '/'; }
  }
  function baseDomain(host) {
    const parts = String(host || '').replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
  }
  function visibleFiles() {
    return ui.files.map((file, index) => ({ file, index })).filter(({ file }) => {
      if (!ui.node) return true;
      if (ui.view === 'links') return pathOf(file.url).startsWith(ui.node);
      if (ui.view === 'folders') {
        const host = hostOf(file.url);
        if (ui.node.startsWith('*.')) return baseDomain(host) === ui.node.slice(2).replace(/ sites$/, '');
        return host === ui.node;
      }
      return true;
    });
  }
  function paintTree() {
    const tree = $('grabber-tree');
    if (!tree) return;
    const linkMap = new Map();
    const hostMap = new Map();
    ui.files.forEach((file) => {
      const parts = pathOf(file.url).split('/').filter(Boolean);
      const top = parts[0] ? '/' + parts[0] : '/';
      if (!linkMap.has(top)) linkMap.set(top, new Set());
      if (parts.length > 1) linkMap.get(top).add('/' + parts.slice(0, 3).join('/'));
      const host = hostOf(file.url);
      if (!host) return;
      const group = '*.' + baseDomain(host) + ' sites';
      if (!hostMap.has(group)) hostMap.set(group, new Set());
      hostMap.get(group).add(host);
    });
    const on = (view, node) => ui.view === view && ui.node === node ? 'on' : '';
    const twist = (key, hasKids) => hasKids
      ? `<span class="twisty ${ui.open.has(key) ? 'open' : ''}" data-toggle="${esc(key)}"></span>`
      : '<span class="twisty blank"></span>';
    const linkHtml = ui.open.has('links') ? [...linkMap.entries()].slice(0, 40).map(([top, kids]) => {
      const kidList = [...kids].slice(0, 12);
      const key = 'links:' + top;
      return `<button type="button" class="sub ${on('links', top)}" data-view="links" data-node="${esc(top)}">${twist(key, kidList.length)}${esc(top)}</button>
        ${ui.open.has(key) ? kidList.map((kid) => `<button type="button" class="sub2 ${on('links', kid)}" data-view="links" data-node="${esc(kid)}">${esc(kid)}</button>`).join('') : ''}`;
    }).join('') : '';
    const folderHtml = ui.open.has('folders') ? [...hostMap.entries()].map(([group, hosts]) => {
      const hostList = [...hosts].sort();
      const key = 'folders:' + group;
      return `<button type="button" class="sub ${on('folders', group)}" data-view="folders" data-node="${esc(group)}">${twist(key, hostList.length)}${esc(group)}</button>
        ${ui.open.has(key) ? hostList.map((host) => `<button type="button" class="sub2 ${on('folders', host)}" data-view="folders" data-node="${esc(host)}">${esc(host)}</button>`).join('') : ''}`;
    }).join('') : '';
    tree.innerHTML = `
      <button type="button" class="${on('thumbs', '')}" data-view="thumbs" data-node="">Thumbnails</button>
      <button type="button" class="${on('all', '')}" data-view="all" data-node="">All Files</button>
      <button type="button" class="${on('links', '')}" data-view="links" data-node="">${twist('links', linkMap.size)}${esc('Link View')}</button>
      ${linkHtml}
      <button type="button" class="${on('folders', '')}" data-view="folders" data-node="">${twist('folders', hostMap.size)}${esc('Folder View')}</button>
      ${folderHtml}`;
  }

  function paintFiles() {
    const list = $('grabber-file-list');
    paintTree();
    const rows = visibleFiles();
    if (ui.exploring) {
      list.innerHTML = `<p class="step-note">Exploring ${esc(ui.exploreUrl || 'the page')}… This can take a few seconds.</p>`;
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<p class="step-note">${esc(ui.emptyNote || 'No matching files yet. Go back, enter a start address, then press Explore.')}</p>`;
      return;
    }
    if (ui.view === 'thumbs') {
      list.innerHTML = `<div class="thumb-grid">${rows.map(({ file, index }) => `
        <label class="thumb-card"><input type="checkbox" data-index="${index}" ${file.checked ? 'checked' : ''}>
          <strong>${esc(file.name)}</strong><span>${esc(file.ext || 'file')}</span></label>`).join('')}</div>`;
      return;
    }
    const groups = new Map();
    rows.forEach(({ file, index }) => {
      const key = ui.view === 'links' ? dirOf(file.url) : ui.view === 'folders' ? dirOf(file.url) : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ file, index });
    });
    list.innerHTML = [...groups.entries()].map(([key, items]) => `
      ${key ? `<div class="grab-group">${esc(key)}</div>` : ''}
      <table class="file-table"><thead><tr><th></th><th>File name</th><th>Type</th><th>Size</th><th>Status</th><th>Link text</th><th>Download from</th></tr></thead>
      <tbody>${items.map(({ file, index }) => `<tr>
        <td><input type="checkbox" data-index="${index}" ${file.checked ? 'checked' : ''}></td>
        <td>${esc(file.name)}</td><td>${esc(file.ext || '')}</td>
        <td>${file.size ? formatSize(file.size) : '—'}</td>
        <td>${esc(file.status || '')}</td>
        <td>${esc(file.text || '')}</td>
        <td>${esc(hostOf(file.from || file.url))}</td>
      </tr>`).join('')}</tbody></table>`).join('');
  }

  function checkedFiles() {
    return ui.files.filter((file) => file.checked);
  }

  async function addFiles(files, queueOnly) {
    let added = 0;
    for (const file of files) {
      if (!file.url || !/^https?:\/\//i.test(file.url)) {
        file.status = 'no address';
        continue;
      }
      const saveMode = document.querySelector('input[name="g-save"]:checked')?.value;
      const opts = {
        url: file.url,
        fileName: file.name,
        fileSize: file.size || 0,
        referrer: file.from || $('g-url').value.trim(),
        manual: true,
        queueOnly: !!queueOnly,
        duplicateAction: 'skip',
        category: saveMode === 'one-category' ? $('g-category').value.toLowerCase() : '',
        savePath: saveMode === 'folder' ? $('g-folder').value : '',
      };
      try {
        const record = await zdm.invoke('download:add', opts);
        if (record?.id) {
          file.status = queueOnly ? 'queued' : 'downloading';
          ui.startedIds.push(record.id);
          added += 1;
        } else if (record?.skipped) file.status = 'already listed';
      } catch (err) {
        file.status = err?.message || 'failed';
      }
    }
    ui.stats.downloaded += added;
    paintStats();
    paintFiles();
  }

  async function explore() {
    const url = $('g-url').value.trim();
    if (!url) {
      showStep(1);
      $('g-url').focus();
      return;
    }
    const run = ++ui.run;
    ui.exploring = true;
    ui.exploreUrl = url;
    ui.emptyNote = '';
    ui.files = [];
    ui.stats.status = 'Exploring';
    paintStats();
    showFiles();
    const project = projectSnapshot();
    let result = { pages: 0, files: [] };
    const pending = zdm.invoke('grabber:explore', {
        url,
        include: project.include,
        exclude: project.exclude,
        wholeSite: project.depthMode === 'whole',
        depth: project.levels,
        otherDepth: project.otherLevels,
        sameDomain: project.domain,
        skipParents: project.parents,
        ignorePopups: project.popups,
        processJs: project.js,
        siteOnly: project.siteOnly,
      });
    try {
      if (!pending || typeof pending.then !== 'function') {
        throw new Error('Restart Zetta Download Manager, then try Explore again.');
      }
      result = await pending;
    } catch (err) {
      if (run !== ui.run) return;
      ui.exploring = false;
      ui.stats.status = 'Stopped';
      ui.emptyNote = err?.message || 'Explore failed';
      paintStats();
      paintFiles();
      return;
    }
    if (run !== ui.run) return;
    ui.exploring = false;
    let found = result?.files || [];
    if (!found.length) {
      try {
        const media = await zdm.invoke('grabber:extract', url);
        const formats = [...(media?.formats || []), ...(media?.audioFormats || [])];
        found = formats.map((fmt) => ({
          name: `${media.title || 'media'}.${fmt.hasVideo === false ? 'm4a' : 'mp4'}`,
          url: fmt.url,
          ext: fmt.hasVideo === false ? 'audio' : 'video',
          size: fmt.filesize || 0,
          text: fmt.resolution || fmt.note || '',
          from: url,
        }));
        ui.stats.advanced += 1;
      } catch { /* page had no media list */ }
    }
    if (project.dupes) {
      const seen = new Set();
      found = found.filter((file) => {
        if (seen.has(file.url)) return false;
        seen.add(file.url);
        return true;
      });
    }
    ui.files = found.map((file) => Object.assign({ checked: false, status: '' }, file));
    ui.stats.simple = result?.pages || 0;
    ui.stats.explored = (result?.pages || 0) + ui.stats.advanced;
    ui.stats.total = ui.files.length;
    ui.stats.matched = ui.files.length;
    ui.stats.status = ui.files.length ? 'Complete' : 'No files';
    if (!ui.files.length) {
      ui.emptyNote = `Opened ${ui.stats.simple} page(s) and found no files for this filter. Try All Files (*.*) or another address.`;
    }
    paintStats();
    paintFiles();
    if (project.immediate && ui.files.length) {
      ui.files.forEach((file) => { file.checked = true; });
      await addFiles(ui.files, false);
    }
  }

  function stopExplore() {
    ui.run += 1;
    ui.exploring = false;
    ui.stats.status = 'Stopped';
    ui.emptyNote = 'Exploring stopped.';
    paintStats();
    if (!$('grabber-files').hidden) paintFiles();
  }

  async function saveProject() {
    const project = projectSnapshot();
    const index = ui.projects.findIndex((item) => item.name === project.name);
    if (index >= 0) ui.projects[index] = project;
    else ui.projects.unshift(project);
    ui.saved = true;
    await zdm.invoke('settings:update', { grabber: { projects: ui.projects, templates: ui.templates, settings: ui.settings } });
  }

  function openMenu(menu, anchor) {
    document.querySelectorAll('#grabber-project-menu, #grabber-options-menu').forEach((node) => node.classList.remove('visible'));
    const rect = anchor.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.classList.add('visible');
  }

  function fillProjectMenu() {
    const recent = ui.projects.slice(0, 6).map((project) =>
      `<div class="menu-item" data-act="open" data-name="${esc(project.name)}">${esc(project.name)}</div>`
    ).join('');
    $('grabber-project-menu').innerHTML = `
      <div class="menu-item" data-act="new">New</div>
      <div class="menu-item" data-act="load">Load...</div>
      <div class="menu-item" data-act="save">Save</div>
      <div class="menu-item" data-act="template">Save current settings as a template</div>
      <div class="menu-separator"></div>
      <div class="menu-item disabled">Recent Projects</div>
      ${recent || '<div class="menu-item disabled">None yet</div>'}
      <div class="menu-separator"></div>
      <div class="menu-item" data-act="close">Close</div>`;
  }

  function fillScheduleSheet() {
    const box = $('gp-days');
    box.innerHTML = DAYS.map((key) =>
      `<button type="button" data-day="${key}" class="${ui.schedule.days[key] ? 'on' : ''}"><span>${DAY_LABEL[key]}</span></button>`
    ).join('');
    $('gp-date').value = ui.schedule.date || new Date().toISOString().slice(0, 10);
  }

  function readScheduleSheet() {
    ui.schedule.type = document.querySelector('input[name="gp-type"]:checked')?.value || 'once';
    ui.schedule.action = document.querySelector('input[name="gp-action"]:checked')?.value || 'explore';
    ui.schedule.hangup = false;
    ui.schedule.exitApp = $('gp-exit').checked;
    ui.schedule.power = $('gp-power').checked;
    ui.schedule.powerAction = $('gp-power-action').value;
    ui.schedule.force = $('gp-force').checked;
    ui.schedule.startOn = $('gp-start-on').checked;
    ui.schedule.startAt = $('gp-start-at').value;
    ui.schedule.when = document.querySelector('input[name="gp-when"]:checked')?.value || 'once';
    ui.schedule.date = $('gp-date').value;
    ui.schedule.stopOn = $('gp-stop-on').checked;
    ui.schedule.stopAt = $('gp-stop-at').value;
    ui.schedule.openOn = $('gp-open-on').checked;
    ui.schedule.openPath = $('gp-open-path').value;
    DAYS.forEach((key) => {
      const chip = $('gp-days').querySelector(`[data-day="${key}"]`);
      ui.schedule.days[key] = !!(chip && chip.classList.contains('on'));
    });
  }

  function askSchedule() {
    if (!ui.saved) {
      $('g-save-sheet').hidden = false;
      return;
    }
    fillScheduleSheet();
    $('g-schedule-sheet').hidden = false;
  }

  async function closeGrabber() {
    if ($('g-queue-on-close').checked) await addFiles(checkedFiles(), true);
    $('grabber-dialog').classList.remove('visible');
  }

  $('g-auth').addEventListener('change', syncAuth);
  $('g-advanced').addEventListener('click', () => {
    const box = $('g-advanced-box');
    box.hidden = !box.hidden;
    $('g-advanced').textContent = box.hidden ? 'Advanced >>' : 'Advanced <<';
  });
  $('g-template').addEventListener('change', () => {
    const key = $('g-template').value;
    const custom = ui.templates.find((item) => item.name === key);
    if (custom) {
      $('g-include').value = custom.include;
      $('g-exclude').value = custom.exclude || '';
      return;
    }
    if (TEMPLATES[key]) $('g-include').value = TEMPLATES[key];
  });
  $('g-browse').addEventListener('click', async () => {
    const folder = await zdm.invoke('settings:pick-folder');
    if (folder) {
      $('g-folder').value = folder;
      document.querySelector('input[name="g-save"][value="folder"]').checked = true;
    }
  });
  $('grabber-steps').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) showStep(Number(step.dataset.step));
  });
  $('g-back').addEventListener('click', () => {
    if (!$('grabber-files').hidden) showStep(4);
    else if (ui.step > 1) showStep(ui.step - 1);
  });
  $('g-next').addEventListener('click', () => {
    if (ui.step < 4) showStep(ui.step + 1);
    else explore();
  });
  $('g-close').addEventListener('click', closeGrabber);
  $('grabber-x').addEventListener('click', closeGrabber);
  $('grabber-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'explore' || act === 'update') explore();
    if (act === 'stop-explore') stopExplore();
    if (act === 'check-all') { ui.files.forEach((file) => { file.checked = true; }); paintFiles(); }
    if (act === 'uncheck-all') { ui.files.forEach((file) => { file.checked = false; }); paintFiles(); }
    if (act === 'download') addFiles(checkedFiles(), false);
    if (act === 'stop-download') ui.startedIds.forEach((id) => zdm.send('download:pause', id));
    if (act === 'queue') addFiles(checkedFiles(), true);
    if (act === 'schedule') askSchedule();
    if (act === 'stats') $('grabber-stats').hidden = !$('grabber-stats').hidden;
  });
  $('grabber-tree').addEventListener('click', (e) => {
    const twisty = e.target.closest('[data-toggle]');
    if (twisty) {
      const key = twisty.dataset.toggle;
      if (ui.open.has(key)) ui.open.delete(key);
      else ui.open.add(key);
      paintTree();
      return;
    }
    const view = e.target.closest('[data-view]');
    if (!view) return;
    ui.view = view.dataset.view;
    ui.node = view.dataset.node || '';
    if (!$('grabber-files').hidden) paintFiles();
  });
  $('grabber-file-list').addEventListener('change', (e) => {
    const box = e.target.closest('[data-index]');
    if (!box) return;
    const file = ui.files[Number(box.dataset.index)];
    if (file) file.checked = box.checked;
  });
  $('grabber-stats-x').addEventListener('click', () => { $('grabber-stats').hidden = true; });
  $('grabber-menu-project').addEventListener('click', (e) => {
    e.stopPropagation();
    fillProjectMenu();
    openMenu($('grabber-project-menu'), e.currentTarget);
  });
  $('grabber-menu-options').addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu($('grabber-options-menu'), e.currentTarget);
  });
  $('grabber-project-menu').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-act]');
    $('grabber-project-menu').classList.remove('visible');
    if (!item || item.classList.contains('disabled')) return;
    const act = item.dataset.act;
    if (act === 'new') {
      ui.saved = false;
      ui.files = [];
      $('g-name').value = 'project_' + (ui.projects.length + 1);
      $('g-url').value = '';
      showStep(1);
    }
    if (act === 'save' || act === 'template') {
      if (act === 'template') {
        const snap = projectSnapshot();
        ui.templates = ui.templates.filter((tpl) => tpl.name !== snap.name).concat([{
          name: snap.name, include: snap.include, exclude: snap.exclude,
        }]);
        const select = $('g-template');
        if (![...select.options].some((opt) => opt.value === snap.name)) {
          const opt = document.createElement('option');
          opt.value = snap.name;
          opt.textContent = snap.name;
          select.appendChild(opt);
        }
      }
      await saveProject();
    }
    if (act === 'load' && !ui.projects.length) return;
    if (act === 'open') {
      const project = ui.projects.find((entry) => entry.name === item.dataset.name);
      if (project) {
        applyProject(project);
        ui.saved = true;
        showStep(1);
      }
    }
    if (act === 'close') closeGrabber();
  });
  $('grabber-options-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-act]');
    $('grabber-options-menu').classList.remove('visible');
    if (!item) return;
    if (item.dataset.act === 'settings') {
      $('g-set-explore').value = ui.settings.explore;
      $('g-set-download').value = ui.settings.download;
      $('g-set-cache').checked = ui.settings.cache;
      $('g-set-text').checked = ui.settings.text;
      $('g-set-advanced').checked = ui.settings.advanced;
      $('g-settings-sheet').hidden = false;
    }
    if (item.dataset.act === 'schedule') askSchedule();
  });
  $('g-set-ok').addEventListener('click', async () => {
    ui.settings.explore = Math.min(10, Math.max(1, Number($('g-set-explore').value) || 4));
    ui.settings.download = Math.min(10, Math.max(1, Number($('g-set-download').value) || 4));
    ui.settings.cache = $('g-set-cache').checked;
    ui.settings.text = $('g-set-text').checked;
    ui.settings.advanced = $('g-set-advanced').checked;
    zdm.send('queue:set-limit', ui.settings.download);
    $('g-settings-sheet').hidden = true;
    await zdm.invoke('settings:update', { grabber: { settings: ui.settings } });
  });
  $('g-set-cancel').addEventListener('click', () => { $('g-settings-sheet').hidden = true; });
  $('gp-days').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-day]');
    if (chip) chip.classList.toggle('on');
  });
  $('gp-ok').addEventListener('click', async () => {
    readScheduleSheet();
    $('g-schedule-sheet').hidden = true;
    await saveProject();
  });
  $('gp-cancel').addEventListener('click', () => { $('g-schedule-sheet').hidden = true; });
  $('gp-open-browse').addEventListener('click', async () => {
    const file = await zdm.invoke('shell:pick-file');
    if (file) $('gp-open-path').value = file;
  });
  $('g-save-yes').addEventListener('click', async () => {
    await saveProject();
    $('g-save-sheet').hidden = true;
    askSchedule();
  });
  $('g-save-no').addEventListener('click', () => { $('g-save-sheet').hidden = true; });
  document.addEventListener('click', () => {
    $('grabber-project-menu').classList.remove('visible');
    $('grabber-options-menu').classList.remove('visible');
  });

  function minute(now) {
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  function tick(now) {
    const plan = ui.schedule;
    if (!plan || (!plan.startOn && !plan.stopOn)) return;
    const stamp = now.toDateString() + minute(now);
    const dayKey = DAYS[now.getDay()];
    const due = plan.startAt === minute(now) && (plan.when === 'daily' ? plan.days[dayKey] : plan.date === now.toISOString().slice(0, 10));
    if (plan.startOn && due && !fired.has('start:' + stamp)) {
      fired.add('start:' + stamp);
      if (plan.action === 'checked') addFiles(checkedFiles(), false);
      else explore().then(() => {
        if (plan.action === 'both') return addFiles(ui.files, false);
      });
    }
    if (plan.stopOn && plan.stopAt === minute(now) && !fired.has('stop:' + stamp)) {
      fired.add('stop:' + stamp);
      stopExplore();
      if (plan.openOn && plan.openPath) zdm.send('download:open-file', plan.openPath);
      if (plan.exitApp && confirm('Exit Zetta Download Manager?')) zdm.send('window:close');
      if (plan.power && confirm('Turn off the computer now?')) {
        zdm.invoke('system:power', { action: plan.powerAction || 'shutdown', force: !!plan.force });
      }
    }
  }

  async function open() {
    $('grabber-dialog').classList.add('visible');
    if (!$('g-folder').value) {
      try {
        const settings = window.zdmSettings || await zdm.invoke('settings:get');
        $('g-folder').value = settings?.library?.defaultPath || '';
        ui.projects = settings?.grabber?.projects || ui.projects;
        ui.templates = settings?.grabber?.templates || [];
        ui.settings = Object.assign(ui.settings, settings?.grabber?.settings || {});
        ui.templates.forEach((tpl) => {
          if (![...$('g-template').options].some((opt) => opt.value === tpl.name)) {
            const opt = document.createElement('option');
            opt.value = tpl.name;
            opt.textContent = tpl.name;
            $('g-template').appendChild(opt);
          }
        });
      } catch { /* folder stays empty */ }
    }
    showStep(1);
    paintStats();
  }

  window.zdmGrabber = { open, tick };
})();
