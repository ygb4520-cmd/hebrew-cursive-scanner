# Hebrew Cursive Scanner

A free desktop app (Windows `.exe` + Mac `.app`, one codebase) that photographs
handwritten Hebrew cursive notes (כתב יד עברי) and transcribes them into clean,
editable block-print Hebrew (כתב מרובע) using Google's Gemini API vision model.

No hosted backend, no monthly cost. Notes sync between your machines via a
folder you already have cloud-synced (Google Drive, in this setup).

## How it works

- **Import**: drag a photo in, or use "Choose Photo…" (JPG/PNG/HEIC supported).
- **Transcribe**: the app sends the photo straight from your machine to Google's
  Gemini API using your own free API key (never bundled with the app), asking
  it to transcribe the cursive into block print, preserving line breaks and
  flagging genuinely ambiguous words in `[brackets]`.
- **Edit & copy**: the result appears in an editable, right-to-left text box
  with a one-click "Copy to Clipboard" button.
- **Sync**: each note (photo + text + timestamp) is saved as files inside
  `<your chosen folder>/HebrewCursiveScannerNotes/notes/<id>/`. Point both
  machines at the *same* folder inside your Google Drive sync folder, and
  Google Drive's own sync handles getting notes from one machine to the other.
  The app rescans that folder every time it opens (and via the ⟳ button).

## First-time setup (in the app)

1. Open **⚙ Settings**.
2. Paste your free Gemini API key (see below for how to get one).
3. Choose a folder that lives inside your Google Drive sync folder on this
   machine — the app will create a `HebrewCursiveScannerNotes` subfolder there.
4. Repeat steps 2–3 on your other machine, pointing at the *same* Drive folder.

## Local development

```bash
npm install
npm start          # run the app in dev mode
npm run build:mac  # package a local macOS .dmg (for testing on this machine)
npm run build:win  # (only really works via CI — see below)
```

> If commands like `npm start` fail with `electron: command not found`, check
> that no folder in this project's path contains a colon (`:`) — macOS Finder
> silently stores a typed `/` in a folder name as a real `:` on disk, which
> breaks npm's PATH resolution.

## Building installers via GitHub Actions (no local Windows machine needed)

Every push to `main` triggers `.github/workflows/build.yml`, which builds:
- a macOS `.dmg` on a hosted `macos-latest` runner
- a Windows `.exe` on a hosted `windows-latest` runner

Both are uploaded as downloadable **workflow run artifacts** (Actions tab →
the run → Artifacts section) — nothing is auto-published or released.

Builds are **unsigned** (no Apple Developer / Windows code-signing certificate
configured). On first launch you'll need to bypass Gatekeeper (macOS:
right-click the app → Open) or SmartScreen (Windows: "More info" → "Run
anyway"). This is expected for a free, personal-use build.

## Out of scope for v1

Hosted backend/server, offline transcription, batch processing, mobile app,
exceeding the free Gemini quota, real-time push sync (relies on your cloud
provider's own sync + an on-open rescan instead).
