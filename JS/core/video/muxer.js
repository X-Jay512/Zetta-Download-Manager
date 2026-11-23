const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class VideoMuxer extends EventEmitter {
  constructor() {
    super();
    this.ffmpegPath = this._findFfmpeg();
  }

  _findFfmpeg() {
    const vendorPath = path.join(__dirname, '..', '..', 'vendor', 'ffmpeg.exe');
    if (fs.existsSync(vendorPath)) return vendorPath;
    return 'ffmpeg';
  }

  async mux(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ];

      const proc = spawn(this.ffmpegPath, args, { windowsHide: true });
      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)/);
        const timeMatch = data.toString().match(/time=(\d+):(\d+):(\d+)/);
        if (durMatch && timeMatch) {
          const total = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]);
          const current = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          if (total > 0) this.emit('progress', Math.min(100, (current / total) * 100));
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          this.emit('complete', outputPath);
          resolve(outputPath);
        } else {
          const err = new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`);
          this.emit('error', err);
          reject(err);
        }
      });

      proc.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  async probe(filePath) {
    const ffprobePath = this.ffmpegPath.replace('ffmpeg', 'ffprobe');
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];

      const proc = spawn(ffprobePath, args, { windowsHide: true });
      let stdout = '';

      proc.stdout.on('data', (d) => stdout += d);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error('ffprobe failed'));
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(e); }
      });
    });
  }
}

module.exports = { VideoMuxer };
