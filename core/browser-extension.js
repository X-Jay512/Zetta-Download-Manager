const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareExtensionDist, FIREFOX_ID, HOST } = require('./crx-pack');
const { debugLog } = require('./engine/logger');

function extLog(stage, detail) {
  debugLog('EXT_INSTALL', stage, detail || '');
}

function errDetail(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : '';
  return { error: err && err.message ? err.message : String(err), stderr: stderr.slice(0, 500) };
}

const VALUE = 'ZDM';

const BROWSERS = {
  chrome: {
    image: 'chrome.exe',
    forcelist: 'HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallSources',
    native: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%LOCALAPPDATA%\\Google\\Chrome\\User Data'],
  },
  edge: {
    image: 'msedge.exe',
    forcelist: 'HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallSources',
    native: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%LOCALAPPDATA%\\Microsoft\\Edge\\User Data'],
  },
  brave: {
    image: 'brave.exe',
    forcelist: 'HKCU\\Software\\Policies\\BraveSoftware\\Brave\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\BraveSoftware\\Brave\\ExtensionInstallSources',
    native: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data'],
  },
  opera: {
    image: 'opera.exe',
    forcelist: 'HKCU\\Software\\Policies\\Opera\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\Opera\\ExtensionInstallSources',
    native: 'HKCU\\Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: [
      '%APPDATA%\\Opera Software\\Opera Stable',
      '%APPDATA%\\Opera Software\\Opera GX Stable',
    ],
  },
  vivaldi: {
    image: 'vivaldi.exe',
    forcelist: 'HKCU\\Software\\Policies\\Vivaldi\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\Vivaldi\\ExtensionInstallSources',
    native: 'HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%LOCALAPPDATA%\\Vivaldi\\User Data'],
  },
  chromium: {
    image: 'chrome.exe',
    forcelist: 'HKCU\\Software\\Policies\\Chromium\\ExtensionInstallForcelist',
    sources: 'HKCU\\Software\\Policies\\Chromium\\ExtensionInstallSources',
    native: 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%LOCALAPPDATA%\\Chromium\\User Data'],
  },
  firefox: {
    image: 'firefox.exe',
    native: 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.xjay5.zdm',
    roots: ['%APPDATA%\\Mozilla\\Firefox\\Profiles'],
    firefox: true,
  },
};

function expand(raw) {
  return String(raw || '').replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
}

function regAdd(key, name, data) {
  const args = name
    ? ['add', key, '/v', name, '/t', 'REG_SZ', '/d', data, '/f']
    : ['add', key, '/ve', '/t', 'REG_SZ', '/d', data, '/f'];
  execFileSync('reg', args, { windowsHide: true });
}

function psQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function deniedError(err) {
  return /access is denied|cannot write to the registry key|unauthorized/i.test(`${err && err.message} ${err && err.stderr ? err.stderr : ''}`);
}

function currentUserSid() {
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ], { encoding: 'utf8', windowsHide: true });
  const sid = String(out || '').trim();
  if (!/^S-\d-\d+(-\d+)+$/.test(sid)) throw new Error('Could not read the Windows user id');
  return sid;
}

function regHasValue(key, name) {
  try {
    execFileSync('reg', ['query', key, '/v', name], { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runElevatedScript(scriptBody) {
  const scriptPath = path.join(os.tmpdir(), 'zdm-policy-elevated.ps1');
  fs.writeFileSync(scriptPath, scriptBody, 'utf8');
  const command = [
    'Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList @(',
    "'-NoProfile','-ExecutionPolicy','Bypass','-File',",
    `'${psQuote(scriptPath)}'`,
    ')',
  ].join(' ');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* temp script */ }
  }
}

function writePoliciesElevated(entries) {
  const sid = currentUserSid();
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$sid = '${psQuote(sid)}'`,
    '$users = [Microsoft.Win32.Registry]::Users',
  ];
  entries.forEach((entry, index) => {
    const rel = psQuote(String(entry.key || '').replace(/^HKCU\\/i, ''));
    lines.push(`$rel${index} = '${rel}'`);
    lines.push(`$name${index} = '${psQuote(entry.name)}'`);
    lines.push(`$data${index} = '${psQuote(entry.data)}'`);
    lines.push(`$leaf${index} = $users.CreateSubKey("$sid\\$rel${index}", $true)`);
    lines.push(`if (-not $leaf${index}) { throw "Cannot create $rel${index}" }`);
    lines.push(`$leaf${index}.SetValue($name${index}, $data${index}, 'String')`);
  });
  extLog('policy-elevate', { sid, count: entries.length, note: 'Windows will ask for administrator approval.' });
  runElevatedScript(lines.join('\r\n'));
}

function ensurePolicies(entries) {
  const pending = [];
  for (const entry of entries) {
    if (regHasValue(entry.key, entry.name)) {
      extLog('policy-already', { key: entry.key, name: entry.name });
      continue;
    }
    try {
      regAdd(entry.key, entry.name, entry.data);
    } catch (err) {
      if (!deniedError(err)) throw err;
      pending.push(entry);
    }
  }
  if (!pending.length) return;
  extLog('policy-acl', { count: pending.length, note: 'reg.exe was denied. Asking Windows for administrator approval.' });
  writePoliciesElevated(pending);
  const missing = pending.filter((entry) => !regHasValue(entry.key, entry.name));
  if (missing.length) {
    throw new Error('Windows did not grant administrator approval, so the extension was not installed.');
  }
}

function regDel(key, name) {
  try {
    const args = name ? ['delete', key, '/v', name, '/f'] : ['delete', key, '/f'];
    execFileSync('reg', args, { windowsHide: true });
  } catch { /* already gone */ }
}

function processRunning(image) {
  if (!image) return false;
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return out.toLowerCase().includes(image.toLowerCase());
  } catch {
    return false;
  }
}

function profileDirs(root) {
  const full = expand(root);
  if (!full || !fs.existsSync(full)) return [];
  const found = [];
  const direct = path.join(full, 'Extensions');
  if (fs.existsSync(direct)) found.push(full);
  let entries = [];
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name !== 'Default' && !/^Profile /i.test(entry.name)) continue;
    found.push(path.join(full, entry.name));
  }
  return found;
}

function chromiumInstalled(browser, extensionId) {
  for (const root of browser.roots) {
    for (const profile of profileDirs(root)) {
      const dir = path.join(profile, 'Extensions', extensionId);
      if (!fs.existsSync(dir)) continue;
      try {
        if (fs.readdirSync(dir).length) return true;
      } catch { /* locked or empty */ }
    }
  }
  return false;
}

const KNOWN_EXTENSION_IDS = ['nmpfpkhkpfjdigbpckgeipbpdakdohbj'];
const prefCache = new Map();

function unpackedExtensionId(folder) {
  const abs = path.resolve(folder);
  const hash = crypto.createHash('sha256').update(Buffer.from(abs, 'utf16le')).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + ((hash[i] >> 4) & 15));
    id += String.fromCharCode(97 + (hash[i] & 15));
  }
  return id;
}

function extensionIdsFor(extDir) {
  const ids = KNOWN_EXTENSION_IDS.slice();
  const dirs = [extDir, 'D:\\F\\Download manger\\ext'];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    try { ids.push(unpackedExtensionId(dir)); } catch { /* path hash is optional */ }
  }
  return [...new Set(ids.filter(Boolean))];
}

function sameExtensionPath(stored, extDir) {
  if (!stored || !extDir) return false;
  const left = path.resolve(String(stored).replace(/\//g, '\\')).replace(/[\\/]+$/, '').toLowerCase();
  const right = path.resolve(String(extDir).replace(/\//g, '\\')).replace(/[\\/]+$/, '').toLowerCase();
  return left === right;
}

function reasonsBlock(reasons) {
  if (Array.isArray(reasons)) return reasons.some((value) => Number(value) !== 0);
  if (typeof reasons === 'number') return reasons !== 0;
  return false;
}

function extensionRecordPresent(ext) {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return false;
  // Chromium leaves "id": {} in Secure Preferences after a wipe or a failed load.
  // A real install always has a manifest, a path, a location, or a state.
  if (ext.manifest && typeof ext.manifest === 'object') return true;
  if (typeof ext.path === 'string' && ext.path.trim()) return true;
  if (typeof ext.location === 'number') return true;
  if (typeof ext.state === 'number') return true;
  return false;
}

function extensionRecordEnabled(ext) {
  if (!extensionRecordPresent(ext)) return false;
  if (ext.state === 0) return false;
  if (reasonsBlock(ext.disable_reasons)) return false;
  if (ext.path && !fs.existsSync(ext.path)) return false;
  return true;
}

function readJsonFile(file) {
  const read = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));
  try {
    return read(file);
  } catch {
    try {
      const tmp = path.join(os.tmpdir(), `zdm-pref-${crypto.createHash('sha1').update(file).digest('hex').slice(0, 10)}.json`);
      fs.copyFileSync(file, tmp);
      return read(tmp);
    } catch {
      return null;
    }
  }
}

function readPrefs(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const hit = prefCache.get(file);
  if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.data;
  const data = readJsonFile(file);
  if (data) prefCache.set(file, { mtime: stat.mtimeMs, size: stat.size, data });
  return data;
}

function recordFromSettings(settings, ids, extDir) {
  if (!settings || typeof settings !== 'object') return null;
  const wanted = new Set((ids || []).filter(Boolean));
  for (const [id, ext] of Object.entries(settings)) {
    if (!extensionRecordPresent(ext)) continue;
    const extPath = ext.path ? String(ext.path) : '';
    if (!wanted.has(id) && !sameExtensionPath(extPath, extDir)) continue;
    return {
      id,
      path: extPath,
      location: ext.location,
      state: ext.state,
      disable_reasons: ext.disable_reasons,
      enabled: extensionRecordEnabled(ext),
    };
  }
  return null;
}

function profileRecord(profile, ids, extDir) {
  if (!profile) return null;
  let disabled = null;
  for (const name of ['Secure Preferences', 'Preferences']) {
    const file = path.join(profile, name);
    if (!fs.existsSync(file)) continue;
    const data = readPrefs(file);
    const settings = data && data.extensions && data.extensions.settings;
    const row = recordFromSettings(settings, ids, extDir);
    if (!row) continue;
    row.profile = profile;
    row.file = name;
    if (row.enabled) return row;
    if (!disabled) disabled = row;
  }
  return disabled;
}

function findInBrowser(browser, ids, extDir) {
  if (!browser || !browser.roots) return null;
  let disabled = null;
  for (const root of browser.roots) {
    for (const profile of profileDirs(root)) {
      const row = profileRecord(profile, ids, extDir);
      if (!row) continue;
      if (row.enabled) return row;
      if (!disabled) disabled = row;
    }
  }
  return disabled;
}

function profileExtensionEnabled(profile, extensionId) {
  const row = profileRecord(profile, extensionId ? [extensionId] : [], '');
  return !!(row && row.enabled);
}

function profileHasExtension(browser, extensionId) {
  if (!browser || !browser.roots) return false;
  for (const root of browser.roots) {
    for (const profile of profileDirs(root)) {
      if (profileExtensionEnabled(profile, extensionId)) return true;
    }
  }
  return false;
}


function stageUnpacked(extDir, userData) {
  const dest = path.join(userData, 'extension-unpacked');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(extDir, dest, { recursive: true });
  const pemPath = path.join(userData, 'extension-key.pem');
  if (fs.existsSync(pemPath)) {
    const spki = crypto.createPublicKey(fs.readFileSync(pemPath, 'utf8')).export({ type: 'spki', format: 'der' });
    const manifestPath = path.join(dest, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.key = spki.toString('base64');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return dest;
}

function loadArgs(unpacked) {
  return [
    '--disable-features=DisableLoadExtensionCommandLineSwitch,msEdgeStartupBoost,EdgeStartupBoost',
    `--load-extension=${unpacked}`,
  ];
}

function firefoxProfiles() {
  const root = expand('%APPDATA%\\Mozilla\\Firefox\\Profiles');
  if (!root || !fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function firefoxInstalled() {
  for (const profile of firefoxProfiles()) {
    const file = path.join(profile, 'extensions.json');
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const addons = Array.isArray(data.addons) ? data.addons : [];
      if (addons.some((addon) => addon && addon.id === FIREFOX_ID && addon.active !== false && !addon.userDisabled)) return true;
    } catch { /* unreadable profile */ }
  }
  return false;
}

function policyPresent(browser) {
  if (!browser || !browser.forcelist) return false;
  try {
    execFileSync('reg', ['query', browser.forcelist, '/v', VALUE], { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function firefoxPolicyPresent() {
  try {
    execFileSync('reg', ['query', 'HKCU\\Software\\Policies\\Mozilla\\Firefox', '/v', 'ExtensionSettings'], { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function extensionInstalled(browserId, extensionId) {
  const browser = BROWSERS[browserId];
  if (!browser) return false;
  if (browser.firefox) return firefoxPolicyPresent() && firefoxInstalled();
  if (profileHasExtension(browser, extensionId)) return true;
  return !!(extensionId && chromiumInstalled(browser, extensionId));
}

function extensionKept(browserId) {
  const browser = BROWSERS[browserId];
  if (!browser) return false;
  if (browser.firefox) return firefoxPolicyPresent();
  return profileHasExtension(browser, '') || policyPresent(browser);
}

function textHasName(file) {
  try {
    if (!file || !fs.existsSync(file)) return false;
    return fs.readFileSync(file, 'utf8').includes('Zetta Download Manager');
  } catch {
    return false;
  }
}

function describeBrowser(browserId, extensionId) {
  const browser = BROWSERS[browserId];
  if (!browser) return { browser: browserId, known: false };
  if (browser.firefox) {
    const profiles = firefoxProfiles();
    return {
      browser: browserId,
      policy: firefoxPolicyPresent(),
      active: firefoxInstalled(),
      profiles: profiles.map((profile) => ({
        profile,
        xpi: fs.existsSync(path.join(profile, 'extensions', `${FIREFOX_ID}.xpi`)),
      })),
    };
  }
  const profiles = [];
  for (const root of browser.roots) {
    const full = expand(root);
    for (const profile of profileDirs(root)) {
      const dir = extensionId ? path.join(profile, 'Extensions', extensionId) : '';
      profiles.push({
        root: full,
        profile,
        ourFolder: !!(dir && fs.existsSync(dir)),
        inProfile: profileExtensionEnabled(profile, extensionId),
        nameInPreferences: textHasName(path.join(profile, 'Preferences')) || textHasName(path.join(profile, 'Secure Preferences')),
      });
    }
    if (!profileDirs(root).length) profiles.push({ root: full, exists: !!(full && fs.existsSync(full)), profiles: 0 });
  }
  return {
    browser: browserId,
    policy: policyPresent(browser),
    installed: extensionId ? extensionInstalled(browserId, extensionId) : false,
    profiles,
  };
}

function writeNativeManifest(userData, extensionId) {
  const hostDir = path.join(__dirname, 'native-host');
  const hostBat = path.join(hostDir, 'host.bat');
  const dest = path.join(userData, 'native-manifest.json');
  const body = {
    name: 'com.xjay5.zdm',
    description: 'Zetta Download Manager Native Messaging Host',
    path: hostBat,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(dest, JSON.stringify(body, null, 2));
  return dest;
}

function registerNative(browser, manifestPath) {
  if (!browser.native || !manifestPath) return;
  try { regAdd(browser.native, '', manifestPath); } catch { /* optional */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(fn, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await sleep(500);
  }
  return !!fn();
}



function installFirefox(dist) {
  const xpi = path.join(dist.dir, 'zdm.xpi');
  for (const profile of firefoxProfiles()) {
    const destDir = path.join(profile, 'extensions');
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(xpi, path.join(destDir, `${FIREFOX_ID}.xpi`));
    } catch { /* profile in use */ }
  }
  const policy = JSON.stringify({
    [FIREFOX_ID]: {
      installation_mode: 'force_installed',
      install_url: `${HOST}/extension/zdm.xpi`,
    },
  });
  ensurePolicies([{ key: 'HKCU\\Software\\Policies\\Mozilla\\Firefox', name: 'ExtensionSettings', data: policy }]);
}



function extensionStatus(browserId, extDir) {
  const browser = BROWSERS[String(browserId || '').toLowerCase()];
  if (!browser) return { enabled: false };
  if (browser.firefox) {
    const enabled = firefoxPolicyPresent() && firefoxInstalled();
    return { id: FIREFOX_ID, enabled };
  }
  const resolved = extDir && fs.existsSync(path.join(extDir, 'manifest.json')) ? path.resolve(extDir) : '';
  const ids = extensionIdsFor(resolved || extDir || '');
  const row = findInBrowser(browser, ids, resolved);
  if (!row) return { enabled: false, extensionId: ids[0] || '' };
  return row;
}

function lastUsedProfile(browser) {
  for (const root of (browser && browser.roots) || []) {
    const data = readPrefs(path.join(expand(root), 'Local State'));
    const name = data && data.profile && data.profile.last_used;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return 'Default';
}

async function closeBrowserImage(image) {
  if (!processRunning(image)) return;
  try { execFileSync('taskkill', ['/IM', image], { windowsHide: true, stdio: 'pipe' }); } catch { /* already closing */ }
  let gone = await waitUntil(() => !processRunning(image), 5000);
  if (!gone) {
    try { execFileSync('taskkill', ['/F', '/IM', image], { windowsHide: true, stdio: 'pipe' }); } catch { /* already gone */ }
    await waitUntil(() => !processRunning(image), 3000);
  }
  await sleep(800);
}

async function installLoadUnpacked(id, browser, opts) {
  const extDir = opts && opts.extDir;
  if (!extDir || !fs.existsSync(path.join(extDir, 'manifest.json'))) {
    return { ok: false, error: 'Extension folder was not found.', stage: 'ext-dir' };
  }
  const resolved = path.resolve(extDir);
  const unpackedId = unpackedExtensionId(resolved);
  const ids = extensionIdsFor(resolved);
  const present = findInBrowser(browser, ids, resolved);
  extLog('profile-check', present || { installed: false, unpackedId });
  if (present && present.enabled) {
    return {
      ok: true,
      connected: true,
      installed: true,
      needsRestart: false,
      extensionId: present.id,
      stage: 'already',
      detail: present,
    };
  }
  if (!opts.exe || !fs.existsSync(opts.exe)) {
    return { ok: false, error: 'The browser program was not found on this computer.', stage: 'launch', extensionId: unpackedId };
  }
  try {
    const manifestPath = writeNativeManifest(opts.userData, unpackedId);
    registerNative(browser, manifestPath);
    extLog('native-host', { manifestPath, extensionId: unpackedId });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'native-host' }, errDetail(err)));
  }
  const running = processRunning(browser.image);
  if (running) {
    extLog('close', { image: browser.image });
    await closeBrowserImage(browser.image);
  }
  const profileName = lastUsedProfile(browser);
  const page = id === 'edge' ? 'edge://extensions' : id === 'opera' ? 'opera://extensions' : id === 'vivaldi' ? 'vivaldi://extensions' : id === 'brave' ? 'brave://extensions' : 'chrome://extensions';
  const launchArgs = [
    `--profile-directory=${profileName}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch,msEdgeStartupBoost,EdgeStartupBoost',
    `--load-extension=${resolved}`,
    page,
  ];
  try {
    spawn(opts.exe, launchArgs, { detached: true, stdio: 'ignore' }).unref();
    extLog('launch', { exe: opts.exe, args: launchArgs, closedFirst: running });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'launch' }, errDetail(err)));
    return { ok: false, error: err.message, stage: 'launch', extensionId: unpackedId };
  }
  let record = null;
  const seen = await waitUntil(() => {
    record = findInBrowser(browser, ids, resolved);
    return !!(record && record.enabled);
  }, 12000);
  extLog('wait-done', { seen, record, unpackedId });
  if (seen) {
    return {
      ok: true,
      connected: true,
      installed: true,
      needsRestart: false,
      extensionId: record.id,
      stage: 'success',
      detail: record,
    };
  }
  return {
    ok: true,
    connected: false,
    installed: !!record,
    needsRestart: false,
    extensionId: record ? record.id : unpackedId,
    stage: record ? 'disabled' : 'not-in-profile',
    detail: record,
    error: record ? 'The extension is in the browser but turned off.' : '',
  };
}

async function installExtension(browserId, opts) {
  const id = String(browserId || '').toLowerCase();
  extLog('click', { browser: id, exe: opts && opts.exe, extDir: opts && opts.extDir });
  const browser = BROWSERS[id];
  if (!browser) {
    extLog('fail', { stage: 'known-browser', error: 'Unknown browser' });
    return { ok: false, error: 'Unknown browser', stage: 'known-browser' };
  }
  if (!browser.firefox && id !== 'chrome') return installLoadUnpacked(id, browser, opts || {});
  const exeExists = !!(opts.exe && fs.existsSync(opts.exe));
  extLog('browser', { image: browser.image, exe: opts.exe || '', exeExists });

  let dist;
  try {
    dist = prepareExtensionDist(opts.extDir, opts.userData);
    extLog('packed', { extensionId: dist.id, version: dist.version, dir: dist.dir });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'pack' }, errDetail(err)));
    return { ok: false, error: err.message, stage: 'pack' };
  }
  try {
    if (opts.setDist) opts.setDist(dist.dir);
    extLog('server-path', { dir: dist.dir });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'server-path' }, errDetail(err)));
  }
  try {
    const manifestPath = writeNativeManifest(opts.userData, dist.id);
    registerNative(browser, manifestPath);
    extLog('native-host', { manifestPath });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'native-host' }, errDetail(err)));
  }
  const running = processRunning(browser.image);
  extLog('process', { image: browser.image, running });
  let unpacked = '';
  try {
    if (browser.firefox) {
      installFirefox(dist);
      extLog('policy-written', { firefox: true, policy: firefoxPolicyPresent() });
    } else {
      unpacked = stageUnpacked(opts.extDir, opts.userData);
      extLog('unpacked', { dir: unpacked, extensionId: dist.id });
    }
  } catch (err) {
    extLog('fail', Object.assign({ stage: browser.firefox ? 'policy' : 'unpacked' }, errDetail(err)));
    return { ok: false, error: err.message, stage: browser.firefox ? 'policy' : 'unpacked', extensionId: dist.id };
  }
  const launchArgs = unpacked ? loadArgs(unpacked) : [];
  if (!exeExists) {
    extLog('fail', { stage: 'launch', error: 'browser executable was not found', exe: opts.exe || '' });
    return { ok: false, error: 'The browser program was not found on this computer.', stage: 'launch', extensionId: dist.id };
  }
  try {
    spawn(opts.exe, launchArgs, { detached: true, stdio: 'ignore' }).unref();
    extLog('launch', { exe: opts.exe, args: launchArgs, running });
  } catch (err) {
    extLog('fail', Object.assign({ stage: 'launch' }, errDetail(err)));
    return { ok: false, error: err.message, stage: 'launch', extensionId: dist.id };
  }
  const check = typeof opts.isConnected === 'function' ? opts.isConnected : () => extensionInstalled(id, dist.id);
  let connected = await waitUntil(check, 20000);
  const detail = describeBrowser(id, dist.id);
  const inProfile = !!(detail && (detail.installed || detail.active));
  if (!connected && inProfile && running && !browser.firefox && opts.exe) {
    try {
      spawn(opts.exe, [`chrome-extension://${dist.id}/options.html`], { detached: true, stdio: 'ignore' }).unref();
      extLog('wake', { extensionId: dist.id });
    } catch (err) {
      extLog('fail', Object.assign({ stage: 'wake' }, errDetail(err)));
    }
    connected = await waitUntil(check, 8000);
  }
  extLog('wait-done', { connected, detail });
  const installed = connected || inProfile;
  const needsRestart = !connected && installed && running;
  const result = {
    ok: true,
    connected,
    installed,
    needsRestart,
    extensionId: dist.id,
    stage: connected ? 'success' : (installed ? 'needs-reload' : 'not-in-profile'),
  };
  extLog(connected ? 'success' : 'not-yet', result);
  return result;
}

async function removeExtension(browserId, opts) {
  const id = String(browserId || '').toLowerCase();
  const browser = BROWSERS[id];
  if (!browser) return { ok: false };
  extLog('remove', { browser: id });
  try { regDel(browser.native, ''); } catch { /* optional */ }
  const exe = opts && opts.exe;
  if (exe && fs.existsSync(exe)) {
    const extPage = browser.firefox ? 'about:addons' : `${id === 'edge' ? 'edge' : id === 'brave' ? 'brave' : id === 'opera' ? 'opera' : id === 'vivaldi' ? 'vivaldi' : 'chrome'}://extensions`;
    try {
      spawn(exe, [extPage], { detached: true, stdio: 'ignore' }).unref();
      extLog('remove-open-page', { exe, page: extPage });
    } catch (err) {
      extLog('fail', Object.assign({ stage: 'remove-open-page' }, errDetail(err)));
    }
  }
  return { ok: true, connected: false, needsRestart: false };
}

module.exports = {
  BROWSERS,
  extensionInstalled,
  extensionKept,
  extensionStatus,
  unpackedExtensionId,
  describeBrowser,
  installExtension,
  removeExtension,
  prepareExtensionDist,
};
