// Splits a photographed page into individual line-crop images before
// sending anything to Gemini.
//
// Why: a real Hebrew-handwriting-OCR benchmark (github.com/itayinbarr/heb-ocr,
// checked 2026-09-20) shows Gemini Flash reading a single cropped line is the
// *best* of every model tested (0.119 median CER, better than a dedicated
// 30M-param Hebrew HTR model's 0.175) — but reading a whole photographed page
// at once, the same model falls to 0.764 CER, worse than that dedicated
// model's page-mode 0.331. The bottleneck isn't letter-shape recognition,
// it's whole-page reading order/density. So: do the segmentation ourselves,
// and let Gemini do what it's actually good at — one line at a time.
//
// Approach: classic horizontal ink-density projection. For each row of the
// (grayscale) image, measure how much darker than "blank paper" it is; rows
// with real ink form contiguous bands, which become the line crops. No
// external OCR/CV library — plain pixel math over a raw buffer, which is
// fast enough (a few hundred ms) even at full photo resolution.
//
// Known limitation: assumes a reasonably level photo (not badly skewed) --
// this doesn't attempt deskewing. Photo-taking tips already given elsewhere
// in this project (shoot straight overhead) directly help this step too.
const sharp = require('sharp');

// All of these are fractions of the image height, not fixed pixel counts,
// so this scales across different photo resolutions.
const MIN_LINE_HEIGHT_FRACTION = 0.006; // ignore ink bands shorter than this (noise/specks)
const MAX_GAP_TO_BRIDGE_FRACTION = 0.004; // bridge small gaps within one line (e.g. below a dot)
const MIN_GAP_BETWEEN_LINES_FRACTION = 0.006; // merge bands closer than this (likely one line)
const PADDING_FRACTION = 0.01; // expand each final band for ascenders/descenders
const INK_DELTA = 12; // a row counts as "ink" if its avg brightness is at least this much
// darker than the blankest rows measured on this specific photo (adaptive,
// not a fixed absolute threshold, since lighting/exposure varies per photo).

async function computeRowInkScores(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rowScores = new Float64Array(height); // average brightness per row, 0=black 255=white

  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      sum += data[rowStart + x];
    }
    rowScores[y] = sum / width;
  }
  return { rowScores, width, height };
}

function smooth(scores, windowSize) {
    const half = Math.floor(windowSize / 2);
    const out = new Float64Array(scores.length);
    for (let i = 0; i < scores.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(scores.length - 1, i + half); j++) {
            sum += scores[j];
            count++;
        }
        out[i] = sum / count;
    }
    return out;
}

function findLineBands(rowScores, height) {
  const smoothed = smooth(rowScores, 5);

  // "Blank paper" baseline: the brightest (least inky) rows on this photo.
  const sorted = Array.from(smoothed).sort((a, b) => b - a);
  const paperBaseline = sorted[Math.floor(sorted.length * 0.05)]; // 95th-percentile brightness

  const hasInk = new Array(height);
  for (let y = 0; y < height; y++) {
    hasInk[y] = paperBaseline - smoothed[y] >= INK_DELTA;
  }

  const maxGap = Math.max(3, Math.round(height * MAX_GAP_TO_BRIDGE_FRACTION));
  const minLineHeight = Math.max(6, Math.round(height * MIN_LINE_HEIGHT_FRACTION));
  const minGapBetweenLines = Math.max(4, Math.round(height * MIN_GAP_BETWEEN_LINES_FRACTION));
  const padding = Math.max(4, Math.round(height * PADDING_FRACTION));

  // Pass 1: raw contiguous ink bands, bridging small internal gaps.
  let bands = [];
  let bandStart = null;
  let gapRun = 0;
  for (let y = 0; y < height; y++) {
    if (hasInk[y]) {
      if (bandStart === null) bandStart = y;
      gapRun = 0;
    } else if (bandStart !== null) {
      gapRun++;
      if (gapRun > maxGap) {
        bands.push([bandStart, y - gapRun]);
        bandStart = null;
        gapRun = 0;
      }
    }
  }
  if (bandStart !== null) bands.push([bandStart, height - 1 - gapRun]);

  // Pass 2: drop noise-sized bands.
  bands = bands.filter(([start, end]) => end - start + 1 >= minLineHeight);

  // Pass 3: merge bands that ended up suspiciously close together.
  const merged = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band[0] - last[1] <= minGapBetweenLines) {
      last[1] = band[1];
    } else {
      merged.push([...band]);
    }
  }

  // Pass 4: pad for ascenders/descenders, clamped to image bounds.
  return merged.map(([start, end]) => [
    Math.max(0, start - padding),
    Math.min(height - 1, end + padding),
  ]);
}

async function cleanUpCrop(sharpImage) {
  const buf = await sharpImage.normalize().sharpen().jpeg({ quality: 95 }).toBuffer();
  return { mimeType: 'image/jpeg', data: buf.toString('base64') };
}

// Returns an array of { mimeType, data } line crops, top-to-bottom, or null
// if segmentation didn't find anything confident enough to trust (caller
// should fall back to sending the whole page as one image in that case).
async function segmentIntoLines(buffer) {
  const { rowScores, width, height } = await computeRowInkScores(buffer);
  const bands = findLineBands(rowScores, height);

  // Too few bands to be a real segmentation (e.g. a nearly-blank photo, or
  // one where our ink threshold didn't find real text) -- let the caller
  // fall back rather than send one giant "line" that's really the whole page.
  if (bands.length < 2) return null;

  const rotated = sharp(buffer).rotate();
  const crops = [];
  for (const [top, bottom] of bands) {
    const cropHeight = bottom - top + 1;
    const crop = await cleanUpCrop(
      rotated.clone().extract({ left: 0, top, width, height: cropHeight })
    );
    crops.push(crop);
  }
  return crops;
}

module.exports = { segmentIntoLines, findLineBands, computeRowInkScores };
