// Lightweight self-updater that doesn't rely on Electron's built-in
// autoUpdater (which needs a paid Apple code-signing certificate to work
// reliably on macOS). Instead: check GitHub's public Releases API for a
// newer version, download the right asset for this platform, and install it
// ourselves.
//
// Mac: installs into ~/Applications (per-user, no admin password needed —
// the system-wide /Applications folder requires admin rights this user
// doesn't have). Windows: just runs the NSIS installer, same as a manual
// install.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { execFile } = require('child_process');

const REPO = 'ygb4520-cmd/hebrew-cursive-scanner';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

function parseVersion(v) {
  return (v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

// Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  let response;
  try {
    response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    return { available: false }; // offline or GitHub unreachable — silently skip
  }
  if (!response.ok) return { available: false };

  const release = await response.json();
  const latestVersion = release.tag_name;
  const currentVersion = app.getVersion();

  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
    return { available: false };
  }

  const assets = release.assets || [];
  const asset =
    process.platform === 'darwin'
      ? assets.find((a) => a.name.endsWith('.zip'))
      : assets.find((a) => a.name.endsWith('.exe'));

  if (!asset) return { available: false }; // release exists but no build for this platform yet

  return {
    available: true,
    version: latestVersion.replace(/^v/, ''),
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    releaseUrl: release.html_url,
  };
}

// Streams the download instead of awaiting one big arrayBuffer() so
// progress can be reported as bytes actually arrive -- the previous
// version gave the UI no signal at all until the whole file was done.
async function downloadAsset(url, destPath, onProgress) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download update (${response.status})`);
  }
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress?.({ phase: 'downloading', receivedBytes, totalBytes });
  }
  fs.writeFileSync(destPath, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function applyMacUpdate(assetUrl, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcs-update-'));
  const zipPath = path.join(tmpDir, 'update.zip');
  await downloadAsset(assetUrl, zipPath, onProgress);
  onProgress?.({ phase: 'installing' });

  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  await run('/usr/bin/unzip', ['-o', '-q', zipPath, '-d', extractDir]);

  const entries = fs.readdirSync(extractDir);
  const appBundle = entries.find((e) => e.endsWith('.app'));
  if (!appBundle) throw new Error('Downloaded update did not contain a .app bundle.');

  const userAppsDir = path.join(os.homedir(), 'Applications');
  fs.mkdirSync(userAppsDir, { recursive: true });
  const destApp = path.join(userAppsDir, appBundle);
  const newAppSource = path.join(extractDir, appBundle);

  // Can't delete/replace our own running app bundle in-process -- Electron
  // memory-maps app.asar, so rm/cp on it while still running throws odd
  // low-level fs errors (confirmed live: ENOTDIR on app.asar). Same
  // constraint as Windows not letting a process overwrite its own .exe,
  // just a different failure mode. Spawn a detached helper that waits for
  // this process to fully exit, then swaps the bundle and relaunches.
  const helperPath = path.join(tmpDir, 'apply_update.sh');
  const helperScript = `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.5
done
rm -rf "${destApp}"
cp -R "${newAppSource}" "${destApp}"
open -n "${destApp}"
rm -rf "${tmpDir}"
`;
  fs.writeFileSync(helperPath, helperScript, { mode: 0o755 });

  const child = execFile('/bin/bash', [helperPath], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 300);
}

async function applyWindowsUpdate(assetUrl, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcs-update-'));
  const installerPath = path.join(tmpDir, 'update-installer.exe');
  await downloadAsset(assetUrl, installerPath, onProgress);
  onProgress?.({ phase: 'installing' });

  // Launch the installer detached, then quit — same as a manual install,
  // just without the user having to find/download it themselves.
  const child = execFile(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 500);
}

async function applyUpdate(assetUrl, onProgress) {
  if (process.platform === 'darwin') {
    await applyMacUpdate(assetUrl, onProgress);
  } else if (process.platform === 'win32') {
    await applyWindowsUpdate(assetUrl, onProgress);
  } else {
    throw new Error(`Self-update isn't supported on this platform (${process.platform}).`);
  }
}

module.exports = { checkForUpdate, applyUpdate, compareVersions };
