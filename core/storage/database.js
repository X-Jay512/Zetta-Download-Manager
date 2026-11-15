const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.dbPath = path.join(require('electron').app.getPath('userData'), 'downloads.json');
    this.data = { downloads: [] };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      }
    } catch { this.data = { downloads: [] }; }
  }

  _save() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  createDownload(opts) {
    const record = {
      id: opts.id || uuidv4(),
      url: opts.url,
      audioUrl: opts.audioUrl || null,
      fileName: opts.fileName || '',
      savePath: opts.savePath || '',
      fileSize: opts.fileSize || 0,
      audioSize: Number(opts.audioSize) || 0,
      duration: Number(opts.duration) || 0,
      segments: opts.segments || 8,
      headers: opts.headers || {},
      referrer: opts.referrer || '',
      sourcePage: opts.sourcePage || '',
      playlistUrl: opts.playlistUrl || '',
      formatId: opts.formatId || '',
      audioFormatId: opts.audioFormatId || '',
      needsRefresh: !!opts.needsRefresh,
      login: opts.login || '',
      password: opts.password || '',
      cookies: opts.cookies || '',
      exactHeaders: !!opts.exactHeaders,
      tempPath: opts.tempPath || '',
      category: opts.category || 'general',
      audioOnly: !!opts.audioOnly,
      description: opts.description || '',
      checksum: opts.checksum || '',
      status: 'queued',
      createdAt: new Date().toISOString(),
      lastTriedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    this.data.downloads.push(record);
    this._save();
    return record;
  }

  updateDownload(id, updates) {
    const idx = this.data.downloads.findIndex(d => d.id === id);
    if (idx !== -1) {
      Object.assign(this.data.downloads[idx], updates);
      this._save();
    }
  }

  getDownload(id) {
    return this.data.downloads.find(d => d.id === id);
  }

  getDownloadsByCategory(category) {
    let list;
    if (category === 'all') list = this.data.downloads;
    else if (category === 'unfinished') list = this.data.downloads.filter(d => d.status !== 'complete');
    else if (category === 'finished') list = this.data.downloads.filter(d => d.status === 'complete');
    else list = this.data.downloads.filter(d => d.category === category);
    
    return list.map(dl => {
      if (dl.status === 'complete' && !dl.path) {
        dl.path = path.join(dl.savePath || require('os').homedir(), dl.fileName || 'download');
      }
      return dl;
    });
  }

  removeDownload(id) {
    this.data.downloads = this.data.downloads.filter(d => d.id !== id);
    this._save();
  }

  getAll() {
    return this.data.downloads;
  }
}

module.exports = { Database };
