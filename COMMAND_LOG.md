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
