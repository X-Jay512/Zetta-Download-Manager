const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const installDir = path.resolve(path.dirname(process.execPath));
const extDir = path.join(installDir, 'ext');
const extId = 'com.xjay5.zdm';

const browsers = [
  { name: 'Chrome', regBase: 'HKCU\\Software\\Google\\Chrome' },
  { name: 'Edge', regBase: 'HKCU\\Software\\Microsoft\\Edge' },
  { name: 'Brave', regBase: 'HKCU\\Software\\BraveSoftware\\Brave-Browser' },
];

function registerExtension() {
  for (const browser of browsers) {
    const extRegKey = `${browser.regBase}\\Extensions\\Preferences`;
    const policyKey = `HKLM\\SOFTWARE\\Policies\\${browser.name === 'Edge' ? 'Microsoft\\Edge' : browser.name === 'Brave' ? 'BraveSoftware\\Brave-Browser' : 'Google\\Chrome'}\\ExtensionInstallSources`;

    try {
      execSync(`reg add "${browser.regBase}\\NativeMessagingHosts\\${extId}" /ve /t REG_SZ /d "${path.join(installDir, 'native-host-manifest.json')}" /f`, { stdio: 'ignore' });
      console.log(`[OK] ${browser.name}: Native host registered`);
    } catch {}
  }

  const manifest = {
    name: extId,
    description: 'Zetta Download Manager Native Messaging Host',
    path: process.execPath,
    type: 'stdio',
    allowed_origins: [],
  };
  fs.writeFileSync(path.join(installDir, 'native-host-manifest.json'), JSON.stringify(manifest, null, 2));
}

function unregisterExtension() {
  for (const browser of browsers) {
    try {
      execSync(`reg delete "${browser.regBase}\\NativeMessagingHosts\\${extId}" /f`, { stdio: 'ignore' });
    } catch {}
  }
}

if (process.argv.includes('--uninstall')) {
  unregisterExtension();
} else {
  registerExtension();
  console.log('\n=== Extension Installation ===');
  console.log('The browser extension must be installed manually:');
  console.log('1. Open chrome://extensions (or edge://extensions)');
  console.log('2. Enable "Developer mode"');
  console.log(`3. Click "Load unpacked" and select: ${extDir}`);
}
