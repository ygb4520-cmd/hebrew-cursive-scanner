// Notes are stored as plain files inside a subfolder of whatever folder the
// user has pointed us at (expected to live inside their Google Drive / other
// cloud-sync client's local folder). We never talk to Google's API directly
// for sync — the OS-level cloud-sync client does that. We just read/write
// files and rescan on open.
//
// Layout: <chosenFolder>/HebrewCursiveScannerNotes/notes/<id>/meta.json
//                                                              /photo.<ext>
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const APP_SUBFOLDER = 'HebrewCursiveScannerNotes';

class SyncFolderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncFolderError';
  }
}

function notesRootDir(chosenFolderPath) {
  if (!chosenFolderPath) {
    throw new SyncFolderError('No sync folder is configured yet. Choose one in Settings.');
  }
  if (!fs.existsSync(chosenFolderPath)) {
    throw new SyncFolderError(
      `The configured sync folder no longer exists at: ${chosenFolderPath}. Re-select it in Settings.`
    );
  }
  return path.join(chosenFolderPath, APP_SUBFOLDER, 'notes');
}

function ensureNotesRootDir(chosenFolderPath) {
  const dir = notesRootDir(chosenFolderPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Path to a single note's folder — used by main.js to send it to the OS
// trash (not a permanent delete) via Electron's shell.trashItem.
function noteDir(chosenFolderPath, id) {
  return path.join(notesRootDir(chosenFolderPath), id);
}

function listNotes(chosenFolderPath) {
  const dir = notesRootDir(chosenFolderPath);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const notes = [];
  for (const entry of entries) {
    const metaPath = path.join(dir, entry.name, 'meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      notes.push({
        ...meta,
        photoPath: path.join(dir, entry.name, meta.imageFile),
      });
    } catch {
      // Skip notes that are mid-sync (photo/meta not fully written yet) or corrupt.
    }
  }

  notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return notes;
}

function createNote(chosenFolderPath, { imageBuffer, storedExtension, text }) {
  const dir = ensureNotesRootDir(chosenFolderPath);
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const noteDir = path.join(dir, id);
  fs.mkdirSync(noteDir, { recursive: true });

  const imageFile = `photo${storedExtension}`;
  fs.writeFileSync(path.join(noteDir, imageFile), imageBuffer);

  const meta = {
    id,
    timestamp: new Date().toISOString(),
    text,
    imageFile,
    sourceMachine: os.hostname(),
  };
  // Write meta.json last so a half-written note (e.g. Drive syncing mid-write)
  // is naturally skipped by listNotes() until it's complete.
  fs.writeFileSync(path.join(noteDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { ...meta, photoPath: path.join(noteDir, imageFile) };
}

function updateNoteText(chosenFolderPath, id, newText) {
  const dir = notesRootDir(chosenFolderPath);
  const metaPath = path.join(dir, id, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.text = newText;
  meta.editedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

module.exports = {
  listNotes,
  createNote,
  updateNoteText,
  notesRootDir,
  noteDir,
  SyncFolderError,
  APP_SUBFOLDER,
};
