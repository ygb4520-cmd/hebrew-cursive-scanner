# Few-shot examples

Drop your own hand-corrected line examples here to bias Gemini toward your
actual handwriting/abbreviations/vocabulary, instead of its generic guesses.
No code changes needed — the app picks these up automatically the next time
it runs, and behaves exactly as before if this folder is empty.

## Format

Each example is **two files sharing the same name**: an image of one cropped
line, and a `.txt` file with the exact correct transcription of that line.

```
01.jpg   01.txt
02.jpg   02.txt
03.png   03.txt
```

- Image: `.jpg`, `.jpeg`, or `.png` — a single cropped line, the same kind of
  crop the app already saves under a note's `photo.*` after segmentation (or
  just a photo of one handwritten line — doesn't need to come from the app).
- Text file: plain UTF-8 text, the single correct line, exactly as it should
  be transcribed (same conventions as the app's own output — block Hebrew
  letters, English left as English, abbreviations kept as written unless
  you're confident expanding them).

An image with no matching `.txt` (or vice versa) is silently skipped — it
won't error, it just won't count as an example yet.

## How many

Up to 5 are used per request (more than that mostly just burns quota/tokens
without much extra benefit for in-context examples). If you add more than 5,
only the first 5 (by filename) are used — name them so the ones you want
included sort first (`01`, `02`, ...) if you end up with a bigger pile.

## Picking good examples

A handful of *representative* lines beats a big pile of similar ones — a
few with your personal abbreviations, a couple with mixed English, one or
two that are otherwise "plain," rather than 20 nearly-identical lines.
