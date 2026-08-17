// Loads an image file from disk as a base64 buffer + MIME type, converting
// HEIC/HEIF (common for iPhone photos) to JPEG first since Gemini's vision
// API does not accept HEIC directly.
const fs = require('fs');
const path = require('path');
const heicConvert = require('heic-convert');

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];

function isSupportedImage(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

async function loadImageForTranscription(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Please choose a JPG, PNG, or HEIC photo.`);
  }

  const rawBuffer = fs.readFileSync(filePath);

  if (ext === '.heic' || ext === '.heif') {
    const jpegArrayBuffer = await heicConvert({
      buffer: rawBuffer,
      format: 'JPEG',
      quality: 0.92,
    });
    return {
      buffer: Buffer.from(jpegArrayBuffer),
      mimeType: 'image/jpeg',
      storedExtension: '.jpg',
    };
  }

  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return {
    buffer: rawBuffer,
    mimeType,
    storedExtension: ext === '.png' ? '.png' : '.jpg',
  };
}

module.exports = { isSupportedImage, loadImageForTranscription, SUPPORTED_EXTENSIONS };
