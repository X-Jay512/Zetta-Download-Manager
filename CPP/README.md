# C++ display tree

This folder is the C++ side of the files in `JS/`. It is for reading. It does not build on its own.

`core/zdm_str.hpp` is a display stand-in. In the private build those literals are encrypted, and the key is not here.

## Same job, shown in full

| JS | C++ |
| --- | --- |
| `app/main.js` | `app/main.cpp` |
| `app/updater.js` | `app/AppUpdate.cpp` |
| `app/preload.js` | `app/Bridge.h` |
| `app/duplicates.js` | `app/duplicates.hpp` |
| `app/link-refresh.js` | `app/link_refresh.hpp` |
| `app/tray.js` | `ui/MainWindow.cpp` |
| `src/js/app.js` | `ui/MainWindow.cpp`, `ui/DownloadList.cpp` |
| `src/js/theme.js` | `ui/Theme.cpp` |
| `src/js/settings.js` | `ui/SettingsDialog.cpp`, `core/storage/settings_manager.cpp` |
| `src/js/scheduler.js` | `ui/SchedulerDialog.cpp`, `core/queue/` |
| `src/js/progress.js` | `ui/ProgressDialog.cpp` |
| `src/js/playlist.js` | `ui/PlaylistDialog.cpp` |
| `src/js/add-dialog.js`, `address-dialog.js`, `properties.js` | `ui/Dialogs.cpp` |
| `src/js/ext-setup.js` | `ui/ExtensionPanel.cpp`, `ui/BrowserIpc.cpp` |
| `core/storage/` | `core/storage/` |
| `core/queue/` | `core/queue/` |
| `core/clipboard/monitor.js` | `core/clipboard/` |
| `core/video/` | `core/video/` |
| `core/browsers.js` | `core/browser/browsers.cpp` |

## Same job, body left out

These files exist so the shape is visible. The working code stays in the private tree.

| JS | C++ here |
| --- | --- |
| `app/ipc-handlers.js` | `ui/EngineBridge.cpp` |
| `src/js/grabber.js` | `ui/HlsPage.cpp` |
| `core/native-host/server.js` | `core/native-host/server.cpp` |
| `core/native-host/host.js` | `core/native-host/host_bridge.cpp` |
| `core/native-host/formats-for.js` | `core/native-host/formats_for.cpp` |
| `core/browser-extension.js` | `core/browser/browser_extension.cpp` |
| `core/crx-pack.js` | `core/browser/crx_pack.cpp` |
| `ext/`, `ext f/` | not included |

The download engine, the site capture, the segment writer, and the string-encryption key are not in this folder.
