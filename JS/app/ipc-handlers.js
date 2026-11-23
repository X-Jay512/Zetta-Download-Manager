const { BrowserWindow, dialog, clipboard, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { bringWindowToFront } = require('./focus-window');
const { setMainWindow, getMainWindow } = require('./window-ref');
const { listPlaylist, formatsForUrl, muxVideoAudio } = require('./media-tools');

const GUIDES = {
  'developer-mode': 'developer-mode.html',
  chrome: 'chrome.html',
  firefox: 'firefox.html',
};

function registerIpcHandlers(initialWindow) {
  setMainWindow(initialWindow);
  const liveWindow = () => getMainWindow();
  const appearance = { theme: 'theme1', columnLines: false, iconSaturation: 100 };

  function windowColor() {
    return appearance.theme === 'theme2' ? '#eef1f6' : '#18191c';
  }

  function cardColor() {
    return appearance.theme === 'theme2' ? '#ffffff' : '#232428';
  }

  function titleBarOverlayFor(kind = 'main') {
    const isLight = appearance.theme === 'theme2';
    return {
      color: kind === 'dialog'
        ? (isLight ? '#ffffff' : '#232428')
        : (isLight ? '#eef1f6' : '#18191c'),
      symbolColor: isLight ? '#1c2230' : '#f3f3f4',
      height: 32,
    };
  }

  function paintMainChrome() {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed()) continue;
      const isDialog = win !== liveWindow() && win !== settingsSlot.win;
      try { win.setBackgroundColor(isDialog ? cardColor() : windowColor()); } catch { /* popup may not accept a color yet */ }
      try { win.setTitleBarOverlay(titleBarOverlayFor(isDialog ? 'dialog' : 'main')); } catch { /* frameless popups have no overlay */ }
    }
  }

  function revealPopup(win) {
    if (!win || win.isDestroyed()) return;
    try { bringWindowToFront(win, { solo: true }); }
    catch { try { win.show(); win.focus(); } catch { /* already gone */ } }
  }

  function watchPopup(win) {
    if (!win || win.isDestroyed()) return;
    win.setMenu(null);
    win.once('ready-to-show', () => revealPopup(win));
    win.webContents.once('did-finish-load', () => revealPopup(win));
    win.webContents.once('did-fail-load', () => revealPopup(win));
    revealPopup(win);
  }

  function openWindow(slot, options, fileName, query) {
    if (slot.win && !slot.win.isDestroyed()) {
      revealPopup(slot.win);
      return slot.win;
    }
    const win = new BrowserWindow({
      show: true,
      frame: true,
      thickFrame: true,
      roundedCorners: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlayFor(options.kind || 'main'),
      autoHideMenuBar: true,
      backgroundColor: options.kind === 'dialog' ? cardColor() : windowColor(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      ...options,
    });
    slot.win = win;
    win.on('closed', () => { if (slot.win === win) slot.win = null; });
    watchPopup(win);
    win.loadFile(path.join(__dirname, '..', 'src', fileName), query ? { query } : undefined);
    paintMainChrome();
    return win;
  }

  const settingsSlot = { win: null };
  const extensionSlot = { win: null };
  const schedulerSlot = { win: null };
  const playlistSlot = { win: null };
  const addSlot = { win: null };
  const addressSlot = { win: null };
  const propertiesSlot = { win: null };
  const guideWins = new Map();

  ipcMain.on('window:minimize', () => { const win = liveWindow(); if (win) win.minimize(); });
  ipcMain.on('window:maximize', () => {
    const win = liveWindow();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close', () => { const win = liveWindow(); if (win) win.close(); });

  ipcMain.on('appearance:get-sync', (event) => { event.returnValue = { ...appearance }; });

  ipcMain.on('appearance:changed', (_e, next) => {
    if (next && next.theme) appearance.theme = next.theme;
    if (next && next.iconSaturation != null) appearance.iconSaturation = next.iconSaturation;
    if (next && next.columnLines != null) appearance.columnLines = !!next.columnLines;
    paintMainChrome();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('appearance:changed', { ...appearance });
    }
  });

  ipcMain.on('window:open-settings', () => {
    try {
      openWindow(settingsSlot, {
        width: 920,
        height: 640,
        title: 'Preferences - Zetta Download Manager',
      }, 'settings.html');
    } catch (err) {
      dialog.showErrorBox('Options', err && err.message ? err.message : 'Could not open Options.');
    }
  });

  ipcMain.on('window:open-extension-setup', () => {
    try {
      const icon = path.join(__dirname, '..', 'src', 'assets', 'icons', 'app.png');
      openWindow(extensionSlot, {
        width: 760,
        height: 680,
        center: true,
        title: 'Extension Setup',
        icon,
      }, 'ext-setup.html');
    } catch (err) {
      dialog.showErrorBox('Install', err && err.message ? err.message : 'Could not open Install.');
    }
  });

  ipcMain.handle('ext-setup:done', async (_e, choice) => {
    const qualityMode = ['full', 'average', 'simple'].includes(choice && choice.qualityMode) ? choice.qualityMode : 'full';
    const fpsDisplay = choice && (choice.fpsDisplay === '30' || choice.fpsDisplay === 'off') ? choice.fpsDisplay : '60';
    return { ok: true, qualityMode, fpsDisplay };
  });

  ipcMain.on('window:open-scheduler', (_e, opts = {}) => {
    try {
      const win = openWindow(schedulerSlot, {
        width: 860,
        height: 600,
        minWidth: 680,
        minHeight: 460,
        title: 'Scheduler - Zetta Download Manager',
      }, 'scheduler.html');
      if (win && opts && (opts.queueId || opts.tab)) {
        win.webContents.once('did-finish-load', () => {
          if (!win.isDestroyed()) win.webContents.send('scheduler:navigate', opts);
        });
      }
    } catch (err) {
      dialog.showErrorBox('Scheduler', err && err.message ? err.message : 'Could not open Scheduler.');
    }
  });

  ipcMain.on('window:open-playlist', () => {
    try {
      openWindow(playlistSlot, { width: 640, height: 520, title: 'Add playlist' }, 'playlist.html');
    } catch (err) {
      dialog.showErrorBox('Playlist', err && err.message ? err.message : 'Could not open Playlist.');
    }
  });

  ipcMain.on('window:open-add-dialog', () => {
    openWindow(addSlot, {
      width: 520,
      height: 260,
      resizable: false,
      kind: 'dialog',
      title: 'Add URL',
    }, 'add-dialog.html');
  });

  ipcMain.on('window:open-address-dialog', () => {
    openWindow(addressSlot, {
      width: 560,
      height: 220,
      resizable: false,
      kind: 'dialog',
      title: 'Add address',
    }, 'address-dialog.html');
  });

  ipcMain.on('window:open-properties', () => {
    openWindow(propertiesSlot, {
      width: 480,
      height: 360,
      resizable: false,
      kind: 'dialog',
      title: 'Properties',
    }, 'properties.html');
  });

  ipcMain.handle('guides:open', async (event, name) => {
    const fileName = GUIDES[name];
    if (!fileName) return { ok: false, error: 'Guide was not found.' };
    const full = path.join(__dirname, '..', 'guid', fileName);
    if (!fs.existsSync(full)) return { ok: false, error: 'Guide was not found.' };
    const existing = guideWins.get(full);
    if (existing && !existing.isDestroyed()) {
      revealPopup(existing);
      return { ok: true };
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const win = new BrowserWindow({
      width: 980,
      height: 780,
      minWidth: 640,
      minHeight: 480,
      show: true,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      autoHideMenuBar: true,
      title: 'Guide',
      backgroundColor: '#16181d',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    guideWins.set(full, win);
    win.on('closed', () => { if (guideWins.get(full) === win) guideWins.delete(full); });
    watchPopup(win);
    try {
      await win.loadFile(full);
    } catch (err) {
      try { if (!win.isDestroyed()) win.close(); } catch { /* already gone */ }
      return { ok: false, error: err && err.message ? err.message : 'Guide could not be opened.' };
    }
    return { ok: true };
  });

  ipcMain.handle('guides:copy', async (_e, text) => {
    if (String(text || '') !== 'chrome://extensions') return { ok: false, error: 'Nothing to copy.' };
    clipboard.writeText('chrome://extensions');
    return { ok: true };
  });

  ipcMain.handle('app:get-info', async () => ({
    name: 'Zetta Download Manager',
    version: '1.0.0',
  }));

  ipcMain.handle('playlist:list', async (_e, url) => listPlaylist(url));
  ipcMain.handle('playlist:formats', async (_e, url) => formatsForUrl(url));

  ipcMain.handle('video:mux', async (_e, payload) => {
    const videoPath = payload && payload.videoPath;
    const audioPath = payload && payload.audioPath;
    const outputPath = payload && payload.outputPath;
    if (!videoPath || !audioPath || !outputPath) return { success: false, error: 'Missing paths.' };
    try {
      const result = await muxVideoAudio(videoPath, audioPath, outputPath);
      return { success: true, path: result };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : 'ffmpeg failed' };
    }
  });

  paintMainChrome();
}

module.exports = { registerIpcHandlers };
