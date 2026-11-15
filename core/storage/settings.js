const path = require('path');
const fs = require('fs');
const os = require('os');

const QUALITY_MODES = ['full', 'average', 'simple'];

function normalizeQuality(video) {
  const mode = video && QUALITY_MODES.includes(video.qualityMode) ? video.qualityMode : 'full';
  const fps = video && (video.fpsDisplay === '30' || video.fpsDisplay === 'off') ? video.fpsDisplay : '60';
  const stamp = Number(video && video.qualityStamp) || 0;
  return { qualityMode: mode, fpsDisplay: fps, qualityStamp: stamp };
}

function sanitizeQualityPatch(video) {
  const next = {};
  if (!video || typeof video !== 'object') return next;
  if (video.qualityMode != null) next.qualityMode = QUALITY_MODES.includes(video.qualityMode) ? video.qualityMode : 'full';
  if (video.fpsDisplay != null) {
    next.fpsDisplay = (video.fpsDisplay === '30' || video.fpsDisplay === '60' || video.fpsDisplay === 'off')
      ? video.fpsDisplay
      : '60';
  }
  if (video.qualityStamp != null) next.qualityStamp = Number(video.qualityStamp) || 0;
  return next;
}

const DEFAULT_EXTENSIONS = [
  '3gp', '7z', 'aac', 'ace', 'aif', 'apk', 'arj', 'asf', 'avi', 'bin', 'bz2',
  'exe', 'flv', 'gz', 'gzip', 'img', 'iso', 'lzh', 'm4a', 'm4v', 'mkv', 'mov',
  'mp3', 'mp4', 'mpa', 'mpe', 'mpeg', 'mpg', 'msi', 'msu', 'ogg', 'ogv', 'pdf',
  'ppt', 'pptx', 'plj', 'pps', 'qt', 'ra', 'rar', 'rm', 'rmvb', 'sea', 'sit',
  'sitx', 'tar', 'tif', 'tiff', 'wav', 'webm', 'wma', 'wmv', 'z', 'zip', 'xz',
  'dmg', 'deb', 'rpm', 'doc', 'docx', 'xls', 'xlsx',
];

class SettingsManager {
  constructor() {
    this.settingsPath = path.join(require('electron').app.getPath('userData'), 'settings.json');
    this.settings = this._defaults();
    this._load();
  }

  _downloadsDir() {
    return path.join(os.homedir(), 'Downloads');
  }

  _defaults() {
    const downloads = this._downloadsDir();
    const userData = require('electron').app.getPath('userData');
    return {
      appearance: {
        theme: 'theme1',
        columnLines: false,
        iconSaturation: 100,
        themeRevision: 2,
      },
      launch: {
        startWithWindows: false,
        startMinimized: false,
        showNotifications: true,
        watchClipboard: false,
        keepAwake: true,
      },
      catch: {
        interceptDownloads: true,
        sniffVideos: true,
        skipKeysEnabled: true,
        skipKeys: { alt: false, shift: false, ctrl: false, del: true },
        forceKeysEnabled: false,
        forceKeys: { alt: false, shift: false, ctrl: false, ins: false },
        contextDownload: true,
        contextDownloadAll: false,
        hudEnabled: true,
        hudMode: 'full',
        hudMinSizeKB: 50,
        autoCatchFromPlayers: true,
        silentDownload: false,
        addSilently: false,
        startCaptured: false,
        minCaptureKB: 0,
        detected: [],
        advancedIntegration: true,
        forceNeedsClick: false,
        sparePagesWhileKey: true,
        browsers: {
          chrome: true,
          brave: true,
          edge: true,
          firefox: true,
          opera: true,
          safari: true,
        },
      },
      types: {
        extensions: DEFAULT_EXTENSIONS.slice(),
        skipSites: [
          '*.update.microsoft.com',
          'download.windowsupdate.com',
          '*.download.windowsupdate.com',
          'siteseal.thawte.com',
          'ecom.cimet2.com',
          '*.voice2page.com',
        ],
        skipAddresses: [],
      },
      library: {
        defaultPath: downloads,
        rememberLastFolder: true,
        lastFolder: '',
        useServerFileTime: false,
        removeMissing: false,
        tempPath: path.join(userData, 'staging'),
        folders: {
          general: downloads,
          compressed: path.join(downloads, 'Compressed'),
          documents: path.join(downloads, 'Documents'),
          music: path.join(downloads, 'Sounds'),
          programs: path.join(downloads, 'Programs'),
          video: path.join(downloads, 'Video'),
          images: path.join(downloads, 'Images'),
        },
      },
      behavior: {
        confirmBeforeStart: true,
        showCompleteDialog: true,
        startWhileDialog: true,
        queueOnLater: true,
        confirmDelete: true,
        cancelAsk: true,
        cancelAction: 'keep',
        ignoreMtime: false,
        ignoreSsl: false,
        retryFailed: false,
        retryCount: 3,
        duplicateAction: 'ask',
        hlsPull: 'native',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      },
      video: {
        qualityMode: 'full',
        fpsDisplay: '60',
        qualityStamp: 0,
      },
      speed: {
        connectionsPerFile: 8,
        maxConcurrent: 0,
        throttleEnabled: false,
        throttleValue: 1,
        throttleUnit: 'MB',
        limitEnabled: false,
        limitMB: 200,
        limitHours: 5,
        warnBeforeStop: true,
        exceptions: [],
      },
      schedule: {
        enabled: false,
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '00:00',
        end: '23:59',
      },
      proxy: {
        enabled: false,
        mode: 'off',
        type: 'http',
        host: '',
        port: 0,
        username: '',
        password: '',
      },
      recentAddresses: [],
      list: {
        sortCol: null,
        sortAsc: true,
      },
      categories: {
        compressed: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
        documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'],
        music: ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma'],
        video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
        programs: ['.exe', '.msi', '.dmg', '.deb', '.rpm', '.appimage'],
        images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'],
        patterns: {
          compressed: [],
          documents: [],
          music: [],
          programs: [],
          video: [],
          images: [],
        },
      },
    };
  }

  _load() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        this.settings = this._deepMerge(this._defaults(), saved);
        const migrated = this._migrate(saved);
        const folders = this._migrateKindFolders(saved);
        const themes = this._migrateThemeOrder(saved);
        if (migrated || folders || themes) this._save();
      }
    } catch { /* use defaults */ }
  }

  _migrate(saved) {
    let changed = false;
    const g = saved.general;
    if (g) {
      if (g.launchOnStartup != null) this.settings.launch.startWithWindows = g.launchOnStartup;
      if (g.startMinimized != null) this.settings.launch.startMinimized = g.startMinimized;
      if (g.showNotifications != null) this.settings.launch.showNotifications = g.showNotifications;
      if (g.clipboardMonitor != null) this.settings.launch.watchClipboard = g.clipboardMonitor;
      if (g.defaultSavePath) this.settings.library.defaultPath = g.defaultSavePath;
      if (g.maxConcurrentDownloads) this.settings.speed.maxConcurrent = g.maxConcurrentDownloads;
      if (g.segmentsPerFile) this.settings.speed.connectionsPerFile = g.segmentsPerFile;
    }
    if (!this.settings.catch.silentDefaultFixed) {
      this.settings.catch.addSilently = false;
      this.settings.catch.advancedIntegration = true;
      this.settings.catch.silentDefaultFixed = true;
      changed = true;
    }
    if (saved.proxy && saved.proxy.enabled && !saved.proxy.mode) {
      this.settings.proxy.mode = 'manual';
      changed = true;
    }
    if (saved.speed && saved.speed.limitKBps && !saved.speed.throttleEnabled) {
      this.settings.speed.throttleEnabled = true;
      if (saved.speed.limitKBps >= 1024) {
        this.settings.speed.throttleValue = saved.speed.limitKBps / 1024;
        this.settings.speed.throttleUnit = 'MB';
      } else {
        this.settings.speed.throttleValue = saved.speed.limitKBps;
        this.settings.speed.throttleUnit = 'KB';
      }
    }
    const sites = saved.types && saved.types.skipSites;
    const legacySites = [
      '*.update.microsoft.com',
      'download.windowsupdate.com',
      '*.download.windowsupdate.com',
    ];
    if (Array.isArray(sites) && sites.length === legacySites.length && legacySites.every((site, i) => sites[i] === site)) {
      this.settings.types.skipSites = this._defaults().types.skipSites.slice();
      changed = true;
    }
    return changed;
  }

  _migrateThemeOrder(saved) {
    const appearance = saved.appearance || {};
    if (appearance.themeRevision === 2) return false;
    const map = { theme1: 'theme3', theme2: 'theme1', theme3: 'theme2' };
    if (appearance.theme && map[appearance.theme]) {
      this.settings.appearance.theme = map[appearance.theme];
    }
    this.settings.appearance.themeRevision = 2;
    return true;
  }

  _migrateKindFolders(saved) {
    const downloads = path.normalize(this._downloadsDir());
    const folders = this.settings.library.folders;
    const kinds = {
      compressed: 'Compressed',
      documents: 'Documents',
      music: 'Sounds',
      programs: 'Programs',
      video: 'Video',
      images: 'Images',
    };
    const oldSaved = (saved.library && saved.library.folders) || {};
    let changed = false;
    for (const [key, name] of Object.entries(kinds)) {
      const current = oldSaved[key] ? path.normalize(oldSaved[key]).toLowerCase() : '';
      if (!current || current === downloads.toLowerCase() || /[\\/]archives$/i.test(current)) {
        folders[key] = path.join(this._downloadsDir(), name);
        changed = true;
      }
    }
    return changed;
  }

  _save() {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
  }

  _deepMerge(target, source) {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }

  getAll() { return this.settings; }
  get(key) { return key.split('.').reduce((o, k) => o?.[k], this.settings); }

  update(updates) {
    this.settings = this._deepMerge(this.settings, updates);
    this._save();
    return this.settings;
  }

  reset() {
    this.settings = this._defaults();
    this._save();
    return this.settings;
  }

  restorePart(part) {
    const fresh = this._defaults();
    const paneMap = {
      launch: ['launch'],
      catch: ['catch'],
      library: ['library'],
      behavior: ['behavior'],
      speed: ['speed'],
      proxy: ['proxy'],
      look: ['appearance'],
    };
    if (part === 'look') {
      const currentTheme = (this.settings.appearance && this.settings.appearance.theme) || 'theme1';
      this.settings.appearance = JSON.parse(JSON.stringify(fresh.appearance));
      this.settings.appearance.theme = currentTheme;
    } else if (paneMap[part]) {
      for (const key of paneMap[part]) this.settings[key] = JSON.parse(JSON.stringify(fresh[key]));
    } else if (part === 'extensions') {
      this.settings.types.extensions = fresh.types.extensions.slice();
    } else if (part === 'skipSites') {
      this.settings.types.skipSites = fresh.types.skipSites.slice();
    } else {
      return this.settings;
    }
    this._save();
    return this.settings;
  }

  extensionSlice() {
    return {
      catch: this.settings.catch,
      types: this.settings.types,
      categories: { patterns: this.settings.categories.patterns },
      behavior: {
        hlsPull: 'native',
        userAgent: (this.settings.behavior && this.settings.behavior.userAgent) || '',
      },
      quality: normalizeQuality(this.settings.video),
    };
  }
}

module.exports = { SettingsManager, DEFAULT_EXTENSIONS, normalizeQuality, sanitizeQualityPatch };
