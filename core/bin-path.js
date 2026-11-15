const path = require('path');
const fs = require('fs');
const os = require('os');

function isPackagedApp() {
  try {
    return !!require('electron').app.isPackaged;
  } catch {
    return false;
  }
}

function userBinFolder() {
  try {
    const { app } = require('electron');
    if (app.isReady()) return path.join(app.getPath('userData'), 'bin');
  } catch { /* before Electron is ready */ }
  return path.join(process.env.APPDATA || os.homedir(), 'Zetta Download Manager', 'bin');
}

function getBinFolder() {
  if (!isPackagedApp()) return path.join(__dirname, '..', 'bin');
  const beside = path.join(process.resourcesPath || '', 'bin');
  try {
    if (beside && fs.existsSync(beside) && fs.readdirSync(beside).some((name) => name.endsWith('.exe'))) return beside;
  } catch { /* install folder has no binaries */ }
  return userBinFolder();
}

function getBinPath(name) {
  return path.join(getBinFolder(), name);
}

module.exports = { getBinPath, getBinFolder };
