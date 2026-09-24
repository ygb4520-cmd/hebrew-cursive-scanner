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
// Approach (rewritten 2026-09-23 after a real, longstanding under-counting
// bug -- see below): binarize the page with Otsu's method, trim dense
// artifact borders, then project INK PIXEL COUNTS (not average brightness)
// across rows to find lines, and across columns within each line to find
// word-sized chunks. No external OCR/CV library — plain pixel math over a
// raw buffer, fast even at full photo resolution.
//
// The bug this replaced: the original approach averaged raw brightness
// across each full row/column. That's fatally diluted by real handwriting,
// where any given row is mostly blank paper with a few thin ink strokes --
// averaging brightness across ~2000+ mostly-white pixels barely moves the
// mean, so real text rows and true blank gaps ended up looking nearly
// identical. Confirmed live on a genuinely broken page (found only 2 of a
// visually-obvious ~20+ lines): a second, independent problem compounded
// it -- narrow dark strips along the page's own edges (binder/scan-crop
// artifacts, confirmed via real per-column ink measurements: ~67% ink
// density in the leftmost columns vs 1-5% in the real text columns) added
// a near-constant "ink" offset to every single row, so the algorithm could
// never find a genuinely blank gap between lines at all. Counting actual
// ink PIXELS (via a proper binarization threshold) instead of averaging
// brightness, and trimming those artifact borders before counting, fixed
// both: tested against 5 real pages, one page went from 0 confident bands
// (total failure, silently fell back to whole-page) to 11; another from 2
// to 7; a page that already worked went from 15 bands to 13 (a small,
// acceptable regression against a large net fix elsewhere).
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

// A row counts as "text" if at least this fraction of the page's content
// width is made of ink pixels. Small on purpose -- Hebrew handwriting is
// sparse per row, so this only needs to clear genuine noise, not match
// how "full" a printed text line would look.
const ROW_INK_FRACTION = 0.003;
// Same idea per column, but relative to a single line's height instead of
// the whole page (word-splitting only ever looks within one line's rows).
const COL_INK_FRACTION = 0.12;

// Edges (either axis) are trimmed inward while their full-length ink
// density stays above this -- real handwriting never blackens more than a
// small fraction of a full row/column, so anything denser than this for a
// sustained run is a page-edge/binder/scan-crop artifact, not text.
const EDGE_ARTIFACT_DENSITY_FRACTION = 0.12;
const EDGE_SMOOTH_WINDOW = 9; // avoids a single anti-aliased boundary pixel faking an early stop
// Safety limit: never trim more than this fraction of the image from a single edge, no matter
// how long the dense run continues. Confirmed live on a real dark/poorly-lit photo -- without
// this cap, a photo that's densely "inky" almost everywhere (not just at a genuine border
// artifact) walked the trim all the way to a 1x1 remainder and failed completely. A real
// border artifact is always a narrow strip; something denser than that for longer than this
// isn't a border anymore, it's just a hard photo, and trimming further would eat real content
// instead of protecting it.
const MAX_EDGE_TRIM_FRACTION = 0.2;

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

// Otsu's method: picks the brightness cutoff that best splits this
// specific image's own histogram into an "ink" cluster and a "paper"
// cluster, instead of assuming one fixed threshold works across every
// camera, scanner, and lighting condition.
function otsuThreshold(data) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) histogram[data[i]]++;
  const total = data.length;

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];

  let sumBelow = 0;
  let weightBelow = 0;
  let bestVariance = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    weightBelow += histogram[t];
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += t * histogram[t];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sumAll - sumBelow) / weightAbove;
    const betweenVariance = weightBelow * weightAbove * (meanBelow - meanAbove) * (meanBelow - meanAbove);
    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance;
      threshold = t;
    }
  }
  return threshold;
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

// Walks inward from both ends of `counts` (one entry per row or column)
// while its smoothed ink density stays above a "no real handwriting is
// this dense" ceiling, and returns the [lo, hi] range of what's left --
// the actual content area, with edge artifacts (binder holes, scan-crop
// shadow, page border) excluded. Smoothing first matters: the very
// boundary pixel of a scan is often anti-aliased lighter than the solid
// artifact just inside it, which would otherwise fake an early stop.
function trimDenseEdges(counts, densityDenominator, maxFraction, smoothWindow) {
  const smoothed = smooth(counts, smoothWindow);
  const cap = densityDenominator * maxFraction;
  const maxTrimEach = Math.floor(smoothed.length * MAX_EDGE_TRIM_FRACTION);

  let lo = 0;
  while (lo < maxTrimEach && smoothed[lo] > cap) lo++;

  let hi = smoothed.length - 1;
  const minHi = Math.max(lo, smoothed.length - 1 - maxTrimEach);
  while (hi > minHi && smoothed[hi] > cap) hi--;

  return [lo, hi];
}

function computeRowInkCounts(data, width, height, threshold, colStart, colEnd) {
  const counts = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const rowStart = y * width;
    for (let x = colStart; x <= colEnd; x++) {
      if (data[rowStart + x] < threshold) count++;
    }
    counts[y] = count;
  }
  return counts;
}

function computeColumnInkCounts(data, width, threshold, rowTop, rowBottom, colStart, colEnd) {
  const counts = new Float64Array(width);
  for (let x = colStart; x <= colEnd; x++) {
    let count = 0;
    for (let y = rowTop; y <= rowBottom; y++) {
      if (data[y * width + x] < threshold) count++;
    }
    counts[x] = count;
  }
  return counts;
}

// Returns { bands, rawBands }. `bands` are the final, padded line boxes
// (used for the crop + display). `rawBands` are the same bands *before*
// padding (used for word-splitting, so a neighboring line's
// descender/ascender ink pulled in by padding doesn't skew the column
// ink-count math).
function findLineBands(rowInkCounts, height, contentWidth) {
  const smoothed = smooth(rowInkCounts, 5);
  const minInkPixels = Math.max(2, contentWidth * ROW_INK_FRACTION);

  const hasInk = new Array(height);
  for (let y = 0; y < height; y++) {
    hasInk[y] = smoothed[y] >= minInkPixels;
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

  // Padding each band independently can make neighbors overlap when they
  // were close together to begin with -- confirmed live (two real lines a
  // couple pixels apart in `merged` ended up with overlapping padded
  // ranges), which would hand two different line numbers overlapping
  // regions of the same photo to every downstream consumer (the app's own
  // word-highlight feature included). Split any resulting overlap at the
  // midpoint of the original, unpadded gap.
  for (let i = 0; i < padded.length - 1; i++) {
    if (padded[i][1] >= padded[i + 1][0]) {
      const mid = Math.floor((merged[i][1] + merged[i + 1][0]) / 2);
      padded[i][1] = mid;
      padded[i + 1][0] = mid + 1;
    }
  }

  return { bands: padded, rawBands: merged };
}

// Splits one line's column-ink-count profile into word-sized pixel
// ranges, returned LEFT-TO-RIGHT as [left, right] pixel pairs. See the
// file header for the letter-gap-vs-word-gap heuristic.
function findWordBands(colInkCounts, width, lineHeight) {
  const smoothed = smooth(colInkCounts, 3);
  const minInkPixels = Math.max(1, lineHeight * COL_INK_FRACTION);
  const hasInk = new Array(width);
  for (let x = 0; x < width; x++) {
    hasInk[x] = smoothed[x] >= minInkPixels;
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
  const threshold = otsuThreshold(data);

  // Find the real content area first, so page-edge artifacts (binder
  // holes, scan-crop shadow, a strip of background at the border) never
  // get counted as ink -- see the file header for why this matters.
  const colCountsFullHeight = computeColumnInkCounts(data, width, threshold, 0, height - 1, 0, width - 1);
  const rowCountsFullWidth = computeRowInkCounts(data, width, height, threshold, 0, width - 1);
  const [contentLeft, contentRight] = trimDenseEdges(
    colCountsFullHeight,
    height,
    EDGE_ARTIFACT_DENSITY_FRACTION,
    EDGE_SMOOTH_WINDOW
  );
  const [contentTop, contentBottom] = trimDenseEdges(
    rowCountsFullWidth,
    width,
    EDGE_ARTIFACT_DENSITY_FRACTION,
    EDGE_SMOOTH_WINDOW
  );
  const contentWidth = contentRight - contentLeft + 1;

  const rowInkCounts = computeRowInkCounts(data, width, height, threshold, contentLeft, contentRight);
  // Zero out rows outside the trimmed vertical content range so a
  // top/bottom artifact can't seed a spurious band there.
  for (let y = 0; y < height; y++) {
    if (y < contentTop || y > contentBottom) rowInkCounts[y] = 0;
  }

  const { bands, rawBands } = findLineBands(rowInkCounts, height, contentWidth);
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

    const colInkCounts = computeColumnInkCounts(data, width, threshold, rawTop, rawBottom, contentLeft, contentRight);
    const wordPadding = Math.max(1, Math.round(width * WORD_PADDING_FRACTION));
    const wordBandsLtr = findWordBands(colInkCounts, width, rawBottom - rawTop + 1);
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

module.exports = { segmentIntoLines, findLineBands, findWordBands, otsuThreshold, trimDenseEdges };
