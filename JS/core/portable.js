const path = require('path');
const fs = require('fs');

function portableDir() {
  const { app } = require('electron');
  const base = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  return path.join(base, '.zdm');
}

function usePortableDir() {
  const dir = portableDir();
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      require('electron').app.setPath('userData', dir);
      return dir;
    }
  } catch { /* keep the normal user folder */ }
  return '';
}

function portableStatus() {
  const { app } = require('electron');
  const dir = portableDir();
  const active = path.normalize(app.getPath('userData')) === path.normalize(dir);
  return { active, path: dir };
}

function enablePortable() {
  const { app } = require('electron');
  const dest = portableDir();
  const status = portableStatus();
  if (status.active) {
    return { active: true, message: 'Settings and the download list are already stored beside the app.' };
  }
  fs.mkdirSync(dest, { recursive: true });
  const src = app.getPath('userData');
  let copied = 0;
  try {
    for (const name of fs.readdirSync(src)) {
      if (!name.endsWith('.json')) continue;
      const from = path.join(src, name);
      const to = path.join(dest, name);
      if (fs.existsSync(to) || !fs.statSync(from).isFile()) continue;
      fs.copyFileSync(from, to);
      copied += 1;
    }
  } catch { /* the folder still switches on the next launch */ }
  return {
    active: false,
    created: true,
    copied,
    message: 'The .zdm folder is ready. Quit ZDM and open it again to keep settings and downloads beside the app.',
  };
}

module.exports = { portableDir, usePortableDir, portableStatus, enablePortable };
