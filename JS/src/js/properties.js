function siteReferrer(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'ftp:'].includes(parsed.protocol)) return '';
    return `${parsed.origin}/`;
  } catch {
    return '';
  }
}

function authFromHeaders(headers) {
  const raw = headers?.Authorization || headers?.authorization || '';
  const match = String(raw).match(/^Basic\s+(.+)$/i);
  if (!match) return { login: '', password: '' };
  try {
    const decoded = atob(match[1]);
    const split = decoded.indexOf(':');
    if (split < 0) return { login: decoded, password: '' };
    return { login: decoded.slice(0, split), password: decoded.slice(split + 1) };
  } catch {
    return { login: '', password: '' };
  }
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

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i] + ` (${bytes.toLocaleString()} Bytes)`;
}

async function init() {
  const data = await window.zdm.invoke('app:get-properties');
  if (!data) return;

  document.getElementById('prop-fileName').innerText = data.fileName || 'Unknown';
  document.getElementById('prop-status').innerText = data.status || 'Unknown';
  if (data.duration > 0) {
    document.getElementById('prop-size-label').textContent = 'Duration:';
    document.getElementById('prop-size').innerText = formatDuration(data.duration);
  } else {
    document.getElementById('prop-size-label').textContent = 'Size:';
    document.getElementById('prop-size').innerText = formatSize(data.fileSize || data.progress?.total || 0);
  }
  document.getElementById('prop-path').value = data.path || '';
  document.getElementById('prop-url').value = data.url || '';
  document.getElementById('prop-description').value = data.description || '';
  const problemRow = document.getElementById('prop-problem-row');
  if (data.status === 'error' && data.error) {
    problemRow.hidden = false;
    document.getElementById('prop-problem').textContent = data.errorTitle
      ? `${data.errorTitle}. ${data.error}`
      : data.error;
  }
  const headers = data.headers || {};
  const referer = data.referrer || headers.Referer || headers.referer || siteReferrer(data.url) || '';
  document.getElementById('prop-referer').value = referer;
  const savedAuth = authFromHeaders(headers);
  document.getElementById('prop-login').value = data.login || savedAuth.login || '';
  document.getElementById('prop-password').value = data.password || savedAuth.password || '';

  // Extract extension for a pseudo-type
  let typeStr = 'Unknown File';
  if (data.fileName) {
    const ext = data.fileName.split('.').pop().toUpperCase();
    if (ext && ext !== data.fileName.toUpperCase()) {
      typeStr = `${ext} File`;
    }
  }
  document.getElementById('prop-type').innerText = typeStr;
  
  const iconBox = document.getElementById('prop-icon');
  iconBox.textContent = '';
  try {
    const url = await window.zdm.invoke('shell:file-icon', {
      filePath: data.path || '',
      fileName: data.fileName || 'file.bin',
    });
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      iconBox.appendChild(img);
    }
  } catch { /* keep the box empty if Windows has no icon */ }

  // Actions
  document.getElementById('btn-close').addEventListener('click', () => {
    window.close();
  });
  
  document.getElementById('btn-open-file').addEventListener('click', () => {
    if (data.path) {
      window.zdm.send('download:open-file', data.path);
      window.close();
    }
  });

  document.getElementById('btn-open-folder').addEventListener('click', () => {
    if (data.path) {
      window.zdm.send('download:open-folder', data.path);
    }
  });
}

init();
