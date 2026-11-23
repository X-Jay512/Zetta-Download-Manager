const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

class TrayManager {
  constructor(hooks) {
    this.hooks = hooks || {};
    this.hooks.updateMenu = () => this.updateMenu();
    this.tray = null;
    this._create();
  }

  _create() {
    const iconPath = path.join(__dirname, '..', 'src', 'assets', 'icons', 'tray.png');
    this.tray = new Tray(nativeImage.createEmpty());

    try {
      this.tray.setImage(iconPath);
    } catch { /* fallback to empty */ }

    this.tray.setToolTip('Zetta Download Manager');
    this.updateMenu();

    this.tray.on('click', () => { if (this.hooks.show) this.hooks.show(); });
    this.tray.on('double-click', () => { if (this.hooks.show) this.hooks.show(); });
    this.tray.on('right-click', () => { this.updateMenu(); });
  }

  updateMenu() {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.setContextMenu(this._buildMenu());
    }
  }

  _buildMenu() {
    const queues = (this.hooks.getQueues && this.hooks.getQueues()) || [
      { id: 'main', name: 'General queue' },
      { id: 'sync', name: 'Repeat queue' },
    ];

    const queueSubmenu = [
      ...queues.map((q) => ({
        label: q.name || 'Queue',
        click: () => {
          if (this.hooks.startQueue) this.hooks.startQueue(q.id);
        },
      })),
      { type: 'separator' },
      {
        label: 'All queues',
        click: () => {
          if (this.hooks.startQueue) this.hooks.startQueue('all');
        },
      },
    ];

    return Menu.buildFromTemplate([
      { label: 'Show', click: () => { if (this.hooks.show) this.hooks.show(); } },
      {
        label: 'Start queue',
        submenu: queueSubmenu,
      },
      { type: 'separator' },
      { label: 'Exit', click: () => { require('electron').app.isQuitting = true; require('electron').app.quit(); } },
    ]);
  }

  destroy() {
    if (this.tray) this.tray.destroy();
  }
}

module.exports = { TrayManager };
