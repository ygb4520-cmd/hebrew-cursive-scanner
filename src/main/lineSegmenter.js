// Splits a photographed page into individual line-crop images before
// sending anything to Gemini, and additionally finds word-sized chunks
// within each line (for the hover-to-highlight feature: clicking around in
// the transcribed text shows exactly which ink on the page it came from).
//
// Why line-splitting: a real Hebrew-handwriting-OCR benchmark
// (github.com/itayinbarr/heb-ocr, checked 2026-09-20) shows Gemini Flash
// reading a single cropped line is the *best* of every model tested (0.119
// median CER, better than a dedicated 30M-param Hebrew HTR model's 0.175) —
// but reading a whole photographed page at once, the same model falls to
// 0.764 CER, worse than that dedicated model's page-mode 0.331. The
// bottleneck isn't letter-shape recognition, it's whole-page reading
// order/density. So: do the segmentation ourselves, and let Gemini do what
// it's actually good at — one line at a time.
//
// Approach: classic ink-density projection, done twice. First horizontally
// (row brightness) to find lines, exactly as before. Then, within each
// line's row range, vertically (column brightness) to find word-sized ink
// clusters. No external OCR/CV library — plain pixel math over a raw
// buffer, which is fast enough (a few hundred ms) even at full photo
// resolution.
//
// Known limitation on the word split specifically: Hebrew cursive letters
// are mostly NOT connected to each other within a word (unlike English
// cursive or Arabic), so a naive "any gap = a new word" rule would just
// find individual letters, not words. To compensate, the gap between
// letters *within* a word and the gap *between* words are treated as two
// different populations and split by whichever internal gap is the
// biggest relative jump in size (see findWordBands) rather than a fixed
// pixel threshold — this adapts per line to that line's own handwriting
// density instead of assuming one universal spacing. It's still a
// heuristic, not guaranteed correct, which is why the caller (main.js)
// only trusts word-level boxes when the resulting word count matches the
// number of words Gemini actually transcribed for that line, falling back
// to highlighting the whole line otherwise.
//
// Known limitation on line-splitting: assumes a reasonably level photo
// (not badly skewed) -- this doesn't attempt deskewing.
const sharp = require('sharp');

// All of these are fractions of the image height, not fixed pixel counts,
// so this scales across different photo resolutions.
const MIN_LINE_HEIGHT_FRACTION = 0.006; // ignore ink bands shorter than this (noise/specks)
const MAX_GAP_TO_BRIDGE_FRACTION = 0.004; // bridge small gaps within one line (e.g. below a dot)
const MIN_GAP_BETWEEN_LINES_FRACTION = 0.006; // merge bands closer than this (likely one line)
const PADDING_FRACTION = 0.01; // expand each final line band for ascenders/descenders
const INK_DELTA = 12; // a row/column counts as "ink" if its avg brightness is at least this much
// darker than the blankest rows measured on this specific photo (adaptive,
// not a fixed absolute threshold, since lighting/exposure varies per photo).

// Word-band tuning (fractions of image WIDTH unless noted).
const WORD_PADDING_FRACTION = 0.003; // small box padding around each detected word
const MIN_MEANINGFUL_GAP_PX = 2; // gaps thinner than this are anti-aliasing noise, always merged
const MIN_WORD_GAP_RATIO = 1.6; // the "biggest jump" between consecutive gap sizes must be at
// least this big before we trust it as the letter-gap/word-gap split point; otherwise we assume
// the whole line is one word rather than guessing a boundary that probably isn't real.

async function getGrayscaleRaw(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function computeRowInkScores(data, width, height) {
  const rowScores = new Float64Array(height); // average brightness per row, 0=black 255=white
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      sum += data[rowStart + x];
    }
    rowScores[y] = sum / width;
  }
  return rowScores;
}

function computeColumnInkScores(data, width, rowTop, rowBottom) {
  const colScores = new Float64Array(width);
  const rowCount = rowBottom - rowTop + 1;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = rowTop; y <= rowBottom; y++) {
      sum += data[y * width + x];
    }
    colScores[x] = sum / rowCount;
  }
  return colScores;
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

function percentileBrightness(smoothedScores, percentile) {
  const sorted = Array.from(smoothedScores).sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length * percentile)];
}

// Returns { bands, rawBands, paperBaseline }. `bands` are the final,
// padded line boxes (used for the crop + display). `rawBands` are the
// same bands *before* padding (used for word-splitting, so a neighboring
// line's descender/ascender ink pulled in by padding doesn't skew the
// column brightness math).
function findLineBands(rowScores, height) {
  const smoothed = smooth(rowScores, 5);
  const paperBaseline = percentileBrightness(smoothed, 0.05); // 95th-percentile brightness

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
  const padded = merged.map(([start, end]) => [
    Math.max(0, start - padding),
    Math.min(height - 1, end + padding),
  ]);

  return { bands: padded, rawBands: merged, paperBaseline };
}

// Splits one line's column-brightness profile into word-sized pixel
// ranges, returned LEFT-TO-RIGHT as [left, right] pixel pairs. See the
// file header for the letter-gap-vs-word-gap heuristic.
function findWordBands(colScores, width, paperBaseline) {
  const smoothed = smooth(colScores, 3);
  const hasInk = new Array(width);
  for (let x = 0; x < width; x++) {
    hasInk[x] = paperBaseline - smoothed[x] >= INK_DELTA;
  }

  let inkStart = -1;
  let inkEnd = -1;
  for (let x = 0; x < width; x++) {
    if (hasInk[x]) {
      if (inkStart === -1) inkStart = x;
      inkEnd = x;
    }
  }
  if (inkStart === -1) return [[0, width - 1]]; // shouldn't happen (line was detected via ink)

  // Walk the trimmed ink span, collecting ink runs and the gaps between them.
  const runs = [];
  const gaps = []; // { index into runs boundary, length }
  let runStart = inkStart;
  let gapStart = -1;
  for (let x = inkStart; x <= inkEnd + 1; x++) {
    const ink = x <= inkEnd && hasInk[x];
    if (ink) {
      if (gapStart !== -1) {
        gaps.push({ afterRunIndex: runs.length - 1, length: x - gapStart });
        gapStart = -1;
      }
      if (runStart === -1) runStart = x;
    } else {
      if (runStart !== -1) {
        runs.push([runStart, x - 1]);
        runStart = -1;
      }
      if (gapStart === -1 && x <= inkEnd) gapStart = x;
    }
  }

  if (runs.length <= 1) return [[inkStart, inkEnd]];

  // Gaps too thin to be anything but anti-aliasing noise are never real
  // word boundaries -- always merged, excluded from the ratio analysis.
  const candidateGaps = gaps.filter((g) => g.length >= MIN_MEANINGFUL_GAP_PX);
  const boundaryAfterRun = new Set();

  if (candidateGaps.length > 0) {
    const sortedByLength = [...candidateGaps].sort((a, b) => a.length - b.length);
    let bestRatio = 1;
    let bestSplitLength = null;
    for (let i = 0; i < sortedByLength.length - 1; i++) {
      const a = sortedByLength[i].length;
      const b = sortedByLength[i + 1].length;
      const ratio = b / Math.max(a, 1);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestSplitLength = (a + b) / 2;
      }
    }
    if (bestSplitLength !== null && bestRatio >= MIN_WORD_GAP_RATIO) {
      for (const g of candidateGaps) {
        if (g.length >= bestSplitLength) boundaryAfterRun.add(g.afterRunIndex);
      }
    }
    // If no confident split was found, boundaryAfterRun stays empty --
    // every run merges into a single word band (safer than a wrong guess).
  }

  const bands = [];
  let bandStart = runs[0][0];
  let bandEnd = runs[0][1];
  for (let i = 1; i < runs.length; i++) {
    if (boundaryAfterRun.has(i - 1)) {
      bands.push([bandStart, bandEnd]);
      bandStart = runs[i][0];
      bandEnd = runs[i][1];
    } else {
      bandEnd = runs[i][1];
    }
  }
  bands.push([bandStart, bandEnd]);

  return bands;
}

async function cleanUpCrop(sharpImage) {
  const buf = await sharpImage.normalize().sharpen().jpeg({ quality: 95 }).toBuffer();
  return { mimeType: 'image/jpeg', data: buf.toString('base64') };
}

// Returns { width, height, lines }, where each line is
// { image: {mimeType,data}, top, bottom, wordBoxes }. `top`/`bottom` are
// pixel rows in the (post-rotation) source image; `wordBoxes` is an array
// of { left, right } fractions of the image WIDTH, in reading order
// (rightmost-first, since Hebrew reads right-to-left) — matching the order
// words appear in the transcribed text string. Returns null if
// segmentation didn't find anything confident enough to trust (caller
// should fall back to sending the whole page as one image in that case).
async function segmentIntoLines(buffer) {
  const { data, width, height } = await getGrayscaleRaw(buffer);
  const rowScores = computeRowInkScores(data, width, height);
  const { bands, rawBands, paperBaseline } = findLineBands(rowScores, height);

  if (bands.length < 2) return null;

  const rotated = sharp(buffer).rotate();
  const lines = [];
  for (let i = 0; i < bands.length; i++) {
    const [top, bottom] = bands[i];
    const [rawTop, rawBottom] = rawBands[i];
    const cropHeight = bottom - top + 1;
    const image = await cleanUpCrop(
      rotated.clone().extract({ left: 0, top, width, height: cropHeight })
    );

    const colScores = computeColumnInkScores(data, width, rawTop, rawBottom);
    const wordPadding = Math.max(1, Math.round(width * WORD_PADDING_FRACTION));
    const wordBandsLtr = findWordBands(colScores, width, paperBaseline);
    // Reverse to right-to-left order to match Hebrew reading order (the
    // rightmost visual word is the first word in the transcribed string).
    const wordBoxes = wordBandsLtr
      .slice()
      .reverse()
      .map(([left, right]) => ({
        left: Math.max(0, left - wordPadding) / width,
        right: Math.min(width - 1, right + wordPadding + 1) / width,
      }));

    lines.push({ image, top, bottom, wordBoxes });
  }
  return { width, height, lines };
}

module.exports = { segmentIntoLines, findLineBands, findWordBands, computeRowInkScores };
