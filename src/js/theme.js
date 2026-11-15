(function () {
  const THEME2 = new Set([
    'add-playlist.png', 'add-url.png', 'all-downloads.png', 'compress.png', 'delete.png',
    'documents.png', 'download.png', 'finished.png', 'main-queues.png', 'open-folder.png', 'options.png',
    'queues.png', 'resume.png', 'scheduler.png', 'start-queue.png', 'stop-all.png',
    'stop-queue.png', 'stop.png', 'sync.png', 'unfinished.png', 'video.png', 'grabber.png',
    'music.png', 'programs.png',
  ]);

  const XJAY = new Set([
    'add-playlist.png', 'add-url.png', 'all-downloads.png', 'compress.png', 'delete.png',
    'docs.png', 'documents.png', 'download.png', 'finished.png', 'grabber-projects.png',
    'grabber.png', 'main-queues.png', 'music.png', 'open-folder.png', 'options.png',
    'programs.png', 'queues.png', 'resume.png', 'scheduler.png', 'start-queue.png',
    'stop-all.png', 'stop-queue.png', 'stop.png', 'sync.png', 'unfinished.png', 'video.png',
  ]);

  function resolveThemeIcon(img, theme) {
    const raw = img.getAttribute('data-icon-src') || img.getAttribute('src') || '';
    if (!raw.includes('assets/ui/')) return;
    img.classList.remove('icon-grad');
    img.style.webkitMaskImage = '';
    img.style.maskImage = '';
    if (raw.includes('/num/')) {
      const file = raw.split('/num/').pop();
      const treeItem = img.closest ? img.closest('.tree-item') : null;
      const next = (theme === 'theme3' && treeItem && !treeItem.classList.contains('active'))
        ? `assets/ui/num/${file}`
        : (theme === 'theme3' ? `assets/ui/xjay/num/${file}` : `assets/ui/num/${file}`);
      if (img.getAttribute('src') !== next) img.setAttribute('src', next);
      return;
    }
    const plain = raw.replace(/assets\/ui\/(?:theme[23]|xjay)\//, 'assets/ui/');
    const file = plain.split('assets/ui/')[1] || '';
    let next;
    if (theme === 'theme3') {
      const treeItem = img.closest ? img.closest('.tree-item') : null;
      if (treeItem && !treeItem.classList.contains('active')) {
        next = THEME2.has(file) ? `assets/ui/theme2/${file}` : plain;
      } else {
        next = XJAY.has(file) ? `assets/ui/xjay/${file}` : plain;
      }
    } else {
      const folder = theme === 'theme1' || theme === 'theme4' ? 'theme2' : theme === 'theme2' ? 'theme3' : 'xjay';
      next = THEME2.has(file) ? `assets/ui/${folder}/${file}` : plain;
    }
    if (img.getAttribute('src') !== next) img.setAttribute('src', next);
  }

  function paintIcons(theme) {
    document.querySelectorAll('img').forEach((img) => resolveThemeIcon(img, theme));
  }

  function ensureIconFilter() {
    if (document.getElementById('zdm-icon-filters')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'zdm-icon-filters');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const add = (id, values) => {
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', id);
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', values);
      filter.appendChild(matrix);
      svg.appendChild(filter);
    };
    add('zdm-icon-blue', '0 0 0 0 0.4314 0 0 0 0 0.6196 0 0 0 0 0.8314 0 0 0 1 0');
    add('zdm-icon-red', '0 0 0 0 0.8824 0 0 0 0 0.3647 0 0 0 0 0.3647 0 0 0 1 0');
    if (document.documentElement) document.documentElement.appendChild(svg);
  }

  function applyAppearance(appearance) {
    if (!appearance) return;
    ensureIconFilter();
    const picked = appearance.theme;
    const theme = picked === 'theme2' || picked === 'theme3' || picked === 'theme4' ? picked : 'theme1';
    const lines = !!appearance.columnLines;
    const raw = appearance.iconSaturation;
    const pct = Number.isFinite(Number(raw)) ? Math.min(100, Math.max(0, Math.round(Number(raw)))) : 100;
    if (document.documentElement) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.lines = lines ? 'on' : 'off';
      document.documentElement.style.setProperty('--icon-saturate', String(pct / 100));
    }
    try {
      localStorage.setItem('zdm_appearance', JSON.stringify(appearance));
    } catch {}
    paintIcons(theme);
  }

  window.zdmTheme = { apply: applyAppearance, paint: () => paintIcons(document.documentElement ? document.documentElement.dataset.theme : 'theme1') };

  const zdm = window.zdm;
  if (zdm && zdm.on) {
    zdm.on('appearance:changed', (appearance) => applyAppearance(appearance));
  }

  const initial = (zdm && zdm.initialAppearance) || (() => {
    try { return JSON.parse(localStorage.getItem('zdm_appearance') || '{}'); } catch { return null; }
  })();

  if (initial && typeof initial === 'object') {
    applyAppearance(initial);
  }

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver((mutations) => {
      const curTheme = document.documentElement.dataset.theme || 'theme1';
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') resolveThemeIcon(node, curTheme);
          else if (node.querySelectorAll) {
            node.querySelectorAll('img').forEach((img) => resolveThemeIcon(img, curTheme));
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const curTheme = document.documentElement ? document.documentElement.dataset.theme : 'theme1';
      paintIcons(curTheme);
    });
  }

  (async () => {
    let settings = window.zdmSettings;
    if (!settings && zdm && zdm.invoke) {
      try { settings = await zdm.invoke('settings:get'); } catch { settings = null; }
    }
    if (settings && settings.appearance) applyAppearance(settings.appearance);
  })();
})();
