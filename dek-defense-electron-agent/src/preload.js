const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dekAgent', {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke('agent:get-status'),
  openStorage: () => ipcRenderer.invoke('agent:open-storage'),
  openZoom: (zoomUrl) => ipcRenderer.invoke('agent:open-zoom', zoomUrl),
  setKioskMode: (enabled) => ipcRenderer.invoke('agent:set-kiosk-mode', enabled),
  getStorage: () => ipcRenderer.invoke('agent:get-storage'),
  changeStorage: () => ipcRenderer.invoke('agent:change-storage'),
  deletePresentation: (sessionId, studentId) => ipcRenderer.invoke('agent:delete-presentation', sessionId, studentId),
  closePresentation: (password) => ipcRenderer.invoke('agent:close-presentation', password),
  listDrives: () => ipcRenderer.invoke('agent:list-drives'),
  readDir: (dirPath) => ipcRenderer.invoke('agent:read-dir', dirPath),
  uploadLocalFiles: (files, studentId, sessionId) => ipcRenderer.invoke('agent:upload-local-files', files, studentId, sessionId),
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
