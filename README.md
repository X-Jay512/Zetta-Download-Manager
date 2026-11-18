# Zetta Download Manager

<p align="center">
  <img src="src/assets/icons/app.ico" alt="Zetta Download Manager" width="128">
</p>

<p align="center">
  <strong>One app to download everything — no extra tools needed.</strong>
</p>

<p align="center">
  <a href="https://github.com/X-Jay512/Zetta-Download-Manager/releases">
    <img src="https://img.shields.io/github/v/release/X-Jay512/Zetta-Download-Manager?style=for-the-badge&color=blue" alt="Latest Release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=for-the-badge&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-Proprietary-red?style=for-the-badge" alt="License">
</p>

---

## 💡 The Vision

The idea is simple: **one program that downloads everything** — files, videos, audio, playlists — without depending on any external software.

Zetta is still **under active development** and there is a lot more to come, but here's what it can already do today.

> [!NOTE]
> This is **not open source**. What you see here is only a portion of the source code, not the full codebase.

---

## ✨ What You Get Right Now

### 🚀 Full-Speed File Downloads
Download any file from any website at your **maximum internet speed**. Many download managers can't handle every site — that's why IDM has stayed relevant for so long. Zetta is built to change that: delivering **IDM-level (and beyond) download quality, completely free**. I believe what's already here surpasses IDM in several ways.

<p align="center">
  <img src="src/assets/ui/xjay/all-downloads.png" alt="All Downloads" width="700">
</p>

### 🎬 Video Downloads — Straight From Your Browser
See a video playing in your browser? **Grab it directly.**

- **Multiple dubs?** Pick the dubbing language you want
- **Video quality?** Choose your preferred resolution
- **Audio quality?** Select the bitrate that suits you
- **Transcript available?** Download it right alongside the video

<p align="center">
  <img src="src/assets/ui/xjay/grabber.png" alt="Video Grabber" width="700">
</p>

### 📋 Full Playlist Downloads
Download an **entire playlist** in one go with full control over:

- Video quality selection
- Audio quality selection
- Audio-only mode (perfect for music playlists)

<p align="center">
  <img src="src/assets/ui/xjay/add-playlist.png" alt="Playlist Download" width="700">
</p>

### 🎵 Audio Downloads
Need just the audio? Zetta handles that too — download audio tracks directly with quality control.

---

## 📸 Screenshots

<p align="center">
  <img src="src/assets/ui/xjay/add-url.png" alt="Add URL" width="700">
</p>
<p align="center"><em>Adding a new download</em></p>

<p align="center">
  <img src="src/assets/ui/xjay/queues.png" alt="Download Queues" width="700">
</p>
<p align="center"><em>Managing download queues</em></p>

<p align="center">
  <img src="src/assets/ui/xjay/scheduler.png" alt="Scheduler" width="700">
</p>
<p align="center"><em>Built-in download scheduler</em></p>

<p align="center">
  <img src="src/assets/ui/xjay/options.png" alt="Options" width="700">
</p>
<p align="center"><em>Settings & options</em></p>

---

## 🔧 Setup

```bash
npm install
npm run dev
```

## 🌐 Browser Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load Unpacked** → select the `ext/` folder
4. Run `npm run install-host` to register native messaging

---

## 🗂️ Project Structure

```
app/               → Electron main process, preload, tray, IPC
core/
  engine/          → Download engine, segmentation, merger, speed tracker
    protocols/     → HTTP, HLS, FTP handlers
  queue/           → Queue manager, scheduler
  video/           → Video sniffer, yt-dlp extractor
  storage/         → JSON database, settings, category classifier
  clipboard/       → Clipboard URL monitor
  native-host/     → Named pipe server + Chrome manifest
ext/               → Chrome MV3 extension (background, content, popup)
src/
  index.html       → Main window
  css/index.css    → Design system
  js/app.js        → Renderer logic
scripts/           → Install helpers
bin/               → ffmpeg & yt-dlp binaries
```

---

## 🚧 Roadmap

This project is under heavy development. Many features are planned and on the way. Stay tuned.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/X-Jay512">XJay5</a>
</p>
