const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Stable ids for browsers the app already knows how to install.
// Discovery itself does not depend on this list.
const KNOWN = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    paths: [
      '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
      '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe',
    ],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    paths: [
      '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
      '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  {
    id: 'brave',
    name: 'Brave',
    paths: [
      '%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
  },
  {
    id: 'opera',
    name: 'Opera',
    paths: [
      '%LocalAppData%\\Programs\\Opera\\opera.exe',
      '%LocalAppData%\\Programs\\Opera GX\\opera.exe',
      '%ProgramFiles%\\Opera\\opera.exe',
    ],
  },
  {
    id: 'firefox',
    name: 'Firefox',
    paths: [
      '%ProgramFiles%\\Mozilla Firefox\\firefox.exe',
      '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe',
    ],
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    paths: [
      '%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe',
      '%ProgramFiles%\\Vivaldi\\Application\\vivaldi.exe',
    ],
  },
  {
    id: 'chromium',
    name: 'Chromium',
    paths: [
      '%LocalAppData%\\Chromium\\Application\\chrome.exe',
      '%ProgramFiles%\\Chromium\\Application\\chrome.exe',
    ],
  },
];

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/nmpfpkhkpfjdigbpckgeipbpdakdohbj';
const REGISTRY_ROOTS = [
  'HKLM\\SOFTWARE\\Clients\\StartMenuInternet',
  'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet',
  'HKCU\\SOFTWARE\\Clients\\StartMenuInternet',
];

const exeById = new Map();

function expand(raw) {
  return String(raw || '').replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
}

function fileExists(raw) {
  const full = expand(raw);
  if (!full || full.includes('%')) return false;
  try { return fs.existsSync(full); } catch { return false; }
}

function exeFromCommand(command) {
  const text = String(command || '').trim();
  const quoted = text.match(/"([^"]+\.exe)"/i);
  if (quoted) return quoted[1];
  const bare = text.match(/([A-Za-z]:\\.+?\.exe)\b/i);
  return bare ? bare[1] : '';
}

function hasFile(dir, name) {
  try { return fs.existsSync(path.join(dir, name)); } catch { return false; }
}

// Chromium and Firefox keep different files beside the program.
// The folder tells the engine, so a new fork does not need its own entry.
function familyOf(exe) {
  const dir = path.dirname(exe);
  const spots = [dir, path.dirname(dir)];
  try {
    for (const kid of fs.readdirSync(dir, { withFileTypes: true })) {
      if (kid.isDirectory() && /^\d+\./.test(kid.name)) spots.push(path.join(dir, kid.name));
    }
  } catch { /* the folder is not readable */ }
  const has = (name) => spots.some((spot) => hasFile(spot, name));
  if (has('xul.dll') || has('omni.ja')) return 'firefox';
  if (
    has('chrome.dll') || has('chrome_elf.dll') || has('msedge.dll') || has('libcef.dll')
    || has('opera.dll') || has('opera_elf.dll') || has('snapshot_blob.bin') || has('icudtl.dat')
  ) return 'chromium';
  return '';
}

function storeFor(family) {
  if (family === 'firefox') return { store: 'firefox', storeName: 'Firefox Add-ons', storeUrl: '' };
  if (family === 'chromium') return { store: 'chrome', storeName: 'Chrome Web Store', storeUrl: CHROME_STORE_URL };
  return { store: '', storeName: '', storeUrl: '' };
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function stableId(exe, displayName) {
  const lower = String(exe || '').toLowerCase();
  if (lower.includes('\\google\\chrome beta\\') || lower.includes('\\google\\chrome dev\\') || lower.includes('\\google\\chrome sxs\\')) {
    return slug(displayName) || 'chrome-variant';
  }
  if (lower.includes('\\google\\chrome\\')) return 'chrome';
  if (lower.endsWith('\\msedge.exe')) return 'edge';
  if (lower.includes('\\bravesoftware\\') || lower.endsWith('\\brave.exe')) return 'brave';
  if (lower.includes('\\opera')) return 'opera';
  if (lower.includes('\\vivaldi\\') || lower.endsWith('\\vivaldi.exe')) return 'vivaldi';
  if (lower.includes('\\chromium\\')) return 'chromium';
  if (lower.endsWith('\\firefox.exe') && lower.includes('\\mozilla firefox\\')) return 'firefox';
  return slug(displayName) || slug(path.basename(exe, '.exe')) || 'browser';
}

function clientKey(fullKey) {
  const parts = String(fullKey || '').split('\\');
  const at = parts.findIndex((part) => part.toLowerCase() === 'startmenuinternet');
  if (at < 0 || !parts[at + 1]) return '';
  return parts.slice(0, at + 2).join('\\').toLowerCase();
}

function registryBrowsers() {
  const found = [];
  if (process.platform !== 'win32') return found;
  for (const root of REGISTRY_ROOTS) {
    let text = '';
    try {
      text = execFileSync('reg', ['query', root, '/s'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      });
    } catch { continue; }
    const names = new Map();
    let key = '';
    for (const line of text.split(/\r?\n/)) {
      if (/^HKEY_/i.test(line)) {
        key = line.trim();
        continue;
      }
      const match = line.match(/^\s+(.*?)\s+REG_\w+\s+(.*)$/);
      if (!match || !key) continue;
      const valueName = match[1].trim();
      const data = match[2].trim();
      if (valueName !== '(Default)' || !data) continue;
      const client = clientKey(key);
      if (!client) continue;
      if (key.toLowerCase() === client) {
        names.set(client, data);
        continue;
      }
      if (/\\shell\\open\\command$/i.test(key)) {
        const exe = exeFromCommand(data);
        if (exe) found.push({ name: names.get(client) || '', exe });
      }
    }
  }
  return found;
}

function knownPathBrowsers() {
  const found = [];
  for (const browser of KNOWN) {
    for (const raw of browser.paths) {
      if (!fileExists(raw)) continue;
      found.push({ name: browser.name, exe: expand(raw), id: browser.id });
      break;
    }
  }
  return found;
}

function scanInstalledBrowsers(previous) {
  const prior = new Map();
  for (const row of Array.isArray(previous) ? previous : []) {
    if (row && row.id) prior.set(row.id, row.enabled !== false);
  }
  const seenExe = new Set();
  const usedIds = new Set();
  const found = [];
  const candidates = registryBrowsers().concat(knownPathBrowsers());
  for (const candidate of candidates) {
    const exe = path.normalize(candidate.exe);
    if (!fileExists(exe)) continue;
    const key = exe.toLowerCase();
    if (seenExe.has(key)) continue;
    const family = familyOf(exe);
    if (!family) continue;
    seenExe.add(key);
    let id = candidate.id || stableId(exe, candidate.name);
    if (usedIds.has(id)) {
      if (candidate.id) continue;
      id = `${id}-${usedIds.size + 1}`;
    }
    usedIds.add(id);
    exeById.set(id, exe);
    const store = storeFor(family);
    found.push({
      id,
      name: candidate.name || path.basename(exe, '.exe'),
      enabled: prior.has(id) ? prior.get(id) : true,
      family,
      exe,
      ...store,
    });
  }
  return found;
}

function getBrowserExe(id) {
  const cached = exeById.get(id);
  if (cached && fileExists(cached)) return cached;
  const browser = KNOWN.find((item) => item.id === id);
  if (!browser) return null;
  for (const raw of browser.paths) {
    const full = expand(raw);
    if (full && !full.includes('%') && fileExists(full)) return full;
  }
  return null;
}

module.exports = {
  scanInstalledBrowsers,
  getBrowserExe,
  familyOf,
  exeFromCommand,
  KNOWN,
};
