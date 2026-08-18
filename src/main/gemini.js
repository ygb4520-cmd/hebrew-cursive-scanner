// Calls the Gemini API directly from the client (no hosted backend) using the
// user's own free-tier API key, asking it to transcribe a photo of messy
// Hebrew cursive handwriting (כתב יד עברי) into standard block print
// (כתב מרובע).

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
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSCRIPTION_PROMPT_SINGLE = `You are transcribing a photo of handwritten personal study notes, written in fast, informal Hebrew cursive script (כתב יד עברי). This is typically Torah/Talmud/halacha study shorthand: dense, cramped, abbreviation-heavy, and often mixes Hebrew with occasional English words or phrases the note-taker jotted down themselves (e.g. a quick English gloss or translation of a term).

Instructions:
- Transcribe the Hebrew handwriting into standard printed block Hebrew letters (כתב מרובע), NOT cursive.
- Preserve the original line breaks and paragraph/bullet structure as closely as reasonably possible.
- Preserve each word in the language it was actually written in. If the note-taker wrote a word or phrase in English, transcribe it in English exactly as written — do not translate it into Hebrew, and do not translate Hebrew into English either. Just transcribe faithfully in whatever language/script is on the page.
- Expect standard rabbinic/Talmudic abbreviations (e.g. מ"ד, ד"ה, כ"ד, רש"י, and similar). Expand or resolve them only if you are confident; otherwise transcribe the abbreviation as written.
- Look very closely at letter shapes before guessing — this is dense, cramped shorthand and it's easy to mistake similar-looking Hebrew letters (e.g. ד/ר, ב/כ, ו/ן/ז, ח/ה/ת, ם/ס) for each other. Use surrounding context (this is Talmudic/halachic terminology) to sanity-check each word.
- If a word or letter is genuinely ambiguous or illegible, make your single best guess and wrap ONLY that word in square brackets, e.g. [ambiguous word], rather than silently guessing with full confidence. Don't overuse brackets on words you can actually read with reasonable confidence from context.
- Do not add commentary, headers, translations, or explanations of your own. Output only the transcribed text, in the mix of languages/scripts actually written on the page.`;

const TRANSCRIPTION_PROMPT_SPLIT = `${TRANSCRIPTION_PROMPT_SINGLE}

You are being given TWO images, in order: the first is the top portion of a single handwritten page, the second is the bottom portion of that SAME page. They overlap in the middle (the bottom of image 1 shows some of the same lines as the top of image 2) — this is intentional, so you can read small cramped text more clearly. Mentally stitch them into one continuous document and output the transcription ONCE, in reading order, without repeating the overlapping lines twice.`;

class GeminiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind; // 'network' | 'auth' | 'quota' | 'other'
  }
}

// images: array of { mimeType, data (base64) } — either a single cleaned-up
// photo, or [top-half, bottom-half] of the same page (see imageUtils.js).
async function transcribeHandwriting({ apiKey, images }) {
  if (!apiKey) {
    throw new GeminiError('No Gemini API key is configured yet.', 'auth');
  }
  if (!images || images.length === 0) {
    throw new GeminiError('No image to transcribe.', 'other');
  }

  const promptText = images.length > 1 ? TRANSCRIPTION_PROMPT_SPLIT : TRANSCRIPTION_PROMPT_SINGLE;

  const url = `${API_BASE}/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
        `Gemini's free daily quota appears to be exceeded (429). Try again after the quota resets. ${details}`,
        'quota'
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

module.exports = { transcribeHandwriting, GeminiError, MODEL_NAME };
