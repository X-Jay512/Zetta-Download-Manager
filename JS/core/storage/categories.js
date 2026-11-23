const path = require('path');

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host, pattern) {
  let needle = String(pattern || '').trim().toLowerCase();
  needle = needle.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  needle = needle.replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^www\./, '');
  if (!needle) return false;
  return host === needle || host.endsWith('.' + needle);
}

const DEFAULT_CATEGORIES = {
  all:         { label: 'All Downloads', icon: 'folder',      filter: () => true },
  compressed:  { label: 'Compressed',    icon: 'archive',     extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'] },
  documents:   { label: 'Documents',     icon: 'file-text',   extensions: ['.pdf', '.doc', '.docx', '.txt', '.xls'] },
  music:       { label: 'Sounds',        icon: 'music',       extensions: ['.mp3', '.flac', '.wav', '.aac', '.ogg'] },
  programs:    { label: 'Programs',      icon: 'package',     extensions: ['.exe', '.msi', '.dmg', '.deb'] },
  video:       { label: 'Video',         icon: 'video',       extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'] },
  images:      { label: 'Images',        icon: 'image',       extensions: ['.jpg', '.png', '.gif', '.bmp', '.svg', '.webp'] },
  unfinished:  { label: 'Unfinished',    icon: 'clock',       filter: (d) => d.status !== 'complete' },
  finished:    { label: 'Finished',      icon: 'check-circle', filter: (d) => d.status === 'complete' },
};

class CategoryManager {
  constructor() {
    this.categories = { ...DEFAULT_CATEGORIES };
  }

  classify(fileName, url, patterns) {
    const host = hostOf(url);
    if (host && patterns) {
      for (const key of ['video', 'music', 'programs', 'compressed', 'documents', 'images']) {
        const list = patterns[key];
        if (!Array.isArray(list)) continue;
        if (list.some((pattern) => hostMatches(host, pattern))) return key;
      }
    }
    const ext = path.extname(fileName || '').toLowerCase();
    for (const [key, cat] of Object.entries(this.categories)) {
      if (cat.extensions && cat.extensions.includes(ext)) return key;
    }
    return 'general';
  }

  getCategory(name) {
    return this.categories[name];
  }

  getAllCategories() {
    return Object.entries(this.categories).map(([key, val]) => ({ key, ...val }));
  }
}

module.exports = { CategoryManager };
