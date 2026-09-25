// Loads user-supplied "here's this handwriting read correctly" examples from
// fewShotExamples/ (see that folder's README) and hands them back ready to
// prepend to a Gemini request as in-context few-shot examples. Returns an
// empty array when no examples exist yet, so this is a safe no-op until real
// examples are added -- the app transcribes exactly as it did before.
const fs = require('fs');
const path = require('path');

const EXAMPLES_DIR = path.join(__dirname, 'fewShotExamples');
const MAX_EXAMPLES = 5;
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

// Cached after the first load -- these files don't change while the app is
// running, and re-reading/re-encoding them on every single line transcribed
// would be wasted work.
let cached = null;

function loadFewShotExamples() {
  if (cached) return cached;
  cached = [];

  if (!fs.existsSync(EXAMPLES_DIR)) return cached;

  const files = fs.readdirSync(EXAMPLES_DIR).sort();
  const imageFiles = files.filter((f) => MIME_BY_EXT[path.extname(f).toLowerCase()]);

  for (const imageFile of imageFiles) {
    if (cached.length >= MAX_EXAMPLES) break;

    const base = path.basename(imageFile, path.extname(imageFile));
    const textPath = path.join(EXAMPLES_DIR, `${base}.txt`);
    if (!fs.existsSync(textPath)) continue; // no matching correction yet -- not a usable example

    const text = fs.readFileSync(textPath, 'utf8').trim();
    if (!text) continue;

    const imageData = fs.readFileSync(path.join(EXAMPLES_DIR, imageFile));
    cached.push({
      mimeType: MIME_BY_EXT[path.extname(imageFile).toLowerCase()],
      data: imageData.toString('base64'),
      text,
    });
  }

  return cached;
}

module.exports = { loadFewShotExamples };
