// Launches the real app under Playwright's Electron support, against a
// throwaway userData directory (see the HCS_TEST_USERDATA_DIR check at the
// top of src/main/main.js) so this never touches your real saved notes,
// settings, or API key. This is the Electron equivalent of a native app
// needing a custom debug harness to get real screenshots without OS
// permission prompts -- Electron already runs on Chromium, so Playwright
// can attach directly (no Accessibility/Screen Recording grant needed,
// same reasoning, different mechanism).
//
// Usage (see debug-example.js for a full walkthrough):
//   const { launchApp } = require('./debug-launch');
//   const { window, cleanup } = await launchApp();
//   await window.screenshot({ path: 'out.png' });
//   await cleanup();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const PROJECT_ROOT = path.join(__dirname, '..');

async function launchApp({ userDataDir, apiKeyFile, settings } = {}) {
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hcs-test-'));
  fs.mkdirSync(dir, { recursive: true });

  // Optional: seed a real, working profile for end-to-end testing (import,
  // transcribe) instead of just a fresh/empty one. Never pass a plaintext
  // API key here -- copy the already-encrypted `gemini-key.enc` file
  // itself (same trick used elsewhere in this project's testing: since it
  // stays encrypted the whole time, nothing ever sees the plaintext key).
  if (apiKeyFile) {
    fs.copyFileSync(apiKeyFile, path.join(dir, 'gemini-key.enc'));
  }
  if (settings) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  }

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT],
    env: { ...process.env, HCS_TEST_USERDATA_DIR: dir },
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return {
    app: electronApp,
    window,
    userDataDir: dir,
    async cleanup() {
      await electronApp.close();
    },
  };
}

module.exports = { launchApp };
