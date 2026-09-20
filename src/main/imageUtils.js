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
const exifr = require('exifr');

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.pdf'];

function isSupportedImage(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

// Renders a PDF's first page to a PNG buffer, so it can flow through the
// exact same rotate/crop/segment/transcribe pipeline as a regular photo.
// Only the first page is used for now -- multi-page scan support would need
// its own per-page review flow, out of scope for this first pass. pdfjs-dist
// is ESM-only, hence the dynamic import from this CommonJS file.
async function renderPdfFirstPageToPng(pdfBuffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    standardFontDataUrl: path.join(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/'
    ),
  }).promise;

  const page = await doc.getPage(1);
  // Scale so the longer edge lands around 3000px -- comparable to a real
  // phone/tablet photo's resolution, plenty for OCR on a text page.
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = 3000 / Math.max(baseViewport.width, baseViewport.height);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toBuffer('image/png');
}

// Loads a photo, corrects orientation, and bakes in any manual rotation the
// user chose in the import preview (see the renderer's rotate buttons) —
// all physically applied once here, so every downstream step (line
// segmentation, Gemini prep) can just use the returned buffer as-is.
//
// manualRotationDegrees: 0/90/180/270, on top of whatever EXIF correction
// applies. Needed because some real photos (confirmed with an iPad photo)
// carry NO EXIF orientation tag at all -- not a bug in EXIF handling, there
// is simply nothing to read, so auto-correction can't help and the user has
// to specify it themselves.
//
// cropBox: optional { left, top, right, bottom } as fractions (0-1) of the
// ALREADY-ROTATED image, matching what the import preview shows -- applied
// after rotation so coordinates line up with what the user saw/adjusted.
async function loadImageForTranscription(filePath, manualRotationDegrees = 0, cropBox = null) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Please choose a JPG, PNG, HEIC photo, or PDF.`);
  }

  const rawBuffer = fs.readFileSync(filePath);

  let workingBuffer;
  let mimeType;
  let storedExtension;

  if (ext === '.pdf') {
    // A rendered PDF page has no EXIF orientation concept -- pdfjs already
    // applies the page's own /Rotate attribute when present, and the user's
    // manual rotation (below) covers anything left over.
    workingBuffer = await renderPdfFirstPageToPng(rawBuffer);
    mimeType = 'image/png';
    storedExtension = '.png';
    let buffer = workingBuffer;
    if (((manualRotationDegrees % 360) + 360) % 360 !== 0) {
      buffer = await sharp(buffer).rotate(manualRotationDegrees).toBuffer();
    }
    if (cropBox) {
      buffer = await applyCrop(buffer, cropBox);
    }
    return { buffer, mimeType, storedExtension };
  }

  let orientation;
  try {
    orientation = await exifr.orientation(rawBuffer);
  } catch {
    orientation = undefined; // no EXIF, or unreadable
  }

  if (ext === '.heic' || ext === '.heif') {
    const jpegArrayBuffer = await heicConvert({
      buffer: rawBuffer,
      format: 'JPEG',
      quality: 0.92,
    });
    workingBuffer = Buffer.from(jpegArrayBuffer);
    mimeType = 'image/jpeg';
    storedExtension = '.jpg';
    // heic-convert's output carries no orientation tag of its own -- stamp
    // the one read from the ORIGINAL HEIC bytes so the bake-in step below
    // can apply it correctly.
    if (orientation && orientation !== 1) {
      workingBuffer = await sharp(workingBuffer).withMetadata({ orientation }).toBuffer();
    }
  } else {
    workingBuffer = rawBuffer;
    mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    storedExtension = ext === '.png' ? '.png' : '.jpg';
  }

  // Bake in EXIF auto-orientation now, once (a no-op if there's no tag).
  let buffer = await sharp(workingBuffer).rotate().toBuffer();

  // Then bake in the user's manual rotation choice on top, if any.
  if (((manualRotationDegrees % 360) + 360) % 360 !== 0) {
    buffer = await sharp(buffer).rotate(manualRotationDegrees).toBuffer();
  }

  if (cropBox) {
    buffer = await applyCrop(buffer, cropBox);
  }

  return { buffer, mimeType, storedExtension };
}

// Crops to a { left, top, right, bottom } box given as fractions (0-1) of
// the buffer's current dimensions. Clamped defensively so a slightly
// out-of-range box (e.g. from rounding) never throws.
async function applyCrop(buffer, cropBox) {
  const { width, height } = await sharp(buffer).metadata();
  const left = Math.max(0, Math.min(width - 1, Math.round(cropBox.left * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(cropBox.top * height)));
  const right = Math.max(left + 1, Math.min(width, Math.round(cropBox.right * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(cropBox.bottom * height)));
  return sharp(buffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .toBuffer();
}

// Best-effort auto-detection of where the photographed PAGE is within the
// full photo, as opposed to background (table, couch, etc.) -- distinct
// from prepareImagesForGemini's trim(), which only removes a uniform blank
// border and does nothing when the surrounding background is a textured,
// non-white surface (confirmed with a real photo: the page took up well
// under half the frame against a dark couch, and trim() found nothing to
// cut). Paper -- even in shadow -- reads as much brighter than most real
// backgrounds, so this looks for the bounding box of "mostly bright" rows
// and columns rather than trying to find exact page edges.
//
// Returns { left, top, right, bottom } as fractions (0-1), or null if no
// confident boundary was found (e.g. the page already fills the frame, or
// the background happens to be paper-bright too) -- callers should treat
// null as "suggest no crop."
async function detectPageBoundingBox(buffer) {
  const PAPER_BRIGHTNESS = 130; // a row/column pixel counts as "paper-like" above this
  const MIN_COVERAGE = 0.35; // a row/column counts as "part of the page" above this fraction bright
  const PADDING_FRACTION = 0.015;

  const { data, info } = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const rowCoverage = new Float64Array(height);
  const colBrightCount = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    let bright = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x] >= PAPER_BRIGHTNESS) {
        bright++;
        colBrightCount[x]++;
      }
    }
    rowCoverage[y] = bright / width;
  }

  let top = 0;
  while (top < height && rowCoverage[top] < MIN_COVERAGE) top++;
  let bottom = height - 1;
  while (bottom > top && rowCoverage[bottom] < MIN_COVERAGE) bottom--;

  let left = 0;
  while (left < width && colBrightCount[left] / height < MIN_COVERAGE) left++;
  let right = width - 1;
  while (right > left && colBrightCount[right] / height < MIN_COVERAGE) right--;

  // Degenerate: nothing confidently page-like, or it's already ~the whole frame.
  const coversNearlyEverything =
    top < height * 0.01 && bottom > height * 0.99 && left < width * 0.01 && right > width * 0.99;
  if (bottom - top < height * 0.1 || right - left < width * 0.1 || coversNearlyEverything) {
    return null;
  }

  const padX = width * PADDING_FRACTION;
  const padY = height * PADDING_FRACTION;
  return {
    left: Math.max(0, (left - padX) / width),
    top: Math.max(0, (top - padY) / height),
    right: Math.min(1, (right + padX) / width),
    bottom: Math.min(1, (bottom + padY) / height),
  };
}

// Takes the already-loaded (oriented, HEIC-converted-if-needed) photo and
// produces a single cleaned-up version to send to Gemini. The original
// buffer (pre-cleanup, but already correctly oriented) is what gets saved
// as the note's photo. Returns an array (of length 1) to keep gemini.js's
// interface stable in case multi-image support is reintroduced later.
async function prepareImagesForGemini(buffer) {
  let working = sharp(buffer);

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

// Small rotated preview for the import screen's rotate/crop controls --
// reuses the same orientation logic as the real transcription path (EXIF +
// manual rotation), resized down for a fast, cheap round trip on every
// rotate click, plus a suggested crop box computed on the same (rotated)
// image so its fractions line up with what's displayed.
async function generatePreviewDataUrl(filePath, rotationDegrees) {
  const { buffer } = await loadImageForTranscription(filePath, rotationDegrees);
  const [previewBuffer, suggestedCrop] = await Promise.all([
    sharp(buffer).resize({ width: 700, height: 700, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
    detectPageBoundingBox(buffer),
  ]);
  return {
    dataUrl: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`,
    suggestedCrop,
  };
}

module.exports = {
  isSupportedImage,
  loadImageForTranscription,
  prepareImagesForGemini,
  generatePreviewDataUrl,
  detectPageBoundingBox,
  SUPPORTED_EXTENSIONS,
};
