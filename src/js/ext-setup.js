(function () {
  const zdm = window.zdm;
  if (!zdm) return;

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
    if (!box) return;
    const list = Array.isArray(rows) ? rows : window._browsers || [];
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
        }).catch(() => { browserIconCache.set(exe, ''); });
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
        const badge = document.createElement('span');
        badge.className = 'browser-status-connected';
        const badgeText = document.createElement('span');
        badgeText.textContent = 'Connected';
        badge.appendChild(badgeText);
        actions.appendChild(badge);
      }

      if (row.family === 'firefox') {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn-browser-install';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', async () => {
          try {
            await zdm.invoke('browsers:copy-extension-path', 'manifest');
            copyBtn.textContent = 'Copied';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
          } catch {}
        });
        actions.appendChild(copyBtn);
      } else if (row.id === 'chrome') {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn-browser-install';
        copyBtn.textContent = 'Copy path';
        copyBtn.addEventListener('click', async () => {
          try {
            await zdm.invoke('browsers:copy-extension-path', 'folder');
            copyBtn.textContent = 'Copied';
            setTimeout(() => { copyBtn.textContent = 'Copy path'; }, 1200);
          } catch {}
        });
        actions.appendChild(copyBtn);
      }

      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'btn-browser-install';
      const storeButton = row.installable === false;
      installBtn.textContent = storeButton ? (row.storeName || 'Open store') : 'Install';
      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        const orig = installBtn.textContent;
        installBtn.textContent = storeButton ? 'Opening...' : 'Installing...';
        try {
          const res = await zdm.invoke('browsers:install-extension', row.id);
          if (res && res.openedStore) {
            installBtn.textContent = row.storeName || 'Store opened';
            installBtn.disabled = false;
            return;
          }
          if (res && res.connected) {
            row.connected = true;
            row.extension = res.detail || row.extension;
            paintBrowsers();
          } else {
            installBtn.textContent = (res && res.error) ? 'Failed' : 'Not in the browser yet';
            installBtn.disabled = false;
          }
        } catch {
          installBtn.textContent = 'Failed';
          installBtn.disabled = false;
        }
      });
      actions.appendChild(installBtn);

      rowEl.appendChild(info);
      rowEl.appendChild(actions);
      box.appendChild(rowEl);
    }
  }

  async function loadBrowsers() {
    try {
      const found = await zdm.invoke('browsers:scan');
      if (Array.isArray(found)) {
        window._browsers = found;
        paintBrowsers(found);
      }
    } catch {}
  }

  const scanBtn = document.getElementById('btn-scan-browsers');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      await loadBrowsers();
      scanBtn.disabled = false;
    });
  }

  function showGuideNote(text) {
    const note = document.getElementById('guide-open-note');
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || '';
  }

  document.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    if (!target) return;
    const guide = target.closest('.guide-link');
    if (guide) {
      showGuideNote('');
      try {
        const res = await zdm.invoke('guides:open', guide.dataset.guide);
        if (!res || !res.ok) {
          showGuideNote((res && res.error) || 'The guide did not open.');
        }
      } catch {
        showGuideNote('The guide did not open.');
      }
      return;
    }
    const chip = target.closest('.copy-chip');
    if (!chip) return;
    const value = chip.dataset.copy || '';
    try {
      const res = await zdm.invoke('guides:copy', value);
      chip.textContent = res && res.ok ? 'Copied' : 'Failed';
    } catch {
      chip.textContent = 'Failed';
    }
    setTimeout(() => { chip.textContent = value; }, 1200);
  });

  const nextBtn = document.getElementById('btn-setup-next');
  const backBtn = document.getElementById('btn-setup-back');

  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (nextBtn.dataset.step !== 'done') {
        document.getElementById('page-extension').hidden = true;
        document.getElementById('page-custom').hidden = false;
        nextBtn.dataset.step = 'done';
        nextBtn.textContent = 'Done';
        if (backBtn) backBtn.hidden = false;
        return;
      }
      const qualityMode = (document.querySelector('input[name="qualityMode"]:checked') || {}).value || 'full';
      const fpsDisplay = (document.querySelector('input[name="fpsDisplay"]:checked') || {}).value || '60';
      try {
        await zdm.invoke('ext-setup:done', { qualityMode, fpsDisplay });
      } catch {}
      window.close();
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.getElementById('page-custom').hidden = true;
      document.getElementById('page-extension').hidden = false;
      nextBtn.dataset.step = 'next';
      nextBtn.textContent = 'Next';
      backBtn.hidden = true;
    });
  }

  try {
    zdm.invoke('settings:get').then((all) => {
      const video = (all && all.video) || {};
      if (video.qualityMode) {
        const qRadio = document.querySelector(`input[name="qualityMode"][value="${video.qualityMode}"]`);
        if (qRadio) qRadio.checked = true;
      }
      if (video.fpsDisplay) {
        const fRadio = document.querySelector(`input[name="fpsDisplay"][value="${video.fpsDisplay}"]`);
        if (fRadio) fRadio.checked = true;
      }
    }).catch(() => {});
  } catch {}

  loadBrowsers();
})();
