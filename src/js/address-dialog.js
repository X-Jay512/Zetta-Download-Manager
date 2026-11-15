(function () {
const zdm = window.zdm;

const $ = (id) => document.getElementById(id);

let history = [];
let baseH = 168;
let confirming = false;

function setAuthEnabled(on) {
  $('input-login').disabled = !on;
  $('input-password').disabled = !on;
}

function fit(extra = 0) {
  if (!zdm.invoke) return;
  zdm.invoke('window:fit-address-dialog', baseH + extra);
}

function measure() {
  requestAnimationFrame(() => {
    const sheet = document.querySelector('.sheet');
    const h = Math.ceil(sheet.getBoundingClientRect().height);
    if (h > 0) baseH = h;
    fit(0);
  });
}

function showError(msg) {
  $('addr-error').textContent = msg || '';
  measure();
}

async function confirmAddress() {
  if (confirming) return;
  showError('');
  const url = $('input-address').value.trim();
  if (!url) {
    showError('Enter an address.');
    $('input-address').focus();
    return;
  }
  confirming = true;
  const useAuth = $('use-auth').checked;
  try {
    const result = await zdm.invoke('window:confirm-address', {
      url,
      useAuth,
      login: useAuth ? $('input-login').value : '',
      password: useAuth ? $('input-password').value : '',
    });
    if (result && result.ok === false) {
      confirming = false;
      showError(result.error || 'Enter a valid address.');
      $('input-address').focus();
    }
  } catch (err) {
    confirming = false;
    showError(err && err.message ? err.message : 'Could not open the download window.');
  }
}

$('use-auth').addEventListener('change', () => {
  const on = $('use-auth').checked;
  setAuthEnabled(on);
  if (on) $('input-login').focus();
});

$('btn-ok').addEventListener('click', confirmAddress);
$('btn-cancel').addEventListener('click', () => window.close());

$('btn-history').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!history.length || !zdm.invoke) return;
  const rect = $('input-address').getBoundingClientRect();
  zdm.invoke('window:toggle-address-history', {
    x: rect.left,
    y: rect.bottom,
    width: rect.width,
  });
});

function fillAddress(url) {
  if (!url) return;
  $('input-address').value = url;
  $('input-address').focus();
  $('input-address').select();
}

if (zdm.on) {
  zdm.on('address:history-pick', fillAddress);
  zdm.on('address:prefill', fillAddress);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.close();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'button' && e.target.id === 'btn-cancel') return;
    e.preventDefault();
    confirmAddress();
  }
});

async function init() {
  setAuthEnabled(false);
  try {
    const saved = await zdm.invoke('app:get-address-history');
    history = Array.isArray(saved) ? saved : [];
  } catch {
    history = [];
  }
  try {
    const prefill = await zdm.invoke('app:get-address-prefill');
    if (prefill) fillAddress(prefill);
  } catch { /* the field stays empty */ }
  $('input-address').focus();
  measure();
}

init();
})();
