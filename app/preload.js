const { contextBridge, ipcRenderer } = require('electron');

let initialAppearance = null;
try {
  initialAppearance = ipcRenderer.sendSync('appearance:get-sync');
} catch {}

if (initialAppearance && typeof document !== 'undefined') {
  const applyEarly = () => {
    if (document.documentElement) {
      document.documentElement.dataset.theme = initialAppearance.theme || 'theme1';
      document.documentElement.dataset.lines = initialAppearance.columnLines ? 'on' : 'off';
      if (initialAppearance.iconSaturation != null) {
        document.documentElement.style.setProperty('--icon-saturate', String(initialAppearance.iconSaturation / 100));
      }
    }
  };
  applyEarly();
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', applyEarly, { once: true });
  }
}

const CHANNELS = {
  send: [
    'download:add', 'download:pause', 'download:resume', 'download:cancel', 'download:abandon',
    'download:remove', 'download:retry', 'download:redownload', 'download:open-file', 'download:open-folder', 'download:open-with', 'download:confirm-cancel',
    'queue:start', 'queue:stop', 'queue:set-limit',
    'scheduler:add', 'scheduler:remove',
    'settings:update', 'settings:get', 'settings:reset', 'settings:pick-folder', 'settings:restore-part',
    'clipboard:toggle',
    'window:minimize', 'window:maximize', 'window:close',
    'category:get-downloads',
    'app:get-info',
    'app:get-add-dialog-data',
    'app:get-complete-dialog-data',
    'app:get-properties',
    'window:open-settings',
    'window:open-extension-setup',
    'appearance:changed',
    'window:open-add-dialog',
    'window:open-address-dialog',
    'window:open-playlist',
    'playlist:list',
    'playlist:formats',
    'playlist:add',
    'playlist:saved',
    'playlist:remove',
    'playlist:remember',
    'playlist:queues',
    'playlist:create-queue',
    'playlist:assign',
    'window:confirm-address',
    'window:fit-add-dialog',
    'window:fit-complete-dialog',
    'window:fit-address-dialog',
    'window:toggle-address-history',
    'app:get-address-history',
    'progress:get',
    'progress:open',
    'progress:trace',
    'progress:reveal-complete',
    'progress:fit',
    'progress:set-limit',
    'progress:set-finish',
    'refresh:stop',
    'refresh:accept',
    'refresh:decline',
    'address:history-pick',
    'window:open-properties',
    'grabber:extract',
    'grabber:explore',
    'shell:pick-file',
    'system:power',
    'shell:file-icon',
    'library:sweep-missing',
    'library:export',
    'library:import',
    'settings:export',
    'settings:import',
    'app:portable-status',
    'app:enable-portable',
    'browsers:scan',
    'browsers:install-extension',
    'browsers:copy-extension-path',
    'guides:open',
    'guides:copy',
    'ext-setup:done',
    'browsers:remove-extension',
    'browsers:get-status',
    'app:get-address-prefill',
    'window:open-scheduler',
  ],
  receive: [
    'download:progress', 'download:complete', 'download:error', 'download:added', 'download:metadata',
    'download:paused', 'download:resumed', 'download:removed', 'download:reset',
    'new-download-from-browser', 'clipboard:url-detected', 'address:history-pick', 'address:prefill', 'appearance:changed', 'playlists:changed',
    'queue:start-all', 'queue:stop-all', 'queue:start', 'queue:updated', 'scheduler:triggered',
    'settings:loaded', 'settings:changed', 'scheduler:navigate', 'browser:status-changed',
  ],
};

contextBridge.exposeInMainWorld('zdm', {
  send: (channel, ...args) => {
    if (CHANNELS.send.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  invoke: (channel, ...args) => {
    if (CHANNELS.send.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
  },

  on: (channel, callback) => {
    if (CHANNELS.receive.includes(channel)) {
      const handler = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },

  once: (channel, callback) => {
    if (CHANNELS.receive.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  },

  platform: process.platform,
  initialAppearance,
});
