// Example / smoke-test for the debug-launch harness: launches the app
// against a fresh, empty profile (no API key, no sync folder configured),
// screenshots the initial state (should show the setup banner), opens
// Settings, and screenshots that too. Run directly to sanity-check the
// harness itself still works; copy the pattern for real one-off UI checks.
const path = require('path');
const fs = require('fs');
const { launchApp } = require('./debug-launch');

const OUT_DIR = path.join(__dirname, 'debug-out');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { window, userDataDir, cleanup } = await launchApp();
  console.log('launched against throwaway profile:', userDataDir);

  await window.screenshot({ path: path.join(OUT_DIR, '01-initial.png') });
  console.log('wrote 01-initial.png (expect: setup banner, no notes)');

  await window.click('#settingsBtn');
  await window.waitForTimeout(200);
  await window.screenshot({ path: path.join(OUT_DIR, '02-settings.png') });
  console.log('wrote 02-settings.png (expect: Settings modal open)');

  await cleanup();
  console.log('done');
})().catch((err) => {
  console.error('DEBUG_EXAMPLE_ERROR:', err);
  process.exit(1);
});
