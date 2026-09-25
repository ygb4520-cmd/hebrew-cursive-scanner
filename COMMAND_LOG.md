# Command Log

Running log of every shell command executed for this project, per the build prompt's
persistence instructions. Appended continuously; not erased until the next context
compaction event.

## 2026-08-16

```bash
# Checked for existing toolchains (none found: no rustc/cargo, no node/npm, no homebrew)
command -v rustc; command -v cargo; command -v node; command -v npm; command -v git; command -v gh
command -v brew

# Installed nvm (Node Version Manager), official script, no sudo
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Registered nvm in ~/.zshrc (no shell profile existed yet)
touch ~/.zshrc
cat >> ~/.zshrc << 'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF

# Installed latest Node.js LTS via nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install --lts
# -> node v24.19.0, npm v11.17.0

# Created project skeleton + git repo
mkdir -p "/Users/tziporabrownstein/claude apps:extensions/hebrew-cursive-scanner"
cd "/Users/tziporabrownstein/claude apps:extensions/hebrew-cursive-scanner"
git init -q
mkdir -p src/main src/renderer .github/workflows build
```

Wrote the initial Electron app skeleton: package.json, .gitignore, src/main/{main,preload,store,apiKeyStore,imageUtils,gemini,notesStore}.js, src/renderer/{index.html,styles.css,renderer.js}.

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd "/Users/tziporabrownstein/claude apps:extensions/hebrew-cursive-scanner"
npm install
# -> installed electron, electron-builder, heic-convert (421 packages)

# Smoke-tested the app (npx failed because the parent folder name contained a
# colon, which corrupts npm's PATH construction):
npx electron . --no-sandbox                     # FAILED: "electron: command not found"
node ./node_modules/electron/cli.js .            # worked directly, app launched without errors
npm start                                        # FAILED too, same colon/PATH problem
```

### Fixed the colon-in-path problem (renamed parent folder)

Discovered the project's parent folder was actually named `claude apps:extensions`
on disk (a literal colon) — Finder had been displaying it as `claude apps/extensions`
because of macOS's legacy colon\<->slash translation between Finder and POSIX paths.
The embedded colon broke npm's PATH-delimited script resolution. User confirmed a
restructure:

```bash
OLD="/Users/tziporabrownstein/claude apps:extensions"
NEW="/Users/tziporabrownstein/claude apps"
mv "$OLD" "$NEW"
mkdir -p "$NEW/extensions"
mv "$NEW/safariadblocker" "$NEW/extensions/"
# Catan, "Hebrew text extractor", music-library-organizer(.zip), and
# hebrew-cursive-scanner stayed directly in "$NEW" per the user's choice.

cd "$NEW/hebrew-cursive-scanner"
npm start   # -> now works correctly
```

Project now lives at: `/Users/tziporabrownstein/claude apps/hebrew-cursive-scanner`

Added `.github/workflows/build.yml` (macos-latest + windows-latest runners, electron-builder,
uploads dist installers as workflow artifacts — no auto-publish/release).

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd "/Users/tziporabrownstein/claude apps/hebrew-cursive-scanner"
npm run build:mac -- --publish=never
# -> local test build succeeded: dist/Hebrew Cursive Scanner-0.1.0-arm64.dmg (99.9 MB)
#    validates the electron-builder config before pushing to GitHub Actions CI
```

### GitHub push

User created account `ygb4520-cmd` and repo `hebrew-cursive-scanner` (private) via the
GitHub web UI. Installed `gh` CLI locally (no sudo) to authenticate without ever handling
the user's password/token directly — used browser device-code login (`gh auth login --web`),
which the user approved in their own browser.

```bash
mkdir -p ~/.local/bin
curl -sL -o /tmp/gh.zip "https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_macOS_arm64.zip"
unzip -q -o /tmp/gh.zip -d ~/.local/gh-extract
cp ~/.local/gh-extract/gh_2.97.0_macOS_arm64/bin/gh ~/.local/bin/gh

printf '\n' | ~/.local/bin/gh auth login --hostname github.com --git-protocol https --web
# user authorized device code BEAB-CEA3 in browser

cd "/Users/tziporabrownstein/claude apps/hebrew-cursive-scanner"
~/.local/bin/gh auth setup-git
git push -u origin main
# FAILED: "refusing to allow an OAuth App to create or update workflow
#          `.github/workflows/build.yml` without `workflow` scope"

printf '\n' | ~/.local/bin/gh auth refresh -h github.com -s workflow
# user authorized device code 852A-C40B in browser

git push -u origin main
# -> succeeded: main -> main, tracking origin/main
```

Repo: https://github.com/ygb4520-cmd/hebrew-cursive-scanner

### Live end-to-end test (Gemini key + Google Drive sync + first real note)

- User (under 18) could not create the Gemini API key personally (Google's Generative AI
  terms require being of legal age / guardian consent); a parent/guardian created the key
  instead and handed it to the user to paste into the app's own Settings screen.
- Google Drive for desktop was not yet installed on this Mac; walked the user through
  installing it (standard macOS .pkg installer, admin password required — normal, not
  Drive-specific) and signing in. Confirmed folder appeared at
  `~/Library/CloudStorage/GoogleDrive-ygb4520@gmail.com/`.
- In-app Settings: saved API key (encrypted via safeStorage) and set sync folder to
  `.../My Drive/Notes`.
- First transcription attempt failed: `Gemini API error (400): API key not valid.` — turned
  out to be a bad copy/paste; re-copied via AI Studio's copy-icon and re-saved, fixed.
- Second attempt failed: `Gemini API error (404): This model models/gemini-2.5-flash is no
  longer available to new users... use the Interactions API` — Google deprecated
  `gemini-2.5-flash` for newly-created API keys sometime after this app was first built.
  Looked up current docs (ai.google.dev/gemini-api/docs/{migrate-to-interactions,models}):
  confirmed the old `generateContent` REST endpoint is still fully supported (no rewrite
  needed), just switched `MODEL_NAME` in `src/main/gemini.js` to `gemini-3.6-flash`.

```bash
pkill -f "Electron.app/Contents/MacOS/Electron"   # stop the running dev instance
cd "/Users/tziporabrownstein/claude apps/hebrew-cursive-scanner"
npm start                                          # relaunch with the model fix

git add -A
git commit -m "Fix: update to gemini-3.6-flash (gemini-2.5-flash deprecated for new API keys)"
git push
# -> f6b2907..83e9a08  main -> main
```

- Retried transcription: succeeded. Verified on disk that the note saved correctly:
  `.../My Drive/Notes/HebrewCursiveScannerNotes/notes/<id>/{photo.jpg,meta.json}`.

### Session 2 (2026-08-18): accuracy tuning, delete, self-updater

- User reported real transcription quality was poor on genuinely dense, fast, abbreviation-heavy
  personal Talmud/halacha shorthand (verified by viewing the actual photo directly). Found a real
  bug: identical photo run twice gave two different transcriptions (no temperature set → sampling
  noise). Fixed: `generationConfig.temperature: 0` in `src/main/gemini.js`.
- Rewrote `TRANSCRIPTION_PROMPT` to match the real material: fast rabbinic-shorthand study notes,
  preserve genuinely mixed Hebrew/English verbatim (previously wrongly forced "Hebrew only"),
  expect standard Talmudic abbreviations, watch for similar-looking Hebrew letter confusions.
- Tried `gemini-3.1-pro-preview` for accuracy — hit `limit: 0` (not actually free-tier usable for
  this key despite Google's pricing page). Tried `gemini-3.7-flash` — had real free quota, but
  user judged its actual output worse than `gemini-3.6-flash` on their handwriting; reverted to
  `gemini-3.6-flash` per user's live comparison.
- Added `sharp`-based image preprocessing (`src/main/imageUtils.js`): contrast normalize + sharpen,
  auto-trim of blank margins. Tried splitting the page into two overlapping halves to give dense
  text more effective detail — reverted (doubled image tokens/quota use, user felt it was worse,
  no clear win). Auto-trim kept (harmless no-op when there's no clean border to cut).
- Added a "Delete Note" button (`src/renderer/renderer.js`, `src/main/notesStore.js`) — sends the
  note folder to the OS trash via `shell.trashItem`, not a permanent delete, per the user's
  standing "delete means trash" preference.
- Made the repo public (was private) so the self-updater can hit the GitHub Releases API without
  an embedded token:
  ```bash
  ~/.local/bin/gh repo edit ygb4520-cmd/hebrew-cursive-scanner --visibility public --accept-visibility-change-consequences
  ```
- Built a self-update feature (`src/main/updater.js`) instead of Electron's built-in autoUpdater,
  since that needs a paid Apple code-signing cert to work reliably on Mac. Checks
  `api.github.com/repos/.../releases/latest`, compares versions, downloads the right asset
  (`.zip` on Mac, `.exe` on Windows), and installs it itself. Mac installs to `~/Applications`
  (not the system-wide `/Applications`) since the user's account can't write there without an
  admin password they don't have — confirmed live: `mv` into `/Applications` failed with
  "Permission denied" for this account.
- `package.json`: bumped version to 0.2.0, added `zip` target for mac (alongside `dmg`), added
  `build.publish` (GitHub provider). `.github/workflows/build.yml`: tag pushes (`v*`) now also
  run `electron-builder --publish=always` to create a real GitHub Release with the built
  installers attached; plain branch pushes still just build artifacts as before.

### Session 3 (2026-08-23 to 2026-09-11): shipped v0.2.0, built the email-command-bridge,
### then did unrelated work across three other projects in the same conversation

Commands actually executed this session, in order (per this repo's persistence instructions —
a prior pass here wrongly substituted a narrative summary for this list; corrected):

```bash
# Diagnosing why 2 real emails from the user never got processed by the email-command-bridge
cd "/Users/tziporabrownstein/claude apps/email-command-bridge"
venv/bin/python3 check_commands.py
python3 -c "import json; st=json.load(open('state.json')); print(st)"   # inspect processed-ids/UID cursor
python3 -c "
import imaplib
from bridge import keychain
pw = keychain.support_password()
conn = imaplib.IMAP4_SSL('imap.gmail.com')
conn.login('claudeappsupport@gmail.com', pw)
conn.select('INBOX', readonly=True)
status, data = conn.uid('search', None, 'FROM', 'ygb4520@gmail.com')
print(data)
"   # found 2 unprocessed messages ("music library orginizer", "github readmes")
python3 -c "from bridge import verify; ..."   # ran is_verified_from() on both -> both failed DKIM
python3 -c "
import dkim, logging
logging.basicConfig(level=logging.DEBUG)
result = dkim.verify(raw_message_bytes, logger=logging.getLogger('dkim'))
"   # dkimpy debug log revealed: "x= value is past" -- signature EXPIRED (Gmail's 7-day window),
    # not spoofed -- messages had sat unprocessed >2 weeks

# Fixed bridge/verify.py: pin process clock to the message's own t= (signing time) during
# dkim.verify() only, so the crypto check still runs for real but the freshness *policy*
# (irrelevant to this system's threat model) doesn't reject legitimately-late mail
venv/bin/python3 -m py_compile bridge/verify.py
venv/bin/python3 check_commands.py   # re-ran -> both messages now correctly surfaced as new_commands
python3 -c "from bridge import mailbox; ..."   # sent the two real replies via send_reply.py
venv/bin/python3 send_reply.py "Re: music library orginizer" "Yes, it's feasible, two ways: ..." "<message-id>"
venv/bin/python3 send_reply.py "Re: github readmes" "Happy to -- just need a bit more to go on ..." "<message-id>"
venv/bin/python3 check_commands.py   # final clean confirmation run

# GitHub Desktop app bug report (unrelated to this repo's code, but diagnosed in this session)
# -- fetched/researched via WebFetch/WebSearch, then filed:
gh issue create --repo anthropics/claude-code \
  --title "[BUG] Claude Desktop (Code tab, macOS) — new messages hang indefinitely at \"Sending...\", never transmit" \
  --body-file /tmp/claude-desktop-bug-report.md
  # -> https://github.com/anthropics/claude-code/issues/93528
```

Scheduled-task changes (via the `mcp__scheduled-tasks__*` tools, not shell commands, so not
literal "commands" but logged here for completeness since they're config that governs when
future runs happen): created `email-bridge-check-930/-10/-11` (3 tasks, later deleted),
replaced with `email-bridge-check-8am`, `-925pm`, `-10pm`, `-11pm` (4 tasks, current) after the
user specified exact times (8:00am, 9:25/9:40pm, 10:00/10:20pm, 11:00pm — cron can't express
those 6 times as one expression, hence 4 tasks grouped by hour). Prompt logic iterated three
times per the user's feedback: (1) first version looped up to 3x on any `new_commands`; (2)
switched to a plain `sleep 300` + re-run loop instead of dynamically creating a new
`fireAt` task each time, since calling `create_scheduled_task`/`update_scheduled_task`
mid-run could itself need an unattended permission prompt; (3) final version loops only while
`still_pending` shows genuine back-and-forth progress (a "quiet streak" counter, capped at 2
quiet checks), always stopping if the next real scheduled slot is within 10 minutes.

Full narrative detail on the email-command-bridge (separate local project,
`/Users/tziporabrownstein/claude apps/email-command-bridge`,
not pushed to GitHub): built a system letting the user reach a live Claude Code agent by email
from any computer, using two Keychain-protected Gmail accounts, DKIM+sender verification, and
a confirmation-email round-trip for anything needing explicit permission (full remote
execution was requested and explicitly declined even after the user asked twice — per-action
permission can't be pre-authorized as a standing grant). Four scheduled tasks run it at
8am/9:25/9:40pm/10/10:20/11pm daily with a 5-minute-loop follow-up while a reply is pending.
Full detail in the `[[hebrew-cursive-scanner-project]]` memory file (the most detail-dense
part of it) — this was real, multi-day, security-relevant engineering, not a quick add-on.

**Unrelated work done in this same conversation** (separate repos, own memory files —
`[[music-library-organizer-project]]`, `[[safariadblocker-project]]`,
`[[hebrew-text-extractor-windows-blocked]]` — narrative detail lives there; commands here):

```bash
# --- safariadblocker: first-time push to GitHub (pre-existing local project) ---
cd "/Users/tziporabrownstein/claude apps/Extensions/safariadblocker"
find . -maxdepth 1 -name ".gitignore"; cat .claude/settings.local.json; ls -la scripts/logs
# wrote .gitignore (.claude/, scripts/logs/*.log, xcuserdata, the stale AdTrackerBlocker-Windows.zip)
git init -q
git add -A; git status --short   # 77 files staged, verified no logs/local-settings included
git commit -q -m "Initial commit ..."
~/.local/bin/gh repo create safariadblocker --public --source=. --remote=origin --push

# --- music-library-organizer: this project's venv was broken (created pre folder-rename) ---
cd "/Users/tziporabrownstein/claude apps/music-library-organizer"
head -1 venv/bin/pip venv/bin/python3   # shebang pointed at the old "claude apps:extensions" path
rm -rf venv
python3 -m venv venv
venv/bin/pip install --quiet -r requirements.txt pyacoustid

# --- music-library-organizer: metadata-lookup feature (filename search via MusicBrainz) ---
venv/bin/python3 -c "from organizer import metadata_lookup; print(metadata_lookup.search('Queen','Bohemian Rhapsody'))"
venv/bin/python3 -c "... metadata_lookup.best_match(Path('.../The Beatles - Hey Jude.flac')) ..."
# -> hit an uncaught socket.timeout (not a TimeoutError subclass on this Python 3.9); fixed
# search()'s except clause to catch OSError broadly
cp "/Users/tziporabrownstein/Downloads/Nova.mp3" "$SCRATCH/test-tag-write.mp3"   # disposable copy, never the original
venv/bin/python3 -c "from organizer import tag_reader, tag_writer; ... write_tags(...) ... read_tags(...)"   # round-trip test
rm "$SCRATCH/test-tag-write.mp3"
# end-to-end pipeline test on a renamed+tag-stripped disposable copy ("Jeryko - Shadow.mp3"):
venv/bin/python3 -c "
from organizer import tag_reader; from organizer.models import MetadataSource
from organizer.metadata_lookup import best_match; from organizer.tag_writer import write_tags
... scan folder, find MetadataSource.NONE tracks, best_match(), write_tags(), re-read to confirm ...
"
# found + fixed: a transient MusicBrainz rate-limit response looked identical to "no match" --
# added a retry with backoff in metadata_lookup.search()

# --- music-library-organizer: audio-fingerprinting fallback (AcoustID + fpcalc) ---
venv/bin/pip install --quiet pyacoustid
curl -sL -o /tmp/fpcalc-mac.tar.gz "https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-macos-universal.tar.gz"
curl -sL -o /tmp/fpcalc-win.zip "https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-windows-x86_64.zip"
tar -xzf /tmp/fpcalc-mac.tar.gz -C /tmp; unzip -q -o /tmp/fpcalc-win.zip -d /tmp/fpcalc-win-extracted
cp /tmp/chromaprint-fpcalc-1.6.1-macos-universal/fpcalc bin/mac/fpcalc; chmod +x bin/mac/fpcalc
cp /tmp/fpcalc-win-extracted/.../fpcalc.exe bin/windows/fpcalc.exe
xattr -l bin/mac/fpcalc; ./bin/mac/fpcalc -version   # confirmed no quarantine flag, runs fine
venv/bin/python3 -c "import acoustid; from organizer.metadata_lookup import fpcalc_path; acoustid.fingerprint_file(...)"
# live API test (user pasted her real AcoustID key into the app's own Settings dialog, not to me):
venv/bin/python3 -c "from organizer.metadata_lookup import best_match; best_match(Path('.../xyz_garbled_9182.mp3'))"
# -> None; confirmed genuine "no match" (not a broken key) by re-testing with an obviously
# invalid key, which correctly raised WebServiceError instead of returning an empty list
git add -A; git commit -q -m "Add Settings, manual tag editor, sorting, multi-artist handling, audio fingerprinting (v0.3.0)"
git push
git add -A; git commit -q -m "Apply multi-artist Settings preference to folder organization too"
git push
git tag v0.3.0; git push origin v0.3.0
gh run watch <run-id> --repo ygb4520-cmd/music-library-organizer --exit-status
gh release view v0.3.0 --repo ygb4520-cmd/music-library-organizer

# --- verifying all three repos' README download instructions actually work ---
curl -sL -o /dev/null -w "%{http_code} -> %{url_effective}\n" "https://github.com/ygb4520-cmd/hebrew-cursive-scanner/releases/latest"
curl -s "https://api.github.com/repos/ygb4520-cmd/hebrew-cursive-scanner/releases/latest" | python3 -c "..."
curl -sL -o /dev/null -w "%{http_code} -> %{url_effective}\n" "https://github.com/ygb4520-cmd/music-library-organizer/releases/latest"
curl -s "https://api.github.com/repos/ygb4520-cmd/music-library-organizer/releases/latest" | python3 -c "..."
ls -la ".../safariadblocker/WindowsExtension/README-WINDOWS.md"   # confirmed the linked file exists
# then committed/pushed a "Download" section added to the top of all three READMEs
```

Also filed a real Claude Desktop bug during this session:
https://github.com/anthropics/claude-code/issues/93528 (new chat messages hang forever at
"Sending..." — this is the likely reason the email-bridge scheduled tasks went quiet for a
2+ week stretch; Claude Code needs to actually be open and responsive for them to fire).

Windows port of the Hebrew PDF text extractor: blocked, see
`[[hebrew-text-extractor-windows-blocked]]` — the user has no current access to the Windows
computer where the only copy of that project's source code lives.

### Session (2026-09-20): line-segmentation OCR pipeline, self-update fix, rotate/crop UI, PDF import

- Real Hebrew-handwriting-OCR benchmark (github.com/itayinbarr/heb-ocr, MIT, independent dev
  project) showed Gemini Flash's per-LINE accuracy (0.119 median CER) is actually the best of
  every model tested, but its FULL-PAGE accuracy (0.764 CER) is much worse than a dedicated
  small HTR model's page-mode pipeline (0.331, via classic line-segmentation). Root-caused this
  app's mediocre accuracy to reading whole pages at once rather than a model capability gap.
- Built `src/main/lineSegmenter.js`: horizontal ink-density-projection line segmentation (no
  external CV library), validated against a synthetic test image before wiring in.
- Rearchitected transcription (`src/main/main.js`, `gemini.js`): segment page into lines →
  transcribe each line separately (own prompt tuned for single-line reading) → join results.
  Concurrency-limited + staggered requests, retry-with-backoff on both 429 (rate limit) AND
  503 (transient overload — found live, wasn't originally retried, real gap).
- Live-probed actual free-tier RPM limits (Google's docs don't publish these per-model
  anymore): `gemini-3.6-flash` capped at ~5 req/min for this key -- far too slow for one
  request per line on a real page. `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` both
  handled 8 rapid requests with zero rate-limiting; switched per-line transcription to
  `gemini-3.5-flash-lite` (`MODEL_NAME_LINE` in gemini.js), kept `gemini-3.6-flash` for the
  rare whole-page fallback.
- Found and fixed a real orientation bug: `heic-convert` decodes HEIC pixels but does not
  carry the source's EXIF orientation tag through to its JPEG output — confirmed with a real
  iPad photo that came out landscape with NO orientation tag at all (not recoverable from
  metadata, there was nothing there). Added `exifr`-based orientation reading from the
  ORIGINAL file bytes before conversion, re-stamped via sharp onto the working buffer.
- Repeatedly misjudged this specific handwriting's rotation by eye across several rounds
  (see conversation) -- stopped guessing visually and instead used the segmentation
  algorithm's own band-count/consistency as an objective test across all 4 rotations. Lesson:
  don't eyeball unfamiliar dense cursive for orientation; test algorithmically instead.
- Root cause of persistent bad segmentation turned out to be background (the photographed
  page didn't fill the frame -- dark couch/blanket visible around it), not orientation: dark
  background pixels mixed into the same rows as real text corrupted the ink-threshold math
  for the whole image. Cropping to the page first took segmentation from 4 messy bands
  (stdev 386px) to 11 clean, evenly-spaced bands (stdev 9px) -- confirmed empirically before
  shipping.
- Added `detectPageBoundingBox()` (imageUtils.js): finds the photographed page's bounding box
  by looking for "mostly bright" rows/columns (paper vs. background), distinct from the
  existing `trim()` step which only removes a uniform blank border and does nothing against a
  textured/colored background.
- Built a full rotate + draggable-crop preview step before transcription (`previewModal` in
  index.html/renderer.js): shows the photo, auto-suggests a crop box, lets the user drag
  corner handles to adjust, rotate left/right, before confirming. Needed since some photos
  have zero EXIF data and some backgrounds fool the auto-crop.
- Added PDF import: `sharp`'s bundled libvips in this environment has no PDF support
  (`sharp.format.pdf.input` all false) — used `pdfjs-dist` (ESM-only, dynamic `import()` from
  this CommonJS codebase) + `@napi-rs/canvas` to render a PDF's first page to PNG, feeding it
  through the same rotate/crop/segment/transcribe pipeline as a photo. Verified both the
  native binary (`@napi-rs/canvas`'s .node file) and pdfjs's bundled standard_fonts assets
  get correctly auto-unpacked/bundled by electron-builder in a real packaged build, not just
  dev mode -- checked `app.asar.unpacked` directly rather than assuming.
- User tested a real scanner-app PDF (vs. camera photo) after these fixes: "somewhat better,"
  a real but modest improvement.
- Version bumped to 0.3.0 for this release.

### Self-update bug found and fixed immediately after shipping v0.3.0

- Real self-update test (v0.2.0 -> v0.3.0, actual installed app in ~/Applications) failed:
  `ENOTDIR: not a directory, rmdir '.../Contents/Resources/app.asar'`. Root cause: the
  original `applyMacUpdate` tried to `fs.rmSync` + `fs.cpSync` the app's own bundle
  IN-PROCESS, while that exact process was still running from it -- Electron memory-maps
  `app.asar`, so deleting/replacing it out from under the live process throws low-level fs
  errors. This is the same class of constraint already correctly handled for Windows (a
  running process can't overwrite its own .exe) but wasn't applied to the Mac path
  originally -- a real gap, not a platform difference.
- The failed rm partially deleted the bundle before erroring (`Contents/MacOS` was gone,
  `Contents/Resources/app.asar` remained) -- confirmed by inspecting the installed app
  directly. Had to manually reinstall a clean copy (`gh release download` the v0.3.0 zip,
  extract, copy into `~/Applications`) since the broken bundle couldn't self-repair.
- Fixed `applyMacUpdate` (src/main/updater.js) to match the Windows pattern properly: spawn
  a detached bash helper that waits for this process's PID to fully exit, THEN does the
  rm/cp/relaunch, instead of doing it in-process before quitting.
- Version bumped to 0.3.1, but v0.3.0 -> v0.3.1 self-update retest hit the SAME ENOTDIR
  error. Realized why: the RUNNING process's own loaded code executes the update logic, not
  the version being updated TO -- v0.3.0 was still running its own (unfixed) applyMacUpdate
  when asked to update, so of course it failed identically. The fix in v0.3.1's code was
  real but untestable via a v0.3.0-initiated update; had to manually reinstall v0.3.1 (same
  gh release download + extract approach) so a FIXED version would actually be the one
  running. Two crash reports the user shared (2026-09-20 and 2026-09-21) were both downstream
  of these exact failed-update incidents (the process's own backing files getting pulled out
  from under it while still running eventually triggers a hard V8/JIT crash a minute or two
  later) -- not separate new bugs, confirmed by matching launch/crash timestamps to when each
  update attempt happened.
- Version bumped to 0.3.2 specifically to get a real update TARGET for v0.3.1 (already
  reinstalled clean, with the fix) to update TO -- this is the actual valid test of whether
  the fix works, unlike the v0.3.0-initiated attempt.
- **Verified for real**: triggered v0.3.1 -> v0.3.2 self-update from the live installed app.
  Succeeded -- no ENOTDIR, `Contents/MacOS` intact, app relaunched automatically reporting
  0.3.2, confirmed via `Info.plist` and a fresh PID. The fix is real, not just theoretically
  correct this time.

### Full-pipeline regression test (post self-update-fix) + cleanup attempt

- User asked for a full regression test ("everything else still works") using an already-real
  photo rather than a fresh manual drag-drop. Reused a real note's already-saved `photo.png`
  (from an earlier PDF import) as the test input, and drove the exact same functions the UI's
  IPC handlers call (`loadImageForTranscription` -> line-segment -> per-line `transcribeLine`
  -> `notesStore.createNote` -> `updateNoteText` -> `listNotes` -> `shell.trashItem`) via a
  throwaway Electron harness pointed at the real app's userData (same `{name:
  "hebrew-cursive-scanner"}` trick used for the rate-limit probe and self-update tests
  earlier), so it used the real saved API key with zero manual UI clicks. All steps passed:
  15 lines segmented and transcribed, edit saved, list reflected it, delete moved it to trash
  and removed it from the active list.
- User wants down to a single installed copy. The stale v0.1.0 in the system-wide
  `/Applications` (from the very first CI build, months ago) still can't be removed
  programmatically -- confirmed again with a fresh `rm -rf`, still "Permission denied" (this
  account has no admin rights on this Mac, same constraint hit earlier when trying to install
  Google Drive / restructure folders). Left instructions for the user to delete it themselves
  via Finder (which can prompt for an admin password interactively, unlike a terminal `rm`).
  The working, up-to-date copy remains `~/Applications/Hebrew Cursive Scanner.app` (v0.3.2).

### "Just follow the paper, don't use your brain" prompt experiment (reverted) + word-highlight feature (shipped, v0.3.3)

- User's hypothesis: bad transcriptions might be Gemini "correcting" unfamiliar personal
  shorthand/abbreviations toward real Gemara/dictionary words instead of copying the actual
  letter shapes. Rewrote `SHARED_GUIDANCE` in `gemini.js` to explicitly forbid using
  Talmudic/context knowledge to "fix" words, emphasizing literal letter-by-letter copying.
  Tested live against a real saved note (`1789940099387-8cad6516`, via a throwaway Electron
  harness reusing the real app's userData/API key, same pattern as prior regression tests --
  never saw the actual key). Output differed noticeably from the old prompt but user judged it
  "not any better" after live comparison in dev mode. Reverted `gemini.js` via `git checkout --`
  (change was never committed, so a clean revert). Lesson: this specific failure mode isn't
  primarily a prompt-wording problem.
- User then asked for a real debugging feature instead: hover a word in the transcribed text,
  see it highlighted on the source photo, plus side-by-side photo/text layout with zoom. Asked
  first whether this was feasible without hurting transcription quality -- yes, confirmed and
  built as a purely local, additive layer: never touches the Gemini call/prompt/model, so
  transcription quality is byte-for-byte unaffected either way.
  - `lineSegmenter.js`: extended the existing row-based ink-projection (used for line-splitting)
    with a second pass -- column-based ink projection *within* each line -- to find word-sized
    ink clusters. Real risk found and handled: Hebrew cursive letters are mostly disconnected
    (unlike English/Arabic cursive), so a naive "any gap = new word" rule would just find
    individual letters. Fix: classify each internal gap as "intra-word" vs "inter-word" by
    finding the single biggest proportional jump in gap sizes for that specific line (adaptive
    per-line, not a fixed pixel threshold), only trusting the split if that jump is at least
    1.6x.
  - **Tested this against real data before building any UI**: wrote a throwaway script
    (plain `node`, no Electron needed since this module has no Electron deps) that ran the new
    segmentation against the real photo from note `1789940099387-8cad6516` and compared word
    cluster counts to that note's already-saved real transcription, line by line. Result:
    0 of 15 lines had cluster-count == transcribed-word-count. Reported this honestly to the
    user before proceeding rather than shipping a feature that silently claims precision it
    doesn't have.
  - Given that, implemented two-tier highlighting in `renderer.js`: when a line's cluster count
    matches the current word count exactly, hovering a word highlights that exact cluster; when
    it doesn't (the common case on real cursive), it falls back to *proportional* placement
    among whatever clusters were found -- an approximate position within the line, not a promise
    of the exact word. The line-height band itself (which line a word came from) is always exact
    regardless, since that comes from the already-proven row-projection step.
  - `main.js`/`notesStore.js`: `transcribeByLines` now returns `{text, lineBoxes}` (lineBoxes
    null on the rare whole-page fallback, where there's no per-line data at all); `createNote`
    persists `lineBoxes` (fractions of the saved photo's own width/height) in `meta.json` only
    when present, so old notes and whole-page-fallback notes just don't get the hover feature
    rather than breaking.
  - `renderer.js`/`styles.css`: rebuilt the note detail view as photo-pane (zoomable via
    wheel/buttons, pannable via drag -- same self-cleaning mousemove/mouseup pattern already
    used for the crop-box UI) + text-pane side by side, replacing the old stacked
    thumbnail-then-textarea layout. Text is now rendered as hoverable per-word `<span>`s in a
    read-only view by default, with an "Edit Text" toggle that swaps in the original textarea
    for free-form editing (edits don't need to keep any word-box mapping in sync -- matching is
    recomputed fresh from the current text every time a note is displayed).
  - User's call: "ship it, not so good but no downside" -- accurate self-assessment matching the
    live test above; shipped anyway since it's strictly additive (existing users/notes unaffected,
    text editing/copy/delete/reveal all still work) and still gives real diagnostic value (you can
    now at least see which LINE and roughly where a bad transcription came from on the actual
    page, which is the debugging visibility the user actually asked for).
  - Version bumped 0.3.2 -> 0.3.3 for this release.

### Mishkefet-v1 real-page evaluation + a real, longstanding line-segmentation bug fixed (v0.3.4)

- User asked to evaluate Mishkefet-v1 (the open Hebrew HTR model researched previously) against
  real handwriting, not just the benchmark. Built a throwaway Python venv (via `uv`, no admin
  needed) with the released weights, ran it against the same real note used earlier, and built
  an Artifact (`Ktav Cross-Check`) showing the photo (with segmenter-derived line markers, zoom)
  next to both models' output per line, with a per-line "which is better" picker and running
  tally, persisted via localStorage. User's verdict across 15 real lines: Mishkefet-v1 better on
  10, Gemini on 2, 3 unclear. User's own theory for *why*: Mishkefet "only reads letters," missing
  punctuation/abbreviation marks. Confirmed by checking the model's actual `charset.json`: it has
  plain ASCII `"`/`'` but no Hebrew גרשיים/גרש (the real marks rabbinic abbreviations use), and
  empirically never emits parentheses either even though they're in-vocabulary -- a real,
  evidenced architectural gap, not a guess.
- To get more than one real page to test with, walked through capture-method advice (camera vs.
  scan; recommended iPhone's built-in Notes/Files "Scan Documents" over a photo, since it
  auto-corrects exactly the failure modes that have caused real bugs here: perspective skew,
  uneven lighting, background clutter). User scanned a 4-page PDF.
- Rendering those 4 pages and running them through the app's own `segmentIntoLines` surfaced a
  **real, longstanding bug the user confirmed was never actually fixed** ("it was always a prob
  never found all lines"): one page found 0 of ~12 visible lines (silently fell back to
  whole-page), another found 2 of what should have been far more. Root-caused via direct pixel
  measurement (not guessing) to two compounding problems in the original row-brightness-averaging
  approach: (1) averaging brightness across a full ~2000+px-wide row dilutes real handwriting
  ink almost to nothing, since most of any given row is blank paper; (2) narrow dark artifact
  strips along the page's own edges (binder/scan-crop shadow -- measured at ~67% "ink" density in
  the leftmost columns vs. 1-5% in real text columns) added a near-constant ink floor to every
  row, so a truly blank gap between lines could never be detected at all.
- Rewrote `lineSegmenter.js`'s core: Otsu's method (auto-picks the brightness cutoff that best
  splits *that specific image's* histogram, instead of one fixed number across every camera/scan)
  for binarization, then projects actual ink PIXEL COUNTS (not averaged brightness) across rows
  to find lines and across columns within each line to find words, with dense page-edge borders
  trimmed first so artifacts can't poison the count. Tested against 5 real pages before touching
  the real file: one page went from 0 confident bands to 11, another from 2 to 7, one page that
  already worked went from 15 to 13 (small, disclosed regression, net strongly positive).
- **User then asked "any reason not to ship" -- and that question itself caught a real bug**:
  testing against actual camera-photo JPEGs (not scans) found one photo where the edge-trim step,
  with no limit on how far it could walk inward, collapsed an entire 4032x3024 image down to a
  1x1 remainder (that specific photo has severe background/lighting problems -- even its least-inky
  rows measured 46%+ "ink" density). Added `MAX_EDGE_TRIM_FRACTION` (20% cap per edge) so a
  pathologically dense/poorly-lit photo degrades to the existing, already-tested whole-page
  fallback instead of collapsing. Re-verified all 7 real test images (4 scans, 1 PDF-render, 2
  camera JPEGs) after the fix: no more collapses, no other regressions. This is the second time
  this session a "let's ship it" moment surfaced a real bug on the next check rather than after
  release -- worth remembering to always test the actual worst-looking real input before shipping
  a segmentation/threshold change, not just the inputs already known to be reasonably clean.
- Verified end-to-end (not just unit-level): ran the real `transcribeByLines` pipeline via a
  throwaway Electron harness (reusing the real saved API key, never exposed) against the
  previously-0-lines page -- correctly segmented into 11 lines and attempted real transcription on
  all of them. 6 of 11 came back as Gemini's own "returned no transcribed text" error, which is a
  separate, pre-existing failure mode (the same error hit the very first test page's last line
  too) -- not something this fix caused, and not in scope for this pass.
- Version bumped 0.3.3 -> 0.3.4 for this release.

### Extended the Mishkefet comparison to 4 pages, found + fixed a padding-overlap bug (v0.3.5)

- Re-segmented and re-transcribed (both Gemini and Mishkefet-v1) all 4 scanned pages using the
  now-fixed segmenter, and extended the `Ktav Cross-Check` Artifact to cover all 4 with a combined
  tally and per-line verdict picker. Page 3 partly hit Gemini's free-tier *daily* request quota
  mid-transcription (distinct from the per-minute limit found earlier this project) -- those
  specific lines are marked "not tested" in the comparison rather than scored as a loss.
- User caught a real bug from the artifact alone: two line-number badges on the photo overlaid
  each other illegibly. Root cause, confirmed by inspecting the actual data: `findLineBands`'s
  padding step (Pass 4, ascender/descender padding) padded each band independently with no check
  against its neighbor -- two real lines close enough together ended up with overlapping padded
  ranges, which is a real bug in the segmenter itself (not just the comparison page), since the
  app's own word-highlight feature depends on non-overlapping line boxes too. Fixed by capping any
  resulting overlap at the midpoint of the original, unpadded gap.
- While diagnosing, found a second, distinct, and still-unresolved issue: on some pages one merged
  band spans 50%+ of the entire page (confirmed: every real gap inside that span measured 5-13px,
  all under the fixed 12px "bridge small gaps" threshold -- this page's actual line spacing is
  simply tighter than that fixed constant assumed). Attempted an adaptive per-page threshold reusing
  the same "biggest gap-ratio jump" trick `findWordBands` already uses for letter-vs-word gaps --
  tested it against all 7 real images before committing to it, and it made things measurably worse
  (page1 dropped from 7 confident lines to 2; page3 from 11 to 2), because a whole page's row-gaps
  have more than two populations (intra-line noise, real inter-line gaps, paragraph breaks), so the
  single biggest jump can land at the wrong boundary. Reverted immediately rather than ship a
  regression. This specific issue (occasional oversized merged bands) is real and still open --
  needs a more careful design (likely windowed/local gap analysis, or estimating typical line pitch
  from the page's own successfully-split regions) rather than a whole-page gap-ratio heuristic.
- Version bumped 0.3.4 -> 0.3.5 for this release (the overlap fix only -- verified against all 7
  real test images with no regressions before shipping).

### Ktav Cross-Check follow-up: two more real bugs found by the user, both fixed; then deleted

- Extended the artifact to all 4 pages with a combined tally; user found the ruler numbers were
  garbled on the photo. Root cause #1: `findLineBands`'s ascender/descender padding step padded
  each band independently with no check against its neighbor, so two close-together real lines
  could end up with overlapping padded ranges -- a real bug in the segmenter itself, not just the
  artifact (this is the same fix that shipped as v0.3.5 above). Root cause #2, found only after the
  user sent zoomed screenshots proving numbers were *still* missing in a wider/maximized artifact
  view even though a narrower split-view of the same artifact showed them fine: the ruler's width
  was being measured live via `getBoundingClientRect()` before setting the image's pixel width --
  that measurement raced the browser's own layout pass in some rendering contexts and read back 0,
  silently reproducing the bug. Fixed properly by removing the JS calculation entirely and using
  CSS Grid (`grid-template-columns: 1fr 22px`) to let the browser divide the space declaratively --
  structurally impossible to race since there's no longer a value to measure. Verified at narrow,
  wide, and iframe-embedded contexts (matching how claude.ai actually renders artifacts) before
  trusting it this time, after two real premature "it's fixed" claims that both turned out wrong.
  **Lesson explicitly logged**: a screenshot glanced at is not verification, even coming from
  Claude's own read of an image -- zooming in on "circle the numbers" is what caught the second
  bug had NOT actually been visible, contradicting an earlier claim made from an unzoomed look.
- User also asked to make the photo bigger ("resize to where my cursor is" turned out, after
  clarifying via AskUserQuestion, to mean "make the photo box itself bigger," not cursor-anchored
  zoom) -- widened the photo column's max width 340px -> 560px and bumped badge size slightly,
  verified badges still fit their slots at the new size before shipping.
- After all of this, the user's own substantive verdict on going through more of the real
  comparison (not UI-related, this took me two guesses to understand -- "too close both horrible"
  meant Gemini vs Mishkefet-v1 quality is a close, bad-quality tie across real pages, reversing the
  earlier single-page 10-2-3 result in Mishkefet's favor): **neither off-the-shelf model is
  actually good on this handwriting** -- the bottleneck isn't which generic model to pick, it's
  that neither is trained on this specific handwriting. This reframed the whole thread toward
  personalization (fine-tuning/few-shot) rather than model selection.
- User then asked to delete the artifact entirely once done with it -- confirmed only one artifact
  existed this session (`action: list`) and deleted it as asked.

### Playwright-based visual-testing harness for the real app (built, shipped, not versioned)

- Separately, built a way to actually launch and click through the real Electron app and get real
  screenshots -- Playwright has native Electron support (launches the app, hands back the real
  BrowserWindow as a normal page), so unlike a native app (Catan's bespoke DebugDriver, which had to
  render in-process specifically to avoid needing macOS Screen Recording permission), no custom
  protocol was needed here at all.
- `src/main/main.js`: tiny opt-in `HCS_TEST_USERDATA_DIR` env-var check (inert unless set) that
  redirects `app.getPath('userData')` to a throwaway directory, so automated testing can never touch
  real saved notes/settings/API key.
- `scripts/debug-launch.js` (reusable `launchApp()`) + `scripts/debug-example.js` (working smoke
  test) + `.claude/skills/run-hebrew-cursive-scanner-app/SKILL.md` documenting it for future
  sessions. Verified live: real screenshot of the setup banner, real click on Settings, real
  screenshot of the resulting modal. Committed and pushed (dev-only tooling, electron-builder never
  bundles `scripts/` or `.claude/`, so no version bump needed).
- Documented in the skill file itself: prefer querying the DOM (`getBoundingClientRect`,
  `$$eval`) over eyeballing a screenshot when checking a fact rather than genuinely needing to see
  something -- directly informed by the ruler-overlap bug above, which a screenshot alone didn't
  reliably reveal.

### Few-shot Gemini examples feature -- built and verified, deliberately NOT committed yet

User asked for "Path A" from an earlier options discussion (fine-tune Mishkefet vs. few-shot
Gemini examples) with explicit instruction: build it, but hold off on `git commit` until the user
says their real example pages/lines are ready.
- `src/main/fewShotExamples/README.md` -- the convention (numbered image+`.txt` pairs, up to 5
  used, silently skips an unmatched pair rather than erroring).
- `src/main/fewShot.js` -- loader, cached after first read, returns `[]` (safe no-op) when the
  folder has no valid pairs.
- `src/main/gemini.js` -- `generateContent` now accepts `fewShotExamples` and builds a multi-turn
  `contents` array (each example as a user/model turn pair ahead of the real request);
  `transcribeLine` loads and passes them.
- Verified end-to-end for real: copied two real line crops + typed corrections into the folder,
  ran a live `transcribeLine()` call through the real (never-seen) API key, confirmed Gemini
  accepted the multi-turn request and returned a transcription, then deleted the test files
  (they were only for proving the mechanism, not real curated examples) and reconfirmed the loader
  returns to empty/no-op. `git status` confirms nothing is staged, per the user's explicit hold.

### Line-segmentation: four more real fix attempts on a new 30+-line page, all failed and reverted

User is preparing real few-shot example line-crops from an AirDropped 30+-line real page, which
immediately exposed that the segmentation bug from earlier (occasional oversized merged bands) is
worse than previously scoped -- the current algorithm found only **11 bands on a page with 30+
real lines** (largest single band spanning 40% of the page), and the user confirmed it's "not just
merging, it's also not reading all the lines."

Brainstormed three real directions (line-pitch estimation, real connected-component detection, a
manual nudge tool in the app) and, per explicit instruction to test before trusting an idea again
after the earlier reverted regression, tried the most promising one four different ways --
**all four tested against this real page (plus known-good pages, to check for regressions) and
explicitly discarded, nothing shipped**:
1. Autocorrelation on the row-ink signal to find the dominant line pitch -- locked onto the wrong
   periodicity (441px, implying ~7 lines on a 30+ line page); autocorrelation's known failure mode
   on pulse-like signals (narrow ink bursts in wide blank gaps) is it can lock onto the *wrong*
   period rather than the true fundamental one.
2. Peak-finding on a heavily smoothed row-ink signal, measuring median peak-to-peak spacing --
   gave suspiciously near-identical pitch estimates (~73-86px) across three pages with very
   different real line counts, meaning it was finding sub-line structure, not true line centers.
3. Same peak-finding with a minimum-prominence filter (the standard fix for exactly that noise
   problem) -- even worse: the same prominence fraction gave 0 peaks on some pages and reasonable
   counts on others, no single threshold generalized because different pages' ink-density
   distributions vary too much for one relative fraction to work everywhere.
4. Pre-enhancing contrast/sharpness (`.normalize().sharpen()`) before the segmentation math even
   runs, on the user's own hypothesis that boosted image quality might be why it "has trouble" --
   genuinely worth testing, but it didn't help the new page at all and measurably *regressed* two
   already-working pages (page3: 11 bands -> 2; page1: max band span 52% -> 65%). Sharpening
   amplifies whatever's already there, including scan noise/paper texture, and contrast-stretching
   can push that noise further into "looks like ink" territory.

**Conclusion drawn and stated plainly to the user**: this isn't a tuning problem anymore, it's a
sign the row-projection approach itself (collapsing a 2D page into one 1D brightness/density curve)
is the wrong tool for this, not just badly calibrated -- pointing toward the bigger rewrite
(real connected-component detection) rather than another variant of the same family of fix.

### Pivot: Gemini vision itself for line detection -- genuinely promising, not yet integrated

User asked, in response to "why don't I just manually split this one page for you," a sharper
question: why isn't a vision model just asked to find the lines directly, instead of hand-rolled
pixel math? Real answer given: manual-by-Claude doesn't scale/isn't precise/isn't automatable, but
the underlying idea is real -- since the app already calls Gemini (a real vision model) for
transcription, ask it to report line locations too, instead of approximating "where is a line"
with brightness statistics.

- First test (whole-page bounding-box detection prompt, `box_2d` in Gemini's documented 0-1000
  normalized-coordinate convention): gemini-3.6-flash hit real (transient) 503s even after backoff
  retries; gemini-3.5-flash-lite worked immediately. Result on the 30+-line page: **43 boxes**,
  tightly wrapping real individual lines in correct top-to-bottom order, including through a dense
  bottom section the old algorithm had merged into one 40%-of-page blob, and correctly separating
  small caret-inserted words too. Dramatically better than any of the four row-projection attempts.
- Model produced a real but minor malformed-JSON quirk (`"label": "line_number": 2` from the
  second entry onward) -- box_2d data itself stayed intact regardless, parsed reliably via a
  tolerant regex extraction rather than strict `JSON.parse`.
- Tested against known-good pages too (not just the hard case) to check for regressions: on the
  page that previously had 15 real transcribed lines, this found 29 boxes -- investigated the
  discrepancy by visualizing with numbered, size-coded overlays rather than assuming either number
  was "right." Found the real explanation: several of the extra boxes are short pieces of text
  positioned to the right of a main line at the same height (the right margin) -- content the old
  row-projection approach is structurally blind to, since it only looks at horizontal strips and
  cannot tell two side-by-side pieces of text at the same height apart. Gemini, actually seeing the
  page in 2D, correctly finds them as separate regions.
- **User corrected the semantic interpretation** (Claude cannot read the actual Hebrew content and
  said so plainly rather than guessing further): most of these short regions are topic
  HEADINGS -- real structural content that should stay on its own line in the output, not margin
  asides to merge away -- and only one specific tiny region was an actual cross-out/rewrite.
  This invalidated the geometric "short width = margin note" heuristic outright (headings and a
  cross-out are both short, indistinguishable by size alone) and reframed classification as a
  content question only the model (or the user) can answer, not a geometry one.
- Extended the detection prompt to ask Gemini to also classify each region's `kind`
  (`line` / `heading` / `crossed_out`) using its own understanding of the actual content. Result:
  **headings correctly identified 6/6**, matching the user's correction exactly. But the specific
  cross-out region was not separately detected as its own box at all in this run (it fell inside a
  different, much wider main-line box instead) -- so the `crossed_out` label is unverified, not
  confirmed working, and reported to the user as exactly that rather than claimed as a win.
- **A separate, real, still-open finding**: the same identical image produced 29 boxes on one
  detection call and 27 on the next (temperature 0 on both) -- call-to-call consistency for this
  kind of spatial detection task is a real open question that matters before relying on it, not
  yet investigated further.
- **Not yet integrated into the app at all** -- this is still at the "does the raw idea work"
  research stage, run entirely through throwaway harnesses in `/tmp`, no changes to
  `lineSegmenter.js`, `main.js`, or any shipped file. Next steps when resuming: test cross-out
  detection reliability specifically (several repeated calls on the same known cross-out case),
  decide on call-to-call consistency handling (retry-until-stable? accept some variance?), then
  design how this would actually replace or supplement `segmentIntoLines()` in the real pipeline
  (a whole-page Gemini call before per-line transcription -- real quota/cost implications given the
  daily free-tier limit has already been hit twice this project).
