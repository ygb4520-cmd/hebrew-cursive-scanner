// Small JSON-file-backed settings store, kept in Electron's per-machine userData
// directory (NOT the synced notes folder — settings are local to each install).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const current = readSettings();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { readSettings, writeSettings };
