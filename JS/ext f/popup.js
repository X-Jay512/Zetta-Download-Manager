const APP = 'http://127.0.0.1:29512';

let currentButtonStyle = 'square';
const popupLogoEl = document.getElementById('popup-logo');
const popupLogoFrameEl = document.getElementById('popup-logo-frame');
const popupLogoArrowEl = document.getElementById('popup-logo-arrow');

function updateLogoUI(style) {
  const isCircle = style === 'circle';
  if (popupLogoEl) {
    popupLogoEl.classList.toggle('is-circle', isCircle);
    popupLogoEl.classList.toggle('is-square', !isCircle);
    popupLogoEl.title = isCircle ? 'Switch to Square style' : 'Switch to Circle style';
  }
  if (popupLogoFrameEl) {
    popupLogoFrameEl.src = isCircle ? 'icons/icon-circle-frame.png' : 'icons/icon-square-frame.png';
  }
  if (popupLogoArrowEl) {
    popupLogoArrowEl.src = isCircle ? 'icons/icon-circle-arrow.png' : 'icons/icon-square-arrow.png';
  }
}

function setButtonStyle(style) {
  currentButtonStyle = style === 'circle' ? 'circle' : 'square';
  updateLogoUI(currentButtonStyle);
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ buttonStyle: currentButtonStyle });
  }
  chrome.runtime.sendMessage({ type: 'button-style-changed', style: currentButtonStyle }).catch(() => {});
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (tab && tab.id != null) {
          chrome.tabs.sendMessage(tab.id, { type: 'set-button-style', style: currentButtonStyle }).catch(() => {});
        }
      }
    });
  }
}

function toggleButtonStyle() {
  const next = currentButtonStyle === 'circle' ? 'square' : 'circle';
  setButtonStyle(next);
}

if (popupLogoEl) {
  popupLogoEl.addEventListener('click', toggleButtonStyle);
  popupLogoEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleButtonStyle();
    }
  });
}

if (chrome.storage && chrome.storage.local) {
  chrome.storage.local.get({ buttonStyle: 'square' }, (stored) => {
    currentButtonStyle = stored && stored.buttonStyle === 'circle' ? 'circle' : 'square';
    updateLogoUI(currentButtonStyle);
  });
}

const statusEl = document.getElementById('status');
const captureEl = document.getElementById('capture');
const findEl = document.getElementById('find-media');
const silentEl = document.getElementById('silent');
const contextMenuEl = document.getElementById('context-menu');

function setConnected(on) {
  statusEl.textContent = on ? 'Connected' : 'App is not running';
  statusEl.classList.toggle('off', !on);
  captureEl.disabled = !on;
  findEl.disabled = !on;
  silentEl.disabled = !on;
  if (contextMenuEl) contextMenuEl.disabled = !on;
}

async function load() {
  try {
    const ping = await fetch(APP + '/ping');
    if (!ping.ok) throw new Error('down');
    const res = await fetch(APP + '/settings');
    const data = await res.json();
    const catchSettings = data.catch || {};
    captureEl.checked = catchSettings.interceptDownloads !== false;
    findEl.checked = catchSettings.sniffVideos !== false;
    silentEl.checked = catchSettings.addSilently === true;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ contextMenu: true }, (stored) => {
        if (contextMenuEl) contextMenuEl.checked = stored.contextMenu !== false;
      });
    } else if (contextMenuEl) {
      contextMenuEl.checked = catchSettings.contextDownload !== false;
    }
    setConnected(true);
    chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => {});
  } catch {
    setConnected(false);
  }
}

async function save() {
  try {
    await fetch(APP + '/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catch: {
          interceptDownloads: captureEl.checked,
          sniffVideos: findEl.checked,
          addSilently: silentEl.checked,
          contextDownload: contextMenuEl ? contextMenuEl.checked : true,
        },
      }),
    });
    setConnected(true);
    chrome.runtime.sendMessage({ type: 'settings-changed' }).catch(() => {});
  } catch {
    setConnected(false);
  }
}

captureEl.addEventListener('change', save);
findEl.addEventListener('change', save);
silentEl.addEventListener('change', save);
if (contextMenuEl) {
  contextMenuEl.addEventListener('change', () => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ contextMenu: contextMenuEl.checked });
    }
    save();
  });
}
document.getElementById('more').addEventListener('click', () => chrome.runtime.openOptionsPage());
load();
