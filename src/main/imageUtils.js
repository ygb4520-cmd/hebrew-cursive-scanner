// Loads an image file from disk as a base64 buffer + MIME type, converting
// HEIC/HEIF (common for iPhone photos) to JPEG first since Gemini's vision
// API does not accept HEIC directly. Also prepares a Gemini-optimized
// version: contrast/sharpness cleanup on the single full photo.
//
// (Previously also split the page into two overlapping halves to give dense
// handwriting more effective detail per line, but that doubled the image
// tokens sent per note — eating into the free daily quota faster — and did
// not clearly improve accuracy in testing, so it was reverted. If accuracy
// on dense pages is still a problem later, revisit splitting, but only as a
// deliberate opt-in, not the default.)
const fs = require('fs');
const path = require('path');
const heicConvert = require('heic-convert');
const sharp = require('sharp');

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

// Takes the already-loaded (HEIC-converted-if-needed) photo and produces a
// single cleaned-up version to send to Gemini. The original, unmodified
// buffer is what gets saved as the note's photo — this is only for the API
// call itself. Returns an array (of length 1) to keep gemini.js's interface
// stable in case multi-image support is reintroduced later.
async function prepareImagesForGemini(buffer) {
  let working = sharp(buffer).rotate(); // auto-orient using EXIF

  // Trim empty margins around the written content (blank paper/background
  // at the edges) so more of the image's detail budget covers actual
  // handwriting, rather than photographing at a distance with lots of
  // border. Doesn't cost extra quota (still one image) unlike the earlier
  // two-image split attempt. Falls back to the untrimmed photo if trim()
  // can't find a clear background to cut (e.g. a very tightly-framed photo
  // with no margin at all).
  try {
    const trimmedBuffer = await working.trim({ threshold: 15 }).toBuffer();
    working = sharp(trimmedBuffer);
  } catch {
    // no clear border to trim — keep the untrimmed image
  }

  const cleaned = await working
    .normalize() // stretch contrast so faint pencil/light-ink strokes stand out
    .sharpen()
    .jpeg({ quality: 95 })
    .toBuffer();
  return [{ mimeType: 'image/jpeg', data: cleaned.toString('base64') }];
}

module.exports = {
  isSupportedImage,
  loadImageForTranscription,
  prepareImagesForGemini,
  SUPPORTED_EXTENSIONS,
};
