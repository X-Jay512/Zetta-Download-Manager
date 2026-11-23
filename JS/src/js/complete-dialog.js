(function () {
const zdm = window.zdm;
const $ = (id) => document.getElementById(id);

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0) + ' ' + units[i];
}

let filePath = '';
let fileUrl = '';

function copyLink(url, button) {
  const text = String(url || '').trim();
  if (!text || !button) return;
  const done = () => {
    button.classList.add('copied');
    button.title = 'Copied';
    setTimeout(() => {
      button.classList.remove('copied');
      button.title = 'Copy link';
    }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    });
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  done();
}

async function closeSheet() {
  if ($('complete-dont-show') && $('complete-dont-show').checked) {
    try {
      await zdm.invoke('settings:update', { behavior: { showCompleteDialog: false } });
    } catch { /* keep the window closing */ }
  }
  window.close();
}

async function init() {
  const data = await zdm.invoke('app:get-complete-dialog-data');
  if (!data) return;
  filePath = data.path || '';
  fileUrl = data.url || '';
  const name = data.fileName || (filePath.split(/[\\/]/).pop()) || 'File';
  const size = Number(data.size) || 0;
  const heading = $('complete-name');
  if (heading) {
    heading.textContent = name;
    heading.title = name;
  }
  $('complete-summary').textContent = size
    ? `Downloaded ${formatSize(size)} (${size.toLocaleString()} Bytes)`
    : 'The file is ready.';
  $('complete-path').value = filePath;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const sheet = document.querySelector('.dialog');
      const h = sheet ? Math.ceil(sheet.offsetHeight) : 0;
      if (h > 0) zdm.invoke('window:fit-complete-dialog', h);
    });
  });
  try {
    const icon = await zdm.invoke('shell:file-icon', name);
    if (icon) $('complete-icon').src = icon;
  } catch { /* no icon */ }
}

$('btn-complete-open').addEventListener('click', () => {
  if (filePath) zdm.send('download:open-file', filePath);
  closeSheet();
});
if ($('btn-complete-open-with')) {
  $('btn-complete-open-with').addEventListener('click', () => {
    if (filePath) zdm.send('download:open-with', filePath);
  });
}
$('btn-complete-folder').addEventListener('click', () => {
  if (filePath) zdm.send('download:open-folder', filePath);
  closeSheet();
});
$('btn-complete-close').addEventListener('click', closeSheet);
if ($('btn-copy-link')) {
  $('btn-copy-link').addEventListener('click', () => copyLink(fileUrl, $('btn-copy-link')));
}

init();
})();
