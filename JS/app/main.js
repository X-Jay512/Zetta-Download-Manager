const { app, BrowserWindow, ipcMain, Menu, nativeImage } = require('electron');
app.commandLine.appendSwitch('enable-logging');
const path = require('path');
const fs = require('fs');
const os = require('os');

function keepExistingProfile() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const nextDir = path.join(roaming, 'Zetta Download Manager');
  if (fs.existsSync(nextDir)) return;
  for (const name of ['flash-download-manager', 'Flash Download Manager']) {
    const oldDir = path.join(roaming, name);
    try {
      if (fs.existsSync(oldDir) && fs.statSync(oldDir).isDirectory()) {
        app.setPath('userData', oldDir);
        return;
      }
    } catch { /* use the new profile folder */ }
  }
}

app.setPath('userData', path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Zetta Download Manager Publish'));
const { TrayManager } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { initAutoUpdater } = require('./updater');
const { NativeHostServer } = require('../core/native-host/server');
const { bringWindowToFront, sendWhenReady } = require('./focus-window');
const { setMainWindow, getMainWindow } = require('./window-ref');
const { usePortableDir } = require('../core/portable');

usePortableDir();

let mainWindow = null;
let trayManager = null;
let nativeHostServer = null;

const WINDOW_CONFIG = {
  width: 1180,
  height: 680,
  minWidth: 1140,
  minHeight: 560,
  frame: true,
  thickFrame: true,
  roundedCorners: true,
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#070707',
    symbolColor: '#f7f7f7',
    height: 32,
  },
  autoHideMenuBar: true,
  icon: path.join(__dirname, '..', 'src', 'assets', 'icons', 'app.png'),
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
};

function getWindowConfig() {
  try {
    const { SettingsManager } = require('../core/storage/settings');
    const s = new SettingsManager();
    const theme = s.get('appearance.theme');
    const isLight = theme === 'theme2';
    const bg = isLight ? '#eef1f6' : '#18191c';
    return {
      ...WINDOW_CONFIG,
      backgroundColor: bg,
      titleBarOverlay: {
        color: bg,
        symbolColor: isLight ? '#1c2230' : '#f3f3f4',
        height: 32,
      },
    };
  } catch {
    return {
      ...WINDOW_CONFIG,
      backgroundColor: '#18191c',
      titleBarOverlay: {
        color: '#18191c',
        symbolColor: '#f3f3f4',
        height: 32,
      },
    };
  }
}

function createMainWindow() {
  const win = new BrowserWindow(getWindowConfig());
  win.webContents.setBackgroundThrottling(false);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.on('closed', () => {
    if (getMainWindow() === win) setMainWindow(null);
  });
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow = win;
  setMainWindow(win);
  return win;
}

function showMainWindow() {
  const win = getMainWindow() || createMainWindow();
  bringWindowToFront(win);
  return win;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    const { SettingsManager } = require('../core/storage/settings');
    const launch = new SettingsManager();
    if (!launch.get('launch.startMinimized')) createMainWindow();
    const trayHooks = {
      show: () => showMainWindow(),
      startQueue: () => {},
      getQueues: () => [],
    };
    trayManager = new TrayManager(trayHooks);
    nativeHostServer = new NativeHostServer();
    registerIpcHandlers(getMainWindow(), nativeHostServer, trayHooks);

    nativeHostServer.on('new-download', (data) => {
      const win = getMainWindow();
      if (win) sendWhenReady(win, 'new-download-from-browser', data);
    });

    nativeHostServer.on('browser-connected', (info) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('browser:status-changed', info);
      }
    });

    nativeHostServer.start();
    initAutoUpdater(getMainWindow());
  });

app.on('before-quit', () => {
  app.isQuitting = true;
  if (nativeHostServer) nativeHostServer.stop();
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  showMainWindow();
});
}
