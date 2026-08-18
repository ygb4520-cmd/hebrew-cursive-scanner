const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const settingsStore = require('./store');
const apiKeyStore = require('./apiKeyStore');
const { isSupportedImage, loadImageForTranscription, prepareImagesForGemini } = require('./imageUtils');
const gemini = require('./gemini');
const notesStore = require('./notesStore');
const updater = require('./updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: 'Hebrew Cursive Scanner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: settings / sync folder -------------------------------------------------

ipcMain.handle('settings:get', () => settingsStore.readSettings());

ipcMain.handle('syncfolder:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder inside your cloud-synced folder (Google Drive, Dropbox, iCloud Drive…)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  settingsStore.writeSettings({ syncFolderPath: chosen });
  return chosen;
});

// ---- IPC: API key -----------------------------------------------------------------

ipcMain.handle('apikey:has', () => apiKeyStore.hasApiKey());

ipcMain.handle('apikey:set', (_event, key) => {
  apiKeyStore.setApiKey(key);
  return true;
});

ipcMain.handle('apikey:clear', () => {
  apiKeyStore.clearApiKey();
  return true;
});

// ---- IPC: image import + transcription ---------------------------------------------

ipcMain.handle('image:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a photo of handwritten Hebrew notes',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  if (!isSupportedImage(filePath)) {
    throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
  }
  return filePath;
});

ipcMain.handle('note:create-from-file', async (_event, filePath) => {
  const settings = settingsStore.readSettings();
  if (!settings.syncFolderPath) {
    throw new Error('No sync folder is configured yet. Open Settings and choose one first.');
  }
  if (!apiKeyStore.hasApiKey()) {
    throw new Error('No Gemini API key is configured yet. Open Settings and paste your free API key first.');
  }

  const { buffer, storedExtension } = await loadImageForTranscription(filePath);
  const images = await prepareImagesForGemini(buffer);
  const apiKey = apiKeyStore.getApiKey();
  const text = await gemini.transcribeHandwriting({ apiKey, images });

  const note = notesStore.createNote(settings.syncFolderPath, {
    imageBuffer: buffer,
    storedExtension,
    text,
  });
  return note;
});

ipcMain.handle('note:update-text', (_event, { id, text }) => {
  const settings = settingsStore.readSettings();
  return notesStore.updateNoteText(settings.syncFolderPath, id, text);
});

ipcMain.handle('notes:list', () => {
  const settings = settingsStore.readSettings();
  if (!settings.syncFolderPath) return [];
  return notesStore.listNotes(settings.syncFolderPath);
});

ipcMain.handle('notes:reveal', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('note:delete', async (_event, id) => {
  const settings = settingsStore.readSettings();
  const dir = notesStore.noteDir(settings.syncFolderPath, id);
  // Send to the OS trash rather than permanently deleting, so it's
  // recoverable if this was a mistake.
  await shell.trashItem(dir);
  return true;
});

// ---- IPC: self-update -------------------------------------------------------------

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  try {
    return await updater.checkForUpdate();
  } catch {
    return { available: false };
  }
});

ipcMain.handle('update:apply', async (_event, assetUrl) => {
  await updater.applyUpdate(assetUrl);
  return true;
});
