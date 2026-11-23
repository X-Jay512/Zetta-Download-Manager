const { contextBridge, ipcRenderer } = require('electron');

let initialAppearance = null;
try {
  initialAppearance = ipcRenderer.sendSync('appearance:get-sync');
} catch { /* the window can paint before the main process answers */ }

if (initialAppearance && typeof document !== 'undefined') {
  const applyEarly = () => {
    if (!document.documentElement) return;
    document.documentElement.dataset.theme = initialAppearance.theme || 'theme1';
    document.documentElement.dataset.lines = initialAppearance.columnLines ? 'on' : 'off';
    if (initialAppearance.iconSaturation != null) {
      document.documentElement.style.setProperty('--icon-saturate', String(initialAppearance.iconSaturation / 100));
    }
  };
  applyEarly();
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', applyEarly, { once: true });
  }
}

const CHANNELS = {
  send: [
    'window:minimize',
    'window:maximize',
    'window:close',
    'window:open-settings',
    'window:open-extension-setup',
    'window:open-scheduler',
    'window:open-playlist',
    'window:open-add-dialog',
    'window:open-address-dialog',
    'window:open-properties',
    'appearance:changed',
    'guides:open',
    'guides:copy',
    'app:get-info',
    'ext-setup:done',
    'playlist:list',
    'playlist:formats',
    'video:mux',
  ],
  receive: [
    'appearance:changed',
    'scheduler:navigate',
  ],
};

contextBridge.exposeInMainWorld('zdm', {
  send: (channel, ...args) => {
    if (CHANNELS.send.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) => {
    if (CHANNELS.send.includes(channel)) return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, listener) => {
    if (!CHANNELS.receive.includes(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
