// Stores the user's own Gemini API key locally and encrypted via Electron's
// safeStorage (backed by Keychain on macOS, DPAPI on Windows). The key is
// never bundled with the app and never leaves the machine except in direct
// calls to Google's Gemini API.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function keyFilePath() {
  return path.join(app.getPath('userData'), 'gemini-key.enc');
}

function hasApiKey() {
  return fs.existsSync(keyFilePath());
}

function setApiKey(plainTextKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This OS has no secure credential store available, so the API key cannot be stored safely.'
    );
  }
  const encrypted = safeStorage.encryptString(plainTextKey);
  fs.mkdirSync(path.dirname(keyFilePath()), { recursive: true });
  fs.writeFileSync(keyFilePath(), encrypted);
}

function getApiKey() {
  if (!hasApiKey()) return null;
  const encrypted = fs.readFileSync(keyFilePath());
  return safeStorage.decryptString(encrypted);
}

function clearApiKey() {
  try {
    fs.unlinkSync(keyFilePath());
  } catch {
    // already gone
  }
}

module.exports = { hasApiKey, setApiKey, getApiKey, clearApiKey };
