// Groups a line's raw ink pieces ("atoms", left-to-right, image fractions)
// into exactly one box per transcribed word. Loaded as a plain <script> in
// the renderer and as a CommonJS module by tests.
(function (root) {
  const POSITION_WEIGHT = 8; // how strongly a cut is pulled toward where word lengths say it belongs
  const GAP_WEIGHT = 1.5; // how strongly a cut is pulled toward a wide blank gap
  const EDGE_MARGIN = 0.03; // fraction of image width counted as "at the edge"
  const EDGE_JUNK_MAX_WIDTH = 0.012; // an edge atom narrower than this is border junk

  // wordLengths: character count of each word, in reading order (index 0 =
  // rightmost word). Returns one { x0, x1, y0, y1 } per word in that same
  // order, or null if there's nothing usable to work with.
  function layoutWords(atoms, wordLengths, wordPadding = 0) {
    const n = wordLengths.length;
    if (!atoms || atoms.length === 0 || n === 0) return null;

    // A thin sliver hugging the image edge is the page border or a scanner
    // shadow, not a word -- left in, it counts as a word and shifts every
    // real word one slot over.
    const usable = atoms.filter(
      (at) => !(at.right - at.left < EDGE_JUNK_MAX_WIDTH && (at.left < EDGE_MARGIN || at.right > 1 - EDGE_MARGIN))
    );
    if (usable.length === 0) return null;

    // Work right-to-left so index 0 is the first word.
    const a = usable.slice().reverse();
    const m = a.length;
    const xMax = a[0].right;
    const xMin = a[m - 1].left;
    const span = Math.max(xMax - xMin, 1e-6);
    const totalChars = wordLengths.reduce((s, c) => s + Math.max(c, 1), 0);

    // groups[i] = [firstAtom, lastAtom] (inclusive) for word i
    let groups;
    if (n === 1) {
      groups = [[0, m - 1]];
    } else if (m >= n) {
      groups = chooseCuts(a, wordLengths, span, xMax, totalChars);
    } else {
      groups = null;
    }

    const boxes = [];
    if (groups) {
      for (const [first, last] of groups) {
        boxes.push(boxFromAtoms(a, first, last, wordPadding));
      }
      return boxes;
    }

    // Fewer ink pieces than words: split the ink span by character length.
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.max(wordLengths[i], 1);
      const x1 = xMax - (cum / totalChars) * span;
      cum += c;
      const x0 = xMax - (cum / totalChars) * span;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const at of a) {
        if (at.right >= x0 && at.left <= x1) {
          y0 = Math.min(y0, at.top);
          y1 = Math.max(y1, at.bottom);
        }
      }
      if (y0 === Infinity) {
        y0 = Math.min(...a.map((at) => at.top));
        y1 = Math.max(...a.map((at) => at.bottom));
      }
      boxes.push({ x0, x1, y0, y1 });
    }
    return boxes;
  }

  function boxFromAtoms(a, first, last, pad) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = first; k <= last; k++) {
      y0 = Math.min(y0, a[k].top);
      y1 = Math.max(y1, a[k].bottom);
    }
    return {
      x0: Math.max(0, a[last].left - pad),
      x1: Math.min(1, a[first].right + pad),
      y0,
      y1,
    };
  }

  // Picks n-1 of the m-1 gaps between atoms as word boundaries (dynamic
  // programming over increasing cut positions), balancing "near where the
  // word lengths say this boundary should be" against "is a wide gap".
  function chooseCuts(a, wordLengths, span, xMax, totalChars) {
    const n = wordLengths.length;
    const m = a.length;
    // gap g sits between atom g and atom g+1 (right-to-left indexing)
    const gapWidth = new Array(m - 1);
    const gapPos = new Array(m - 1);
    let maxGap = 1e-6;
    for (let g = 0; g < m - 1; g++) {
      gapWidth[g] = Math.max(a[g].left - a[g + 1].right, 0);
      gapPos[g] = (a[g].left + a[g + 1].right) / 2;
      maxGap = Math.max(maxGap, gapWidth[g]);
    }
    // expected position of boundary after word i
    const expected = [];
    let cum = 0;
    for (let i = 0; i < n - 1; i++) {
      cum += Math.max(wordLengths[i], 1);
      expected.push(xMax - (cum / totalChars) * span);
    }
    const cutCost = (i, g) => {
      const d = (gapPos[g] - expected[i]) / span;
      return POSITION_WEIGHT * d * d - GAP_WEIGHT * (gapWidth[g] / maxGap);
    };

    // best[i][g] = min cost placing cuts 0..i with cut i at gap g
    const cuts = n - 1;
    const best = [];
    const from = [];
    for (let i = 0; i < cuts; i++) {
      best.push(new Array(m - 1).fill(Infinity));
      from.push(new Array(m - 1).fill(-1));
    }
    for (let g = 0; g < m - 1; g++) {
      // leave room for the remaining cuts after this one
      if (m - 2 - g >= cuts - 1) best[0][g] = cutCost(0, g);
    }
    for (let i = 1; i < cuts; i++) {
      let runMin = Infinity;
      let runArg = -1;
      for (let g = i; g < m - 1; g++) {
        const prev = best[i - 1][g - 1];
        if (prev < runMin) { runMin = prev; runArg = g - 1; }
        if (m - 2 - g >= cuts - 1 - i && runMin < Infinity) {
          best[i][g] = runMin + cutCost(i, g);
          from[i][g] = runArg;
        }
      }
    }
    let endG = -1;
    let endCost = Infinity;
    for (let g = 0; g < m - 1; g++) {
      if (best[cuts - 1][g] < endCost) { endCost = best[cuts - 1][g]; endG = g; }
    }
    if (endG === -1) return null;
    const cutGaps = new Array(cuts);
    let g = endG;
    for (let i = cuts - 1; i >= 0; i--) {
      cutGaps[i] = g;
      g = from[i][g];
    }
    const groups = [];
    let first = 0;
    for (let i = 0; i < cuts; i++) {
      groups.push([first, cutGaps[i]]);
      first = cutGaps[i] + 1;
    }
    groups.push([first, m - 1]);
    return groups;
  }

  const api = { layoutWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WordLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
