const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_ID = 'igcfcgmbljjmbnfpnjdfebilopgbofna'; // We should probably update this to a * or something. Wait, Chrome requires a valid 32-char ID. We will generate the extension ID or use the local unpacked ID.
// Wait, when the user loads the unpacked extension, Chrome assigns an ID based on the folder path.
// The user needs to supply the ID in manifest.json before running this.

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

console.log('Registering Native Messaging Host for Chrome and Edge...');
const regKeyChrome = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${manifest.name}`;
const regKeyEdge = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${manifest.name}`;

try {
  execSync(`REG ADD "${regKeyChrome}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  console.log('Successfully registered for Chrome.');
} catch (e) { console.error('Failed to register Chrome:', e.message); }

try {
  execSync(`REG ADD "${regKeyEdge}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  console.log('Successfully registered for Edge.');
} catch (e) { /* Edge might not be installed, ignore */ }
