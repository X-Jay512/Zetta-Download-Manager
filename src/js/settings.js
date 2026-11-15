(function () {
  const zdm = window.zdm;
  if (!zdm) return;

  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;

  const PANE_COPY = {
    launch: ['Launch', 'How ZDM starts and stays out of the way'],
    catch: ['Extension', 'Take over from the browser — only with the extension connected'],
    library: ['Library', 'Where finished files and staging parts live'],
    behavior: ['Behavior', 'Sheets, duplicates, and how ZDM talks to servers'],
    speed: ['Speed', 'How hard ZDM hits a file and the network'],
    proxy: ['Proxy', 'Off, the Windows proxy, or an address you type'],
    look: ['Look', 'Theme 1 is dark gray with blue icons. Theme 2 is a soft white with blue icons. Theme 3 is dark gray with neon icons. Theme 4 is dark gray with red icons. Icon saturation applies to Theme 3 icons only'],
    'extension-custom': ['Extension customization', 'This customizes how the extension shows you the qualities. You can change it later from the extension settings.'],
  };
  const extensionSetup = new URLSearchParams(location.search).get('extensionSetup') === '1';

  const KINDS = [
    ['general', 'General'],
    ['compressed', 'Compressed'],
    ['documents', 'Documents'],
    ['music', 'Sounds'],
    ['programs', 'Programs'],
    ['video', 'Video'],
    ['images', 'Images'],
  ];

  const PANE_DEFAULTS = {
    launch: {
      startWithWindows: false,
      startMinimized: false,
      showNotifications: true,
      keepAwake: true,
    },
    catch: {
      interceptDownloads: true,
      sniffVideos: true,
      skipKeysEnabled: true,
      skipKeys: { alt: false, shift: false, ctrl: false, del: true },
      forceKeysEnabled: false,
      forceKeys: { alt: false, shift: false, ctrl: false, ins: false },
      forceNeedsClick: false,
      sparePagesWhileKey: true,
      contextDownload: true,
      contextDownloadAll: false,
      hudEnabled: true,
      hudMode: 'full',
      hudMinSizeKB: 50,
      autoCatchFromPlayers: true,
      silentDownload: false,
      addSilently: false,
      startCaptured: false,
      minCaptureKB: 0,
      advancedIntegration: true,
      browsers: {
        chrome: true,
        brave: true,
        edge: true,
        firefox: true,
        opera: true,
        safari: true,
      },
    },
    library: {
      rememberLastFolder: true,
      lastFolder: '',
      useServerFileTime: false,
      removeMissing: false,
    },
    behavior: {
      confirmBeforeStart: true,
      showCompleteDialog: true,
      startWhileDialog: true,
      queueOnLater: true,
      confirmDelete: true,
      ignoreMtime: false,
      ignoreSsl: false,
      retryFailed: false,
      retryCount: 3,
      duplicateAction: 'ask',
      hlsPull: 'native',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    },
    speed: {
      connectionsPerFile: 8,
      maxConcurrent: 0,
      throttleEnabled: false,
      throttleValue: 1,
      throttleUnit: 'MB',
      limitEnabled: false,
      limitMB: 200,
      limitHours: 5,
      warnBeforeStop: true,
      exceptions: [],
    },
    proxy: {
      enabled: false,
      mode: 'off',
      type: 'http',
      host: '',
      port: 0,
      username: '',
      password: '',
    },
    look: {
      columnLines: false,
      iconSaturation: 100,
      themeRevision: 2,
    },
  };

  function defaultLibraryFolders(base) {
    if (!base) return {};
    const sep = base.includes('/') ? '/' : '\\';
    return {
      general: base,
      compressed: `${base}${sep}Compressed`,
      documents: `${base}${sep}Documents`,
      music: `${base}${sep}Sounds`,
      programs: `${base}${sep}Programs`,
      video: `${base}${sep}Video`,
      images: `${base}${sep}Images`,
    };
  }

  let currentPane = 'launch';
  let model = null;
  let saveTimer = null;
  let saveGen = 0;
  let persistFlight = null;

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function scheduleSave() {
    window.zdmSettings = model;
    const gen = ++saveGen;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(gen), 250);
  }

  async function persist(gen) {
    if (!model || gen !== saveGen) return;
    const payload = JSON.parse(JSON.stringify(model));
    delete payload.scheduler;
    const flight = zdm.invoke('settings:update', payload);
    persistFlight = flight;
    try {
      const next = await flight;
      if (gen !== saveGen || !next) return;
      model = next;
      window.zdmSettings = next;
      if (typeof window.refreshZdmStatus === 'function') window.refreshZdmStatus();
    } catch (err) {
      console.error('Failed to save settings', err);
    } finally {
      if (persistFlight === flight) persistFlight = null;
    }
  }

  function bindValue(el, value) {
    if (el.dataset.setting === 'speed.maxConcurrent') {
      const n = Number(value);
      el.value = !Number.isFinite(n) || n <= 0 ? '' : String(Math.floor(n));
      return;
    }
    if (el.type === 'checkbox') el.checked = !!value;
    else if (el.tagName === 'TEXTAREA') {
      el.value = Array.isArray(value) ? value.join('\n') : (value || '');
    } else if (value == null) {
      el.value = '';
    } else {
      el.value = String(value);
    }
  }

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.setting === 'speed.maxConcurrent') {
      const n = parseFloat(el.value);
      if (!String(el.value).trim() || !Number.isFinite(n) || n <= 0) return 0;
      return Math.floor(n);
    }
    if (el.type === 'number') {
      const n = parseFloat(el.value);
      return Number.isFinite(n) ? n : 0;
    }
    if (el.type === 'range') {
      const n = parseFloat(el.value);
      return Number.isFinite(n) ? Math.round(n) : 100;
    }
    if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) return parseInt(el.value, 10);
    if (el.tagName === 'TEXTAREA') {
      return el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    return el.value;
  }

  function paintKeys() {
    overlay.querySelectorAll('.key-row').forEach((row) => {
      const set = getPath(model, row.dataset.keyset) || {};
      row.querySelectorAll('.key-cap').forEach((cap) => {
        cap.classList.toggle('on', !!set[cap.dataset.key]);
      });
    });
  }

  function paintFolders() {
    const grid = document.getElementById('folder-grid');
    if (!grid || !model || !model.library) return;
    grid.innerHTML = '';
    KINDS.forEach(([key, label]) => {
      const row = document.createElement('div');
      row.className = 'folder-row';
      const pathVal = (model.library.folders && model.library.folders[key]) || model.library.defaultPath || '';
      row.innerHTML = `<span>${label}</span><input type="text" data-folder="${key}"><button class="btn btn-secondary" type="button">Browse</button>`;
      const input = row.querySelector('input');
      input.value = pathVal;
      input.addEventListener('change', () => {
        if (!model.library.folders) model.library.folders = {};
        model.library.folders[key] = input.value.trim();
        scheduleSave();
      });
      row.querySelector('button').addEventListener('click', async () => {
        const picked = await zdm.invoke('settings:pick-folder');
        if (!picked) return;
        input.value = picked;
        if (!model.library.folders) model.library.folders = {};
        model.library.folders[key] = picked;
        scheduleSave();
      });
      grid.appendChild(row);
    });
  }

  const CONNECTION_CHOICES = [1, 2, 4, 8, 16, 32];

  function paintExceptions() {
    const list = document.getElementById('exception-list');
    if (!list || !model) return;
    const rows = Array.isArray(model.speed && model.speed.exceptions) ? model.speed.exceptions : [];
    list.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'exception-empty';
      empty.textContent = 'No hosts yet. Add one below.';
      list.appendChild(empty);
      return;
    }
    rows.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'settings-row exception-row';
      const host = document.createElement('span');
      host.className = 'exception-host';
      host.textContent = row.host;
      host.title = [row.host, row.userAgent, row.username].filter(Boolean).join(' · ');
      const controls = document.createElement('div');
      controls.className = 'exception-controls';
      const select = document.createElement('select');
      const current = Number(row.connections) || 8;
      const choices = CONNECTION_CHOICES.includes(current) ? CONNECTION_CHOICES : [current, ...CONNECTION_CHOICES];
      choices.forEach((n) => {
        const option = document.createElement('option');
        option.value = String(n);
        option.textContent = String(n);
        if (n === current) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        const next = (model.speed.exceptions || []).slice();
        if (!next[index]) return;
        next[index] = { ...next[index], connections: parseInt(select.value, 10) };
        model.speed.exceptions = next;
        scheduleSave();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary btn-tiny';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        model.speed.exceptions = (model.speed.exceptions || []).filter((_, i) => i !== index);
        paintExceptions();
        scheduleSave();
      });
      controls.appendChild(select);
      controls.appendChild(remove);
      line.appendChild(host);
      line.appendChild(controls);
      list.appendChild(line);
    });
  }

  function syncProxyLock() {
    const manual = getPath(model, 'proxy.mode') === 'manual';
    overlay.querySelectorAll('[data-proxy-manual]').forEach((row) => {
      row.classList.toggle('is-off', !manual);
      row.querySelectorAll('input, select').forEach((input) => { input.disabled = !manual; });
    });
  }

  function showLibraryNote(text) {
    const note = document.getElementById('library-action-note');
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || '';
  }

  const browserIconCache = new Map();

  function paintBrowserIcon(holder, exe) {
    const cached = exe ? browserIconCache.get(exe) : '';
    if (!cached) return;
    holder.textContent = '';
    const img = document.createElement('img');
    img.className = 'browser-icon-img';
    img.alt = '';
    img.src = cached;
    holder.appendChild(img);
  }

  function paintBrowsers(rows) {
    const box = document.getElementById('browser-list');
    if (!box || !model) return;
    const list = Array.isArray(rows) ? rows : (model.catch && model.catch.detected) || [];
    box.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = 'No browser was found. Install one, then check again.';
      box.appendChild(empty);
      return;
    }
    for (const row of list) {
      const isConnected = !!(row.extension && row.extension.enabled);
      const rowEl = document.createElement('div');
      rowEl.className = 'browser-row';
      rowEl.dataset.browserId = row.id;
      const ext = row.extension;
      if (ext && (ext.path || ext.id)) {
        const reasons = ext.disable_reasons == null ? '' : JSON.stringify(ext.disable_reasons);
        rowEl.title = `id=${ext.id || ''} path=${ext.path || ''} location=${ext.location == null ? '' : ext.location} state=${ext.state == null ? '' : ext.state} disable_reasons=${reasons}`;
      }

      const info = document.createElement('div');
      info.className = 'browser-info';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'browser-icon';
      iconSpan.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
      paintBrowserIcon(iconSpan, row.exe);
      if (row.exe && !browserIconCache.has(row.exe)) {
        const exe = row.exe;
        zdm.invoke('shell:file-icon', exe).then((url) => {
          browserIconCache.set(exe, url || '');
          if (url) paintBrowserIcon(iconSpan, exe);
        }).catch(() => {
          browserIconCache.set(exe, '');
        });
      }

      const text = document.createElement('span');
      text.className = 'browser-text';

      const name = document.createElement('span');
      name.className = 'browser-name';
      name.textContent = row.name || row.id;

      const store = document.createElement('span');
      store.className = 'browser-store';
      store.textContent = row.storeName || (row.family === 'firefox' ? 'Firefox Add-ons' : 'Chrome Web Store');

      text.appendChild(name);
      text.appendChild(store);
      info.appendChild(iconSpan);
      info.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'browser-actions';

      if (isConnected) {
        const connectedBadge = document.createElement('span');
        connectedBadge.className = 'browser-status-connected';
        const badgeText = document.createElement('span');
        badgeText.textContent = 'Connected';
        connectedBadge.appendChild(badgeText);
        actions.appendChild(connectedBadge);
      }

      const isChrome = row.id === 'chrome';
      const isFirefox = row.family === 'firefox' || row.id === 'firefox';
      if (isChrome || isFirefox) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-secondary btn-browser-copy';
        const copyLabel = isChrome ? 'Copy path' : 'Copy';
        copyBtn.textContent = copyLabel;
        copyBtn.addEventListener('click', async () => {
          copyBtn.disabled = true;
          try {
            const res = await zdm.invoke('browsers:copy-extension-path', isFirefox ? 'manifest' : 'folder');
            copyBtn.textContent = res && res.ok ? 'Copied' : 'Failed';
          } catch {
            copyBtn.textContent = 'Failed';
          }
          setTimeout(() => {
            copyBtn.textContent = copyLabel;
            copyBtn.disabled = false;
          }, 1200);
        });
        actions.appendChild(copyBtn);
      }

      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'btn-browser-install';
      const installText = document.createElement('span');
      const storeButton = row.installable === false && row.family !== 'firefox' && row.family !== 'chromium';
      installText.textContent = storeButton ? (row.storeName || 'Open store') : 'Install';
      installBtn.appendChild(installText);
      if (storeButton && !row.storeUrl) {
        installBtn.disabled = true;
        installBtn.title = `This browser uses ${row.storeName || 'its own store'}.`;
      }

      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        installText.textContent = storeButton ? 'Opening...' : 'Installing...';
        try {
          const res = await zdm.invoke('browsers:install-extension', row.id);
          if (res && res.openedPage) {
            installText.textContent = 'Opened';
            installBtn.disabled = false;
            return;
          }
          if (res && res.openedStore) {
            installText.textContent = row.storeName || 'Store opened';
            installBtn.disabled = false;
            return;
          }
          if (res && res.detail) row.extension = res.detail;
          if (res && res.connected) {
            row.connected = true;
            row.enabled = true;
            paintBrowsers();
          } else if (res && res.stage === 'disabled') {
            installText.textContent = 'Turned off';
            installBtn.title = res.error || 'The extension is in the browser but turned off.';
            installBtn.disabled = false;
          } else if (res && res.needsRestart) {
            installText.textContent = 'Reopen the browser';
            installBtn.disabled = false;
          } else if (res && res.error) {
            installText.textContent = 'Failed';
            installBtn.title = res.error;
            installBtn.disabled = false;
          } else {
            installText.textContent = 'Not in the browser yet';
            installBtn.disabled = false;
          }
        } catch (err) {
          installText.textContent = 'Failed';
          installBtn.title = err && err.message ? err.message : 'Install failed';
          installBtn.disabled = false;
        }
      });

      actions.appendChild(installBtn);

      rowEl.appendChild(info);
      rowEl.appendChild(actions);
      box.appendChild(rowEl);
    }
  }

  async function refreshBrowserStatus() {
    try {
      const statuses = await zdm.invoke('browsers:get-status');
      if (Array.isArray(statuses) && model && model.catch && Array.isArray(model.catch.detected)) {
        let changed = false;
        for (const st of statuses) {
          const row = model.catch.detected.find((b) => b && b.id === st.id);
          if (!row) continue;
          const live = !!(st.extension && st.extension.enabled);
          if (row.connected !== live) {
            row.connected = live;
            changed = true;
          }
          const prevExt = JSON.stringify(row.extension || null);
          const nextExt = JSON.stringify(st.extension || null);
          if (prevExt !== nextExt) {
            row.extension = st.extension || null;
            changed = true;
          }
        }
        if (changed) paintBrowsers();
      }
    } catch {}
  }

  if (zdm && zdm.on) {
    zdm.on('browser:status-changed', () => {
      refreshBrowserStatus();
    });
  }

  setInterval(() => {
    if (currentPane === 'catch') refreshBrowserStatus();
  }, 4000);

  function showSettingsNote(text) {
    const note = document.getElementById('settings-action-note');
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || '';
  }

  function paintForm() {
    overlay.querySelectorAll('[data-setting]').forEach((el) => {
      bindValue(el, getPath(model, el.dataset.setting));
    });
    paintKeys();
    paintFolders();
    paintExceptions();
    paintDays();
    syncProxyLock();
    paintBrowsers();
    syncMinPreset();
    syncIconSaturation();
  }

  function syncIconSaturation() {
    const row = document.getElementById('icon-saturation-row');
    const input = overlay.querySelector('[data-setting="appearance.iconSaturation"]');
    const label = document.getElementById('icon-saturation-value');
    if (!row || !input || !model) return;
    row.hidden = getPath(model, 'appearance.theme') !== 'theme3';
    let pct = Number(getPath(model, 'appearance.iconSaturation'));
    if (!Number.isFinite(pct)) pct = 100;
    pct = Math.min(100, Math.max(0, Math.round(pct)));
    input.value = String(pct);
    if (label) label.textContent = `${pct}%`;
  }

  function pushAppearance() {
    zdm.send('appearance:changed', model.appearance);
    if (window.zdmTheme) window.zdmTheme.apply(model.appearance);
  }

  function syncMinPreset() {
    const select = document.getElementById('min-capture-preset');
    const input = overlay.querySelector('[data-setting="catch.minCaptureKB"]');
    if (!select || !input || !model) return;
    const value = String(Number(getPath(model, 'catch.minCaptureKB')) || 0);
    select.value = ['102400', '512000', '1048576'].includes(value) ? value : 'custom';
    input.hidden = false;
  }

  function paintDays() {
    const days = (model && model.schedule && model.schedule.days) || [0, 1, 2, 3, 4, 5, 6];
    overlay.querySelectorAll('[data-day]').forEach((el) => {
      el.checked = days.includes(Number(el.dataset.day));
    });
  }

  function showPane(name) {
    currentPane = name;
    overlay.querySelectorAll('.settings-nav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.pane === name);
    });
    overlay.querySelectorAll('.settings-pane').forEach((p) => {
      p.classList.toggle('active', p.dataset.pane === name);
    });
    const copy = PANE_COPY[name] || [name, ''];
    document.getElementById('settings-heading').textContent = copy[0];
    document.getElementById('settings-sub').textContent = copy[1];
    if (name === 'catch') refreshBrowserStatus();
  }

  overlay.querySelectorAll('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showPane(btn.dataset.pane));
  });

  overlay.querySelectorAll('[data-setting]').forEach((el) => {
    const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    if (el.dataset.setting === 'speed.maxConcurrent') {
      el.addEventListener('change', () => {
        const n = parseFloat(el.value);
        if (!String(el.value).trim() || !Number.isFinite(n) || n <= 0) el.value = '';
      });
    }
    el.addEventListener(evt, () => {
      if (!model) return;
      setPath(model, el.dataset.setting, readValue(el));
      if (el.dataset.setting === 'catch.minCaptureKB') syncMinPreset();
      if (el.dataset.setting === 'proxy.mode') {
        if (!model.proxy) model.proxy = {};
        model.proxy.enabled = model.proxy.mode === 'manual';
        syncProxyLock();
      }
      if (el.dataset.setting === 'appearance.iconSaturation') syncIconSaturation();
      if (el.dataset.setting === 'appearance.theme') syncIconSaturation();
      if (el.dataset.setting === 'appearance.theme' || el.dataset.setting === 'appearance.columnLines' || el.dataset.setting === 'appearance.iconSaturation') {
        pushAppearance();
      }
      scheduleSave();
    });
  });

  overlay.querySelectorAll('.key-cap').forEach((cap) => {
    cap.addEventListener('click', () => {
      const row = cap.closest('.key-row');
      if (!row || !model) return;
      const current = getPath(model, row.dataset.keyset) || {};
      current[cap.dataset.key] = !current[cap.dataset.key];
      setPath(model, row.dataset.keyset, current);
      paintKeys();
      scheduleSave();
    });
  });

  overlay.querySelectorAll('.path-browse').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const picked = await zdm.invoke('settings:pick-folder');
      if (!picked || !model) return;
      setPath(model, btn.dataset.target, picked);
      const input = overlay.querySelector(`[data-setting="${btn.dataset.target}"]`);
      if (input) input.value = picked;
      scheduleSave();
    });
  });

  function hostFromInput(raw) {
    let host = String(raw || '').trim().toLowerCase();
    if (!host) return '';
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    host = host.split(/[/?#]/)[0];
    host = host.replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '');
    if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return '';
    return host;
  }

  function addException() {
    if (!model) return;
    const hostInput = document.getElementById('exception-host');
    const countInput = document.getElementById('exception-count');
    const error = document.getElementById('exception-error');
    const host = hostFromInput(hostInput.value);
    const connections = parseInt(countInput.value, 10);
    const userAgent = (document.getElementById('exception-ua')?.value || '').trim();
    const username = (document.getElementById('exception-user')?.value || '').trim();
    const password = document.getElementById('exception-pass')?.value || '';
    if (!host || !Number.isFinite(connections)) {
      if (error) {
        error.hidden = false;
        error.textContent = hostInput.value.trim()
          ? 'Use a host like cdn.example.com'
          : 'Type a host first';
      }
      hostInput.focus();
      return;
    }
    if (error) error.hidden = true;
    if (!model.speed) model.speed = {};
    const rows = Array.isArray(model.speed.exceptions) ? model.speed.exceptions.slice() : [];
    const next = rows.filter((row) => row.host !== host);
    next.push({ host, connections, userAgent, username, password });
    model.speed.exceptions = next;
    hostInput.value = '';
    const uaInput = document.getElementById('exception-ua');
    const userInput = document.getElementById('exception-user');
    const passInput = document.getElementById('exception-pass');
    if (uaInput) uaInput.value = '';
    if (userInput) userInput.value = '';
    if (passInput) passInput.value = '';
    paintExceptions();
    scheduleSave();
    hostInput.focus();
  }

  async function libraryAction(channel) {
    showLibraryNote('');
    let result = null;
    try { result = await zdm.invoke(channel); } catch { result = null; }
    showLibraryNote(result && result.message ? result.message : '');
  }

  const minPreset = document.getElementById('min-capture-preset');
  if (minPreset) {
    minPreset.addEventListener('change', () => {
      const input = overlay.querySelector('[data-setting="catch.minCaptureKB"]');
      if (!input || !model.catch) return;
      const next = minPreset.value === 'custom' ? 0 : Number(minPreset.value);
      input.hidden = false;
      input.value = String(next);
      model.catch.minCaptureKB = next;
      scheduleSave();
    });
  }

  const scanBrowsers = document.getElementById('btn-scan-browsers');
  if (scanBrowsers) {
    scanBrowsers.addEventListener('click', async () => {
      scanBrowsers.disabled = true;
      try {
        const found = await zdm.invoke('browsers:scan');
        if (Array.isArray(found)) {
          if (!model.catch) model.catch = {};
          model.catch.detected = found;
          paintBrowsers(found);
        }
      } catch { /* the last list stays */ }
      scanBrowsers.disabled = false;
    });
  }

  const sweepButton = document.getElementById('btn-sweep-missing');
  const exportButton = document.getElementById('btn-library-export');
  const importButton = document.getElementById('btn-library-import');
  const settingsExportBtn = document.getElementById('btn-settings-export');
  const settingsImportBtn = document.getElementById('btn-settings-import');
  if (sweepButton) sweepButton.addEventListener('click', () => libraryAction('library:sweep-missing'));
  if (exportButton) exportButton.addEventListener('click', () => libraryAction('library:export'));
  if (importButton) importButton.addEventListener('click', () => libraryAction('library:import'));
  if (settingsExportBtn) {
    settingsExportBtn.addEventListener('click', async () => {
      showSettingsNote('');
      let res = null;
      try { res = await zdm.invoke('settings:export'); } catch {}
      if (res && res.message) showSettingsNote(res.message);
    });
  }
  if (settingsImportBtn) {
    settingsImportBtn.addEventListener('click', async () => {
      showSettingsNote('');
      let res = null;
      try { res = await zdm.invoke('settings:import'); } catch {}
      if (res && res.message) showSettingsNote(res.message);
      if (res && res.ok && res.settings) {
        model = res.settings;
        paintForm();
      }
    });
  }

  const restoreDialogsBtn = document.getElementById('btn-restore-dialogs');
  if (restoreDialogsBtn) {
    restoreDialogsBtn.addEventListener('click', () => {
      if (!model.behavior) model.behavior = {};
      model.behavior.showCompleteDialog = true;
      model.behavior.confirmBeforeStart = true;
      model.behavior.duplicateAction = 'ask';
      model.behavior.confirmDelete = true;
      model.behavior.cancelAsk = true;
      model.behavior.queueOnLater = true;
      scheduleSave();
      paintForm();
      const note = document.getElementById('restore-dialogs-note');
      if (note) {
        note.hidden = false;
        note.textContent = 'All dialogs and confirmation prompts have been restored.';
      }
    });
  }

  const exceptionAdd = document.getElementById('exception-add');
  const exceptionHost = document.getElementById('exception-host');
  if (exceptionAdd) exceptionAdd.addEventListener('click', addException);
  overlay.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!model) return;
      const picked = [...overlay.querySelectorAll('[data-day]')]
        .filter((box) => box.checked)
        .map((box) => Number(box.dataset.day));
      if (!model.schedule) model.schedule = {};
      model.schedule.days = picked.length ? picked : [new Date().getDay()];
      if (!picked.length) paintDays();
      scheduleSave();
    });
  });

  if (exceptionHost) {
    exceptionHost.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addException();
    });
    exceptionHost.addEventListener('input', () => {
      const error = document.getElementById('exception-error');
      if (error) error.hidden = true;
    });
  }

  document.getElementById('btn-settings-close').addEventListener('click', close);
  document.getElementById('btn-settings-done').addEventListener('click', async () => {
    if (extensionSetup && currentPane === 'catch') {
      showPane('extension-custom');
      document.getElementById('btn-settings-done').textContent = 'Done';
      return;
    }
    clearTimeout(saveTimer);
    await persist(saveGen);
    close();
  });
  document.getElementById('btn-settings-reset').addEventListener('click', async () => {
    const pane = currentPane || (overlay.querySelector('.settings-pane.active')?.dataset.pane) || 'launch';
    clearTimeout(saveTimer);
    saveGen += 1;
    if (persistFlight) {
      try { await persistFlight; } catch {}
    }
    if (PANE_DEFAULTS[pane] && model) {
      if (pane === 'look') {
        const currentTheme = (model.appearance && model.appearance.theme) || 'theme1';
        model.appearance = {
          ...JSON.parse(JSON.stringify(PANE_DEFAULTS.look)),
          theme: currentTheme,
        };
      } else if (pane === 'library') {
        Object.assign(model.library, JSON.parse(JSON.stringify(PANE_DEFAULTS.library)));
        if (model.library.defaultPath) {
          model.library.folders = defaultLibraryFolders(model.library.defaultPath);
        }
      } else if (pane === 'catch') {
        Object.assign(model.catch, JSON.parse(JSON.stringify(PANE_DEFAULTS.catch)));
        if (Array.isArray(model.catch.detected)) {
          model.catch.detected = model.catch.detected.map((item) => ({ ...item, enabled: true }));
        }
      } else if (pane === 'speed') {
        model.speed = JSON.parse(JSON.stringify(PANE_DEFAULTS.speed));
        const exHost = document.getElementById('exception-host');
        if (exHost) exHost.value = '';
        const exUa = document.getElementById('exception-ua');
        if (exUa) exUa.value = '';
        const exUser = document.getElementById('exception-user');
        if (exUser) exUser.value = '';
        const exPass = document.getElementById('exception-pass');
        if (exPass) exPass.value = '';
      } else if (pane === 'proxy') {
        model.proxy = JSON.parse(JSON.stringify(PANE_DEFAULTS.proxy));
      } else if (pane === 'behavior') {
        model.behavior = JSON.parse(JSON.stringify(PANE_DEFAULTS.behavior));
      } else if (pane === 'launch') {
        model.launch = JSON.parse(JSON.stringify(PANE_DEFAULTS.launch));
      }
    }
    window.zdmSettings = model;
    paintForm();
    showPane(pane);
    if (pane === 'look') pushAppearance();
    try {
      const restored = await zdm.invoke('settings:restore-part', pane);
      if (restored) {
        model = restored;
        window.zdmSettings = model;
        paintForm();
        showPane(pane);
        if (pane === 'look') pushAppearance();
      }
    } catch {
      await persist(saveGen);
    }
    scheduleSave();
    const btn = document.getElementById('btn-settings-reset');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Restored';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function showGuideNote(text) {
    const note = document.getElementById('guide-open-note');
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || '';
  }

  overlay.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    if (!target) return;
    const guide = target.closest('.guide-link');
    if (guide) {
      showGuideNote('');
      try {
        const res = await zdm.invoke('guides:open', guide.dataset.guide);
        if (!res || !res.ok) {
          showGuideNote((res && res.error) || 'The guide did not open. Close ZDM completely, then open it again.');
        }
      } catch {
        showGuideNote('The guide did not open. Close ZDM completely, then open it again.');
      }
      return;
    }
    const chip = target.closest('.copy-chip');
    if (!chip) return;
    const value = chip.dataset.copy || '';
    const orig = value;
    try {
      const res = await zdm.invoke('guides:copy', value);
      chip.textContent = res && res.ok ? 'Copied' : 'Failed';
    } catch {
      chip.textContent = 'Failed';
    }
    setTimeout(() => { chip.textContent = orig; }, 1200);
  });

  async function open() {
    try {
      model = await zdm.invoke('settings:get');
    } catch {
      model = window.zdmSettings;
    }
    if (!model) return;
    if (model.catch && Array.isArray(model.catch.detected)) {
      model.catch.detected.forEach((row) => {
        if (row) row.connected = !!(row.extension && row.extension.enabled);
      });
    }
    window.zdmSettings = model;
    paintForm();
    if (extensionSetup) {
      document.body.classList.add('is-extension-setup');
      document.title = 'Extension Setup';
      const brand = document.querySelector('.setup-brand');
      if (brand) brand.hidden = false;
      const done = document.getElementById('btn-settings-done');
      if (done) done.textContent = 'Next';
      bindSetupChoices();
      showPane('catch');
    } else {
      showPane('launch');
    }
    overlay.classList.add('visible');
  }

  function bindSetupChoices() {
    const quality = getPath(model, 'video.qualityMode') || 'full';
    const fps = getPath(model, 'video.fpsDisplay') || '60';
    overlay.querySelectorAll('input[name="setupQuality"]').forEach((el) => {
      el.checked = el.value === quality;
      el.addEventListener('change', () => {
        if (!el.checked) return;
        setPath(model, 'video.qualityMode', el.value);
        setPath(model, 'video.qualityStamp', Date.now());
        scheduleSave();
      });
    });
    overlay.querySelectorAll('input[name="setupFps"]').forEach((el) => {
      el.checked = el.value === fps;
      el.addEventListener('change', () => {
        if (!el.checked) return;
        setPath(model, 'video.fpsDisplay', el.value);
        setPath(model, 'video.qualityStamp', Date.now());
        scheduleSave();
      });
    });
  }

  function close() {
    if (document.body.dataset.window === 'settings') {
      window.close();
      return;
    }
    overlay.classList.remove('visible');
  }

  window.zdmDialog = { open, close };
  if (document.body.dataset.window === 'settings') open();
})();
