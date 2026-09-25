// Stores the user's own Gemini API key locally and encrypted via Electron's
// safeStorage (backed by Keychain on macOS, DPAPI on Windows). The key is
// never bundled with the app and never leaves the machine except in direct
// calls to Google's Gemini API.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function keyFilePath(filename) {
  return path.join(app.getPath('userData'), filename);
}

function hasKey(filename) {
  return fs.existsSync(keyFilePath(filename));
}

function setKey(filename, plainTextKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This OS has no secure credential store available, so the API key cannot be stored safely.'
    );
  }
  const encrypted = safeStorage.encryptString(plainTextKey);
  fs.mkdirSync(path.dirname(keyFilePath(filename)), { recursive: true });
  fs.writeFileSync(keyFilePath(filename), encrypted);
}

function getKey(filename) {
  if (!hasKey(filename)) return null;
  const encrypted = fs.readFileSync(keyFilePath(filename));
  return safeStorage.decryptString(encrypted);
}

function clearKey(filename) {
  try {
    fs.unlinkSync(keyFilePath(filename));
  } catch {
    // already gone
  }
}

const TRANSCRIPTION_KEY_FILE = 'gemini-key.enc';
const SEGMENTATION_KEY_FILE = 'gemini-key-segmentation.enc';

function hasApiKey() {
  return hasKey(TRANSCRIPTION_KEY_FILE);
}

function setApiKey(plainTextKey) {
  setKey(TRANSCRIPTION_KEY_FILE, plainTextKey);
}

function getApiKey() {
  return getKey(TRANSCRIPTION_KEY_FILE);
}

function clearApiKey() {
  clearKey(TRANSCRIPTION_KEY_FILE);
}

function hasSegmentationApiKey() {
  return hasKey(SEGMENTATION_KEY_FILE);
}

function setSegmentationApiKey(plainTextKey) {
  setKey(SEGMENTATION_KEY_FILE, plainTextKey);
}

function getSegmentationApiKey() {
  return getKey(SEGMENTATION_KEY_FILE);
}

function clearSegmentationApiKey() {
  clearKey(SEGMENTATION_KEY_FILE);
}

// A dedicated segmentation key is optional — a separate Google Cloud project
// gets its own API quota, but until one is set up, segmentation calls reuse
// the transcription key so the feature still works.
function resolveSegmentationApiKey() {
  return getSegmentationApiKey() || getApiKey();
}

module.exports = {
  hasApiKey,
  setApiKey,
  getApiKey,
  clearApiKey,
  hasSegmentationApiKey,
  setSegmentationApiKey,
  getSegmentationApiKey,
  clearSegmentationApiKey,
  resolveSegmentationApiKey,
};
