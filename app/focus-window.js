const { app } = require('electron');

function bringWindowToFront(win, options = {}) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.setSkipTaskbar(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  if (typeof win.moveTop === 'function') win.moveTop();
  win.show();
  win.focus();
  win.flashFrame(true);
  if (!options.solo && typeof app.focus === 'function') app.focus({ steal: true });
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 400);
}

function sendWhenReady(win, channel, data) {
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  };
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send);
  else send();
}

module.exports = { bringWindowToFront, sendWhenReady };
