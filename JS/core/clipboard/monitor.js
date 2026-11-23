const EventEmitter = require('events');
const { clipboard } = require('electron');

const URL_REGEX = /^https?:\/\/[^\s]+$/i;

const DOWNLOADABLE_EXTENSIONS = [
  '.zip', '.rar', '.7z', '.exe', '.msi', '.pdf', '.doc', '.docx',
  '.mp3', '.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.iso',
  '.tar', '.gz', '.dmg', '.apk', '.deb', '.rpm', '.flac', '.wav',
  '.m3u8',
];

class ClipboardMonitor extends EventEmitter {
  constructor(intervalMs = 1000) {
    super();
    this.intervalMs = intervalMs;
    this.lastContent = '';
    this.timer = null;
    this.extensions = DOWNLOADABLE_EXTENSIONS.slice();
  }

  setExtensions(list) {
    if (!Array.isArray(list) || list.length === 0) return;
    this.extensions = list.map((e) => (e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase()));
  }

  start() {
    if (this.timer) return;
    this.lastContent = clipboard.readText();
    this.timer = setInterval(() => this._check(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _check() {
    const current = clipboard.readText().trim();
    if (current === this.lastContent) return;
    this.lastContent = current;

    if (!URL_REGEX.test(current)) return;

    const isDownloadable = this.extensions.some(ext =>
      current.toLowerCase().includes(ext)
    );

    if (isDownloadable) {
      this.emit('url-detected', current);
    }
  }

  isRunning() {
    return this.timer !== null;
  }
}

module.exports = { ClipboardMonitor };
