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

  // Optional, separate key for the line-segmentation feature — lets it use
  // its own Google Cloud project's API quota instead of sharing the
  // transcription key's quota.
  hasSegmentationApiKey: () => ipcRenderer.invoke('apikey:segmentation:has'),
  setSegmentationApiKey: (key) => ipcRenderer.invoke('apikey:segmentation:set', key),
  clearSegmentationApiKey: () => ipcRenderer.invoke('apikey:segmentation:clear'),

  // Optional third key, used automatically (for either key above) when a
  // request fails because that key is out of quota.
  hasFallbackApiKey: () => ipcRenderer.invoke('apikey:fallback:has'),
  setFallbackApiKey: (key) => ipcRenderer.invoke('apikey:fallback:set', key),
  clearFallbackApiKey: () => ipcRenderer.invoke('apikey:fallback:clear'),

  pickImage: () => ipcRenderer.invoke('image:pick'),
  getImagePreview: (filePath, rotationDegrees) =>
    ipcRenderer.invoke('image:preview', filePath, rotationDegrees),
  createNoteFromFile: (filePath, rotationDegrees, cropBox) =>
    ipcRenderer.invoke('note:create-from-file', filePath, rotationDegrees, cropBox),
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

  // Live progress while a note is being segmented into lines and
  // transcribed. Returns an unsubscribe function.
  onImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('note:progress', listener);
    return () => ipcRenderer.removeListener('note:progress', listener);
  },

  // Live progress while a self-update downloads and installs. Returns an
  // unsubscribe function.
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
});
