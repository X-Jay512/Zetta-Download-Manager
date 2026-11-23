const EventEmitter = require('events');

const MEDIA_PATTERNS = [
  /\.mp4(\?|$)/i, /\.webm(\?|$)/i, /\.mkv(\?|$)/i,
  /\.flv(\?|$)/i, /\.avi(\?|$)/i, /\.mov(\?|$)/i,
  /\.m3u8(\?|$)/i, /\.ts(\?|$)/i, /\.mpd(\?|$)/i,
];

const MEDIA_MIME_TYPES = [
  'video/mp4', 'video/webm', 'video/x-flv', 'video/x-matroska',
  'application/vnd.apple.mpegurl', 'application/x-mpegURL', 'video/MP2T',
  'application/dash+xml', 'audio/mpeg', 'audio/mp4',
];

class VideoSniffer extends EventEmitter {
  constructor() {
    super();
    this.detectedUrls = new Map();
  }

  analyze(request) {
    const { url, type, contentType, tabUrl, tabTitle } = request;

    const isMedia = this._matchesPattern(url) || this._matchesMime(contentType);
    if (!isMedia) return null;

    if (this.detectedUrls.has(url)) return null;

    const entry = {
      url,
      type: this._classifyType(url, contentType),
      contentType,
      tabUrl,
      tabTitle,
      detectedAt: Date.now(),
    };

    this.detectedUrls.set(url, entry);
    this.emit('video-detected', entry);
    return entry;
  }

  _matchesPattern(url) {
    return MEDIA_PATTERNS.some(p => p.test(url));
  }

  _matchesMime(mime) {
    if (!mime) return false;
    return MEDIA_MIME_TYPES.some(m => mime.toLowerCase().includes(m.toLowerCase()));
  }

  _classifyType(url, mime) {
    if (/\.m3u8/i.test(url) || (mime && mime.includes('mpegurl'))) return 'hls';
    if (/\.mpd/i.test(url) || (mime && mime.includes('dash'))) return 'dash';
    return 'direct';
  }

  clear() {
    this.detectedUrls.clear();
  }
}

module.exports = { VideoSniffer };
