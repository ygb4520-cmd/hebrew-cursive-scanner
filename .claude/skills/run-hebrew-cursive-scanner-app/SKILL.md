---
name: run-hebrew-cursive-scanner-app
description: How to launch and drive the real Hebrew Cursive Scanner Electron app for manual/visual testing -- clicking real buttons, seeing real rendered screenshots, importing real photos -- without ever touching the user's real saved notes, settings, or API key. Use this whenever asked to run, launch, test, screenshot, or "see" this app itself, not just its backend logic -- e.g. "does this look right in the app", "click through the crop UI and check it", "screenshot the note detail view after this change".
---

# Running the Hebrew Cursive Scanner app for visual testing

This is an Electron app (Chromium + Node, not a native app) -- so unlike a
native macOS app, no custom debug harness is needed to get real
screenshots without permission prompts. Electron already runs on
Chromium, and Playwright has first-class support for driving a real
Electron app directly (`playwright`'s `_electron` export): launch the
actual app, get its window as a normal Playwright page, click/type/read
the DOM, take screenshots -- all in-process over Electron's own
inspection protocol, no Accessibility or Screen Recording grant needed.

## 1. The isolation mechanism

`src/main/main.js` has a tiny, opt-in check at the very top:

```js
if (process.env.HCS_TEST_USERDATA_DIR) {
  app.setPath('userData', process.env.HCS_TEST_USERDATA_DIR);
}
```

Completely inert unless that env var is set -- a normal `npm start` or a
packaged install is entirely unaffected. When it *is* set, every path this
app reads/writes through `app.getPath('userData')` (settings.json, the
encrypted API key, Chromium's own profile/cache data) is redirected to a
throwaway directory instead of the real one. **Always use the harness
below rather than launching the app directly for any automated test** --
it sets this for you, so nothing automated can ever touch the real saved
notes, settings, or API key.

## 2. The harness

`scripts/debug-launch.js` exports `launchApp()`, which does the
launch-against-a-throwaway-profile part for you:

```js
const { launchApp } = require('./debug-launch');
const { window, userDataDir, cleanup } = await launchApp();

// window is a real Playwright Page for the app's actual BrowserWindow --
// use it exactly like any Playwright page.
await window.screenshot({ path: 'out.png' });
await window.click('#pickImageBtn');
const text = await window.textContent('#importStatus');

await cleanup(); // closes the app
```

Run any script that uses it with plain `node` from the project root (not
`npm start` -- that launches the real app for a human, not for driving):

```bash
node scripts/debug-example.js
```

`scripts/debug-example.js` is a working, runnable smoke test of the
harness itself -- launches against a fresh empty profile, screenshots the
initial state (setup banner, empty notes list) and the Settings modal.
Confirmed live: this actually opens the real window, actually clicks the
real Settings button, and the resulting screenshots show the real
rendered UI, version number included -- not a mock.

## 3. Testing with a real API key / real notes folder (end-to-end)

For anything past pure UI checks (importing a photo, watching real
transcription happen), the throwaway profile needs a working key and a
notes folder, same as a first-time real user would set up. **Never put a
plaintext API key in a test script or env var.** `launchApp()` accepts an
`apiKeyFile` option that copies the *already-encrypted* `gemini-key.enc`
file itself into the throwaway profile:

```js
const os = require('os');
const path = require('path');
const REAL_KEY = path.join(
  os.homedir(),
  'Library/Application Support/hebrew-cursive-scanner/gemini-key.enc'
);
const { window, cleanup } = await launchApp({
  apiKeyFile: REAL_KEY,
  settings: { syncFolderPath: '/path/to/a/throwaway/test/notes/folder' },
});
```

The key stays encrypted (Electron's `safeStorage`, backed by this Mac's
Keychain) the entire time -- copying the file never decrypts it, so
nothing in an automated test ever sees the plaintext key. Point
`syncFolderPath` at a scratch directory, never the user's real one.

## 4. Reading the DOM instead of just looking at pixels

A screenshot is for a human (or for you) to actually look at (`Read` the
PNG file, the same as any other image this session works with) and judge
visually -- layout, whether text is legible, whether a crop box lines up.
For checking *facts* (is this button disabled, what does this status line
say, how many notes are in the list), query the DOM directly instead of
eyeballing a screenshot -- more reliable and doesn't burn an image read:

```js
const noteCount = await window.$$eval('.note-item', (els) => els.length);
const bannerVisible = await window.isVisible('#setupBanner');
```

This project's own comparison tooling (the `Ktav Cross-Check` Artifact
work) hit exactly this distinction: a screenshot at low resolution looked
fine, but querying the actual rendered element geometry (`getBoundingClientRect`)
caught a real pixel-level overlap the screenshot was too coarse to show.
Prefer the DOM query when you need a precise, checkable fact; use a
screenshot when you genuinely need to *see* it.

## 5. Cleanup

`cleanup()` closes the Electron app. The throwaway `userDataDir` (a
fresh `os.tmpdir()` folder unless you passed your own) is left on disk --
harmless, OS-managed temp space, not inside the project -- but delete it
yourself if a specific test run's leftover state would confuse a later
one.
