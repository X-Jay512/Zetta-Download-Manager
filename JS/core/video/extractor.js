const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { getBinPath } = require('../bin-path');

class VideoExtractor extends EventEmitter {
  constructor() {
    super();
    this.ytdlpPath = this._findYtdlp();
  }

  _findYtdlp() {
    return getBinPath('yt-dlp.exe');
  }

  async getInfo(url) {
    return new Promise((resolve, reject) => {
      const args = ['--dump-json', '--no-download', '--flat-playlist', url];
      const proc = spawn(this.ytdlpPath, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => stdout += d);
      proc.stderr.on('data', (d) => stderr += d);

      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        try {
          const entries = stdout.trim().split('\n').map(l => JSON.parse(l));
          resolve(entries.length === 1 ? entries[0] : entries);
        } catch (e) { reject(e); }
      });
    });
  }

  async getFormats(url) {
    const info = await this.getInfo(url);
    const entries = Array.isArray(info) ? info : [info];
    return entries.map(entry => ({
      title: entry.title,
      duration: entry.duration,
      thumbnail: entry.thumbnail,
      formats: (entry.formats || []).map(f => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || `${f.width || '?'}x${f.height || '?'}`,
        filesize: f.filesize || f.filesize_approx,
        vcodec: f.vcodec,
        acodec: f.acodec,
        url: f.url,
      })),
    }));
  }

  download(url, outputPath, formatId = null) {
    const args = ['-o', outputPath, '--newline'];
    if (formatId) args.push('-f', formatId);
    args.push(url);

    const proc = spawn(this.ytdlpPath, args, { windowsHide: true });

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      const match = line.match(/(\d+\.?\d*)%/);
      if (match) this.emit('progress', parseFloat(match[1]));
    });

    proc.stderr.on('data', (data) => {
      this.emit('log', data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) this.emit('complete', outputPath);
      else this.emit('error', new Error(`yt-dlp exited with code ${code}`));
    });

    return proc;
  }
}

module.exports = { VideoExtractor };
