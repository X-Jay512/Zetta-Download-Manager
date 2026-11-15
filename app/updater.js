'use strict';

const { app, dialog } = require('electron');
let autoUpdater = null;

try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[Updater] electron-updater not loaded:', err ? err.message : err);
}

function initAutoUpdater(win) {
  if (!autoUpdater || !app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update found:', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:downloaded', info);
    }

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `A new version of Zetta Download Manager (${info.version}) has been downloaded.`,
      detail: 'Restart now to apply the update, or it will be installed when you exit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((res) => {
      if (res.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Error:', err ? err.message : err);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[Updater] Check failed:', err ? err.message : err);
    });
  }, 8000);
}

module.exports = { initAutoUpdater };
