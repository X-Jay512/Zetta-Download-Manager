let current = null;

function setMainWindow(win) {
  current = win && !win.isDestroyed() ? win : null;
}

function getMainWindow() {
  if (current && current.isDestroyed()) current = null;
  return current;
}

module.exports = { setMainWindow, getMainWindow };
