const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const MANIFEST = {
  name: 'com.xjay5.zdm',
  description: 'Zetta Download Manager Native Messaging Host',
  path: path.join(__dirname, '..', 'core', 'native-host', 'server.js'),
  type: 'stdio',
  allowed_origins: ['chrome-extension://EXTENSION_ID_HERE/'],
};

const regKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.xjay5.zdm';
const manifestPath = path.join(__dirname, '..', 'core', 'native-host', 'manifest.json');

fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST, null, 2));

try {
  execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  console.log('Native messaging host registered successfully.');
} catch (err) {
  console.error('Failed to register native messaging host:', err.message);
}
