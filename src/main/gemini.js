// Calls the Gemini API directly from the client (no hosted backend) using the
// user's own free-tier API key, asking it to transcribe a photo of messy
// Hebrew cursive handwriting (כתב יד עברי) into standard block print
// (כתב מרובע).

// If a newer/renamed Gemini vision model becomes free-tier default in the
// future, update MODEL_NAME here.
const MODEL_NAME = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSCRIPTION_PROMPT = `You are transcribing a photo of a handwritten note in Hebrew cursive script (כתב יד עברי, "Hebrew script"/"stam-adjacent" everyday cursive), often informal and messy handwriting.

Instructions:
- Transcribe the handwriting into standard printed block Hebrew letters (כתב מרובע), NOT cursive.
- Preserve the original line breaks and paragraph structure as closely as reasonably possible.
- If a word or letter is genuinely ambiguous or illegible, make your best guess and wrap ONLY that word in square brackets, e.g. [ambiguous word], rather than silently guessing with full confidence.
- Do not translate the text into any other language — output Hebrew only.
- Do not add commentary, headers, or explanations. Output only the transcribed text.`;

class GeminiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind; // 'network' | 'auth' | 'quota' | 'other'
  }
}

async function transcribeHandwriting({ apiKey, imageBuffer, mimeType }) {
  if (!apiKey) {
    throw new GeminiError('No Gemini API key is configured yet.', 'auth');
  }

  const url = `${API_BASE}/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        parts: [
          { text: TRANSCRIPTION_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
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
