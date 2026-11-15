# Zetta Download Manager

High-speed download manager with video sniffing and browser integration.

## Structure
```
electron/          → Electron main process, preload, tray, IPC
core/
  engine/          → Download engine, segmentation, merger, speed tracker
    protocols/     → HTTP, HLS, FTP handlers
  queue/           → Queue manager, scheduler
  video/           → Video sniffer, yt-dlp extractor
  storage/         → JSON database, settings, category classifier
  clipboard/       → Clipboard URL monitor
  native-host/     → Named pipe server + Chrome manifest
extension/         → Chrome MV3 extension (background, content, popup)
src/
  index.html       → Main window
  css/index.css    → Design system
  js/app.js        → Renderer logic
scripts/           → Install helpers
vendor/            → Place yt-dlp.exe here
```

## Setup
```bash
npm install
npm run dev
```

## Browser Extension
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load Unpacked → select `extension/` folder
4. Run `npm run install-host` to register native messaging
