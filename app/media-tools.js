const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function binPath(name) {
  const beside = path.join(__dirname, '..', 'bin', name);
  if (fs.existsSync(beside)) return beside;
  const publish = path.join(__dirname, '..', '..', 'dist', 'publish', 'bin', name);
  if (fs.existsSync(publish)) return publish;
  return name.replace(/\.exe$/i, '');
}

function runYtDlp(args) {
  const bin = binPath('yt-dlp.exe');
  const nodeBin = path.join(path.dirname(bin), 'node.exe');
  const extra = fs.existsSync(nodeBin) ? ['--remote-components', 'ejs:github', '--js-runtimes', `node:${nodeBin}`] : [];
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [...extra, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error((stderr || stdout || 'yt-dlp failed').trim().slice(0, 400)));
      else resolve(stdout);
    });
  });
}

async function listPlaylist(url) {
  const raw = await runYtDlp(['--flat-playlist', '--dump-json', '--no-download', '--no-warnings', String(url || '')]);
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let item;
    try { item = JSON.parse(trimmed); } catch { continue; }
    const list = Array.isArray(item.entries) ? item.entries : [item];
    for (const entry of list) {
      if (!entry || entry._type === 'playlist') continue;
      const id = entry.id || '';
      const page = (entry.url && /^https?:/i.test(entry.url) && entry.url) || entry.webpage_url || (id ? `https://www.youtube.com/watch?v=${id}` : '');
      if (!page) continue;
      entries.push({
        id,
        title: entry.title || id || 'video',
        duration: entry.duration || 0,
        url: page,
        playlistTitle: entry.playlist_title || entry.playlist || item.title || '',
      });
    }
  }
  return entries;
}

function playlistFormats(info) {
  const videos = [];
  const audios = [];
  for (const format of info.formats || []) {
    const hasVideo = format.vcodec && format.vcodec !== 'none';
    const hasAudio = format.acodec && format.acodec !== 'none';
    const size = format.filesize || format.filesize_approx || 0;
    if (hasVideo && format.height) {
      const existing = videos.find((item) => item.height === format.height);
      if (!existing) videos.push({ height: format.height, id: format.format_id, size, ext: format.ext || 'mp4' });
      else if (size > existing.size) Object.assign(existing, { id: format.format_id, size, ext: format.ext || existing.ext });
    } else if (hasAudio && !hasVideo) {
      const abr = Math.round(format.abr || format.tbr || 0);
      const existing = audios.find((item) => item.abr === abr && abr);
      if (!existing) audios.push({ abr, id: format.format_id, size, ext: format.ext || 'm4a' });
      else if (size > existing.size) Object.assign(existing, { id: format.format_id, size, ext: format.ext || existing.ext });
    }
  }
  videos.sort((a, b) => b.height - a.height);
  audios.sort((a, b) => b.abr - a.abr);
  return { videos, audios };
}

async function formatsForUrl(url) {
  const raw = await runYtDlp(['-J', '--no-download', '--no-warnings', String(url || '')]);
  return playlistFormats(JSON.parse(raw));
}

function muxVideoAudio(videoPath, audioPath, outputPath) {
  const bin = binPath('ffmpeg.exe');
  const args = ['-y', '-i', videoPath, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', outputPath];
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error((stderr || 'ffmpeg failed').trim().slice(-200)));
    });
  });
}

module.exports = { runYtDlp, listPlaylist, formatsForUrl, muxVideoAudio };
