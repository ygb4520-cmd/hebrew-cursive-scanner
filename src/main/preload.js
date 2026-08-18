const { contextBridge, ipcRenderer, webUtils } = require('electron');

// A deliberately narrow API surface exposed to the renderer — no direct
// filesystem/network access, no raw Node APIs, no API key ever crosses into
// the renderer process.
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseSyncFolder: () => ipcRenderer.invoke('syncfolder:choose'),

  hasApiKey: () => ipcRenderer.invoke('apikey:has'),
  setApiKey: (key) => ipcRenderer.invoke('apikey:set', key),
  clearApiKey: () => ipcRenderer.invoke('apikey:clear'),

  pickImage: () => ipcRenderer.invoke('image:pick'),
  createNoteFromFile: (filePath) => ipcRenderer.invoke('note:create-from-file', filePath),
  updateNoteText: (id, text) => ipcRenderer.invoke('note:update-text', { id, text }),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  revealInFolder: (filePath) => ipcRenderer.invoke('notes:reveal', filePath),
  deleteNote: (id) => ipcRenderer.invoke('note:delete', id),

  // Needed to resolve a real filesystem path from a drag-and-dropped File
  // object (File.path was removed from the renderer in newer Electron).
  getPathForFile: (file) => webUtils.getPathForFile(file),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: (assetUrl) => ipcRenderer.invoke('update:apply', assetUrl),
});
