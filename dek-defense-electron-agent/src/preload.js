const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dekAgent', {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke('agent:get-status'),
  openStorage: () => ipcRenderer.invoke('agent:open-storage'),
  openZoom: (zoomUrl) => ipcRenderer.invoke('agent:open-zoom', zoomUrl),
  closePresentation: (password) => ipcRenderer.invoke('agent:close-presentation', password),
  on: (channel, callback) => {
    const allowed = [
      'agent-ready',
      'agent-error',
      'station-status',
      'command-running',
      'presentation-uploaded',
      'presentation-converted'
    ];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_, payload) => callback(payload));
  }
});
