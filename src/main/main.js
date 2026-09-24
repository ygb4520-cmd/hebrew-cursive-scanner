const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// Opt-in test-profile redirect, active only when HCS_TEST_USERDATA_DIR is
// set at launch -- normal launches are completely unaffected. Points every
// path this app reads/writes through app.getPath('userData') (settings,
// the encrypted API key, note metadata's own cache, Chromium's profile
// data) at a throwaway directory instead of the real one, so automated
// UI testing (see .claude/skills/run-hebrew-cursive-scanner-app) never
// touches your real saved notes, settings, or API key. Must run before
// anything else in this file calls app.getPath('userData').
if (process.env.HCS_TEST_USERDATA_DIR) {
  app.setPath('userData', process.env.HCS_TEST_USERDATA_DIR);
}

const settingsStore = require('./store');
const apiKeyStore = require('./apiKeyStore');
const {
  isSupportedImage,
  loadImageForTranscription,
  prepareImagesForGemini,
  generatePreviewDataUrl,
} = require('./imageUtils');
const { segmentIntoLines } = require('./lineSegmenter');
const gemini = require('./gemini');
const notesStore = require('./notesStore');
const updater = require('./updater');

const LINE_TRANSCRIBE_CONCURRENCY = 3;
const LINE_RATE_LIMIT_MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_ERROR_KINDS = new Set(['quota', 'unavailable']);

async function transcribeLineWithRetry(apiKey, image) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gemini.transcribeLine({ apiKey, image });
    } catch (err) {
      // Retries both real rate-limiting (429) and transient "high demand"
      // server overload (503+) -- the latter showed up in real testing and
      // originally wasn't retried at all, failing lines that would have
      // succeeded a few seconds later.
      if (RETRYABLE_ERROR_KINDS.has(err.kind) && attempt < LINE_RATE_LIMIT_MAX_RETRIES) {
        await sleep(1000 * 2 ** (attempt + 1)); // 2s, 4s, 8s
        continue;
      }
      throw err;
    }
  }
}

// Runs `worker` over `items` with at most `limit` in flight at once, calling
// `onProgress(doneCount, total)` after each one finishes (order not
// guaranteed, but results[] preserves the original index order).
async function mapWithConcurrencyLimit(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let doneCount = 0;

  async function runNext(startDelay) {
    if (startDelay) await sleep(startDelay);
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
      doneCount++;
      if (onProgress) onProgress(doneCount, items.length);
    }
  }

  // Stagger each concurrent slot's first request slightly rather than
  // firing them all in the same instant -- real testing hit 503 ("high
  // demand") errors on 3 simultaneous first requests; staggering is a
  // reasonable mitigation, though the retry-on-503 fix above is what
  // actually guarantees those errors get resolved either way.
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, (_, slot) => runNext(slot * 250));
  await Promise.all(workers);
  return results;
}

// Transcribes a page by splitting it into individual line images and
// transcribing each one separately (a real Hebrew-handwriting benchmark
// shows Gemini reads a single line far more accurately than a whole page —
// see lineSegmenter.js for the full rationale), joining the results back
// into one block of text in reading order. Falls back to whole-page
// transcription if segmentation isn't confident about where the lines are.
//
// Returns { text, lineBoxes }. lineBoxes (null on the whole-page fallback,
// since there's no per-line data in that case) lets the UI show which spot
// on the photo a hovered word came from — see lineSegmenter.js for how the
// word boxes themselves are found, and renderer.js for how a mismatch
// between word-box count and actual transcribed word count falls back to
// highlighting the whole line instead of guessing wrong.
async function transcribeByLines(apiKey, photoBuffer, sendProgress) {
  sendProgress({ phase: 'segmenting' });
  const segmentation = await segmentIntoLines(photoBuffer);

  if (!segmentation) {
    sendProgress({ phase: 'whole-page' });
    const [wholePageImage] = await prepareImagesForGemini(photoBuffer);
    const text = await gemini.transcribeHandwriting({ apiKey, images: [wholePageImage] });
    return { text, lineBoxes: null };
  }

  const { width, height, lines } = segmentation;
  sendProgress({ phase: 'transcribing', done: 0, total: lines.length });
  const lineTexts = await mapWithConcurrencyLimit(
    lines,
    LINE_TRANSCRIBE_CONCURRENCY,
    async (line, index) => {
      try {
        return await transcribeLineWithRetry(apiKey, line.image);
      } catch (err) {
        return `[⚠ line ${index + 1} of ${lines.length} failed to transcribe: ${err.message}]`;
      }
    },
    (done, total) => sendProgress({ phase: 'transcribing', done, total })
  );

  const lineBoxes = lines.map((line) => ({
    top: line.top / height,
    bottom: (line.bottom + 1) / height,
    wordBoxes: line.wordBoxes,
  }));

  return { text: lineTexts.join('\n'), lineBoxes };
}

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
    title: 'Select a photo or scanned PDF of handwritten Hebrew notes',
    properties: ['openFile'],
    filters: [
      { name: 'Photos and PDFs', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'pdf'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  if (!isSupportedImage(filePath)) {
    throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
  }
  return filePath;
});

ipcMain.handle('image:preview', (_event, filePath, rotationDegrees) =>
  generatePreviewDataUrl(filePath, rotationDegrees)
);

ipcMain.handle('note:create-from-file', async (_event, filePath, rotationDegrees = 0, cropBox = null) => {
  const settings = settingsStore.readSettings();
  if (!settings.syncFolderPath) {
    throw new Error('No sync folder is configured yet. Open Settings and choose one first.');
  }
  if (!apiKeyStore.hasApiKey()) {
    throw new Error('No Gemini API key is configured yet. Open Settings and paste your free API key first.');
  }

  const { buffer, storedExtension } = await loadImageForTranscription(filePath, rotationDegrees, cropBox);
  const apiKey = apiKeyStore.getApiKey();
  const { text, lineBoxes } = await transcribeByLines(apiKey, buffer, (progress) => {
    mainWindow?.webContents.send('note:progress', progress);
  });

  const note = notesStore.createNote(settings.syncFolderPath, {
    imageBuffer: buffer,
    storedExtension,
    text,
    lineBoxes,
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
