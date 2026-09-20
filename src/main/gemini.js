// Calls the Gemini API directly from the client (no hosted backend) using the
// user's own free-tier API key, asking it to transcribe handwritten Hebrew
// cursive (כתב יד עברי) into standard block print (כתב מרובע).

// If a newer/renamed Gemini vision model becomes free-tier default in the
// future, update MODEL_NAME here. (gemini-2.5-flash was Google's default when
// this app was first built, but is no longer available to newly-created API
// keys as of mid/late 2026 — Google's error message points new keys to
// gemini-3.x instead.)
//
// Tried gemini-3.1-pro-preview for better accuracy on dense handwriting, but
// despite Google's pricing page listing it as "free tier available", this
// key's actual free quota for it is 0 requests/day (confirmed via a live
// 429 error naming `limit: 0, model: gemini-3.1-pro`) — i.e. not usable on
// the free tier at all for this account, not just rate-limited.
//
// Also tried gemini-3.7-flash ("most capable Flash" per Google) as a
// middle ground — it did have a real free quota (unlike Pro), but the user
// judged its actual transcriptions on their handwriting as worse than
// gemini-3.6-flash's in side-by-side testing. Benchmarks don't always
// predict a specific handwriting style, so going with the user's own
// judgment here over Google's "most capable" label.
const MODEL_NAME = 'gemini-3.6-flash';

// Line-by-line transcription needs many requests per note (one per line),
// and gemini-3.6-flash's free-tier limit for this account turned out to be
// only ~5 requests/minute — confirmed live, made a full page take 5-7+
// minutes even paced correctly. A live probe of other models on the same
// key found gemini-3.5-flash-lite handled 8 rapid requests with zero rate
// limiting. Using it only for the per-line path; the whole-page fallback
// (rare, single request) stays on the already-vetted gemini-3.6-flash.
const MODEL_NAME_LINE = 'gemini-3.5-flash-lite';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SHARED_GUIDANCE = `This is typically Torah/Talmud/halacha study shorthand: dense, cramped, abbreviation-heavy, and often mixes Hebrew with occasional English words or phrases the note-taker jotted down themselves (e.g. a quick English gloss or translation of a term).

Instructions:
- Transcribe the Hebrew handwriting into standard printed block Hebrew letters (כתב מרובע), NOT cursive.
- Preserve each word in the language it was actually written in. If the note-taker wrote a word or phrase in English, transcribe it in English exactly as written — do not translate it into Hebrew, and do not translate Hebrew into English either. Just transcribe faithfully in whatever language/script is on the page.
- Expect standard rabbinic/Talmudic abbreviations (e.g. מ"ד, ד"ה, כ"ד, רש"י, and similar). Expand or resolve them only if you are confident; otherwise transcribe the abbreviation as written.
- Look very closely at letter shapes before guessing — this is dense, cramped shorthand and it's easy to mistake similar-looking Hebrew letters (e.g. ד/ר, ב/כ, ו/ן/ז, ח/ה/ת, ם/ס) for each other. Use surrounding context (this is Talmudic/halachic terminology) to sanity-check each word.
- If a word or letter is genuinely ambiguous or illegible, make your single best guess and wrap ONLY that word in square brackets, e.g. [ambiguous word], rather than silently guessing with full confidence. Don't overuse brackets on words you can actually read with reasonable confidence from context.
- Do not add commentary, headers, translations, or explanations of your own. Output only the transcribed text, in the mix of languages/scripts actually written on the page.`;

const TRANSCRIPTION_PROMPT_SINGLE = `You are transcribing a photo of handwritten personal study notes, written in fast, informal Hebrew cursive script (כתב יד עברי). ${SHARED_GUIDANCE}

Preserve the original line breaks and paragraph/bullet structure as closely as reasonably possible.`;

// Used only as a fallback when line-segmentation doesn't find a confident
// split (see lineSegmenter.js) -- kept for that whole-page case.
const TRANSCRIPTION_PROMPT_LINE = `You are transcribing ONE SINGLE LINE cropped from a page of handwritten personal study notes, written in fast, informal Hebrew cursive script (כתב יד עברי). ${SHARED_GUIDANCE}

This is a single line, not a full page — output exactly one line of transcribed text, with no line breaks of your own.`;

class GeminiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind; // 'network' | 'auth' | 'quota' | 'other'
  }
}

async function generateContent(apiKey, model, promptText, images) {
  if (!apiKey) {
    throw new GeminiError('No Gemini API key is configured yet.', 'auth');
  }
  if (!images || images.length === 0) {
    throw new GeminiError('No image to transcribe.', 'other');
  }

  const url = `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        parts: [
          { text: promptText },
          ...images.map((img) => ({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data,
            },
          })),
        ],
      },
    ],
    // temperature: 0 makes the model give its single most-likely reading
    // instead of sampling creatively — without this, the exact same photo
    // could come back with a noticeably different transcription each time.
    generationConfig: {
      temperature: 0,
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiError(
      `Could not reach the Gemini API — check your internet connection. (${err.message})`,
      'network'
    );
  }

  if (!response.ok) {
    let details = '';
    try {
      const errJson = await response.json();
      details = errJson?.error?.message || '';
    } catch {
      // ignore body parse failure
    }

    if (response.status === 401 || response.status === 403) {
      throw new GeminiError(
        `Gemini rejected the API key (${response.status}). ${details || 'Double-check the key in Settings.'}`,
        'auth'
      );
    }
    if (response.status === 429) {
      throw new GeminiError(
        `Gemini rate-limited this request (429). ${details}`,
        'quota'
      );
    }
    if (response.status >= 500) {
      // Transient server-side overload ("high demand") -- worth retrying,
      // same as a rate limit, not a real failure on our end.
      throw new GeminiError(
        `Gemini is temporarily unavailable (${response.status}). ${details}`,
        'unavailable'
      );
    }
    throw new GeminiError(`Gemini API error (${response.status}): ${details || response.statusText}`, 'other');
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();

  if (!text) {
    const finishReason = json?.candidates?.[0]?.finishReason;
    throw new GeminiError(
      `Gemini returned no transcribed text${finishReason ? ` (finishReason: ${finishReason})` : ''}. Try a clearer photo.`,
      'other'
    );
  }

  return text;
}

// Whole-page transcription — used when line-segmentation isn't confident
// enough to trust (see lineSegmenter.js). images: array of { mimeType, data }.
async function transcribeHandwriting({ apiKey, images }) {
  return generateContent(apiKey, MODEL_NAME, TRANSCRIPTION_PROMPT_SINGLE, images);
}

// Single cropped line — the normal path. A real Hebrew-handwriting-OCR
// benchmark (github.com/itayinbarr/heb-ocr) shows a Gemini flash model
// reading one cropped line at a time is meaningfully more accurate than
// reading a whole page in one shot, which is why notes are segmented into
// lines first.
async function transcribeLine({ apiKey, image }) {
  return generateContent(apiKey, MODEL_NAME_LINE, TRANSCRIPTION_PROMPT_LINE, [image]);
}

module.exports = { transcribeHandwriting, transcribeLine, GeminiError, MODEL_NAME, MODEL_NAME_LINE };
