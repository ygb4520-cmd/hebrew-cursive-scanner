const notesListEl = document.getElementById('notesList');
const detailPane = document.getElementById('detailPane');
const dropZone = document.getElementById('dropZone');
const importStatus = document.getElementById('importStatus');
const pickImageBtn = document.getElementById('pickImageBtn');
const refreshBtn = document.getElementById('refreshBtn');

const setupBanner = document.getElementById('setupBanner');
const setupBannerText = document.getElementById('setupBannerText');
const setupBannerBtn = document.getElementById('setupBannerBtn');

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const syncFolderPathEl = document.getElementById('syncFolderPath');
const chooseSyncFolderBtn = document.getElementById('chooseSyncFolderBtn');
const appVersionLabel = document.getElementById('appVersionLabel');

const updateBanner = document.getElementById('updateBanner');
const updateBannerText = document.getElementById('updateBannerText');
const updateBannerBtn = document.getElementById('updateBannerBtn');

let notes = [];
let activeNoteId = null;
let pendingUpdate = null;

// ---------------------------------------------------------------------------
// Setup / settings
// ---------------------------------------------------------------------------

async function refreshSetupBanner() {
  const [hasKey, settings] = await Promise.all([window.api.hasApiKey(), window.api.getSettings()]);
  const missing = [];
  if (!hasKey) missing.push('a Gemini API key');
  if (!settings.syncFolderPath) missing.push('a sync folder');

  if (missing.length === 0) {
    setupBanner.classList.add('hidden');
  } else {
    setupBannerText.textContent = `Setup needed: add ${missing.join(' and ')} in Settings before scanning notes.`;
    setupBanner.classList.remove('hidden');
  }
  return { hasKey, settings };
}

async function openSettings() {
  const { hasKey, settings } = await refreshSetupBanner();
  apiKeyStatus.textContent = hasKey ? 'A key is already saved on this machine.' : '';
  apiKeyStatus.classList.remove('error');
  apiKeyInput.value = '';
  syncFolderPathEl.textContent = settings.syncFolderPath || 'Not set';
  settingsModal.classList.remove('hidden');
  const version = await window.api.getAppVersion();
  appVersionLabel.textContent = `v${version}`;
}

settingsBtn.addEventListener('click', openSettings);
setupBannerBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
  refreshSetupBanner();
});

saveApiKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyStatus.textContent = 'Paste a key first.';
    apiKeyStatus.classList.add('error');
    return;
  }
  try {
    await window.api.setApiKey(key);
    apiKeyInput.value = '';
    apiKeyStatus.textContent = 'Saved and encrypted on this machine.';
    apiKeyStatus.classList.remove('error');
    refreshSetupBanner();
  } catch (err) {
    apiKeyStatus.textContent = `Could not save key: ${err.message}`;
    apiKeyStatus.classList.add('error');
  }
});

chooseSyncFolderBtn.addEventListener('click', async () => {
  const chosen = await window.api.chooseSyncFolder();
  if (chosen) {
    syncFolderPathEl.textContent = chosen;
    refreshSetupBanner();
    loadNotes();
  }
});

// ---------------------------------------------------------------------------
// Import flow
// ---------------------------------------------------------------------------

function setImporting(isImporting, message) {
  pickImageBtn.disabled = isImporting;
  importStatus.textContent = message || '';
  importStatus.classList.toggle('error', false);
}

function progressMessage(progress) {
  switch (progress.phase) {
    case 'segmenting':
      return 'Finding lines of text…';
    case 'whole-page':
      return 'Could not confidently split into lines — transcribing the whole page…';
    case 'transcribing':
      return `Transcribing line ${progress.done}/${progress.total}…`;
    default:
      return 'Transcribing…';
  }
}

window.api.onImportProgress((progress) => {
  importStatus.textContent = progressMessage(progress);
});

async function importFromPath(filePath, rotationDegrees, cropBox) {
  setImporting(true, 'Finding lines of text…');
  try {
    const note = await window.api.createNoteFromFile(filePath, rotationDegrees, cropBox);
    await loadNotes();
    selectNote(note.id);
    setImporting(false, 'Done.');
  } catch (err) {
    setImporting(false);
    importStatus.textContent = `Import failed: ${err.message}`;
    importStatus.classList.add('error');
  }
}

// ---------------------------------------------------------------------------
// Preview + rotate (some real photos carry no EXIF orientation at all, so
// this can't be fully automatic -- confirmed with a real iPad photo)
// ---------------------------------------------------------------------------

const previewModal = document.getElementById('previewModal');
const previewImage = document.getElementById('previewImage');
const cropBoxEl = document.getElementById('cropBox');
const rotateLeftBtn = document.getElementById('rotateLeftBtn');
const rotateRightBtn = document.getElementById('rotateRightBtn');
const resetCropBtn = document.getElementById('resetCropBtn');
const cancelPreviewBtn = document.getElementById('cancelPreviewBtn');
const confirmTranscribeBtn = document.getElementById('confirmTranscribeBtn');

const FULL_CROP = { left: 0, top: 0, right: 1, bottom: 1 };
const MIN_CROP_SIZE = 0.08; // fraction, avoids collapsing the box to nothing

let pendingFilePath = null;
let pendingRotation = 0;
let pendingCrop = { ...FULL_CROP };
let suggestedCrop = null; // what "Reset Crop" goes back to

function renderCropBox() {
  // Position the overlay box in on-screen pixels relative to the image's
  // actual rendered size (which may be scaled down from its natural size).
  const w = previewImage.clientWidth;
  const h = previewImage.clientHeight;
  cropBoxEl.style.left = `${pendingCrop.left * w}px`;
  cropBoxEl.style.top = `${pendingCrop.top * h}px`;
  cropBoxEl.style.width = `${(pendingCrop.right - pendingCrop.left) * w}px`;
  cropBoxEl.style.height = `${(pendingCrop.bottom - pendingCrop.top) * h}px`;
}

async function refreshPreviewImage() {
  const result = await window.api.getImagePreview(pendingFilePath, pendingRotation);
  suggestedCrop = result.suggestedCrop || FULL_CROP;
  pendingCrop = { ...suggestedCrop };
  await new Promise((resolve) => {
    previewImage.onload = resolve;
    previewImage.src = result.dataUrl;
  });
  renderCropBox();
}

async function openPreview(filePath) {
  pendingFilePath = filePath;
  pendingRotation = 0;
  previewModal.classList.remove('hidden');
  try {
    await refreshPreviewImage();
  } catch (err) {
    previewModal.classList.add('hidden');
    importStatus.textContent = `Could not preview photo: ${err.message}`;
    importStatus.classList.add('error');
  }
}

function closePreview() {
  previewModal.classList.add('hidden');
  pendingFilePath = null;
}

rotateLeftBtn.addEventListener('click', async () => {
  pendingRotation = (pendingRotation - 90 + 360) % 360;
  await refreshPreviewImage();
});
rotateRightBtn.addEventListener('click', async () => {
  pendingRotation = (pendingRotation + 90) % 360;
  await refreshPreviewImage();
});
resetCropBtn.addEventListener('click', () => {
  pendingCrop = { ...(suggestedCrop || FULL_CROP) };
  renderCropBox();
});
cancelPreviewBtn.addEventListener('click', closePreview);
confirmTranscribeBtn.addEventListener('click', async () => {
  const filePath = pendingFilePath;
  const rotation = pendingRotation;
  const crop = pendingCrop;
  closePreview();
  await importFromPath(filePath, rotation, crop);
});

// ---- Crop box dragging (resize via corner handles, move via the box itself) ----

function clientToFraction(clientX, clientY) {
  const rect = previewImage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

cropBoxEl.querySelectorAll('.crop-handle').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const corner = handle.dataset.corner;
    const fixedX = corner.includes('w') ? pendingCrop.right : pendingCrop.left;
    const fixedY = corner.includes('n') ? pendingCrop.bottom : pendingCrop.top;

    function onMove(moveEvent) {
      const { x, y } = clientToFraction(moveEvent.clientX, moveEvent.clientY);
      if (corner.includes('w')) {
        pendingCrop.left = Math.min(x, fixedX - MIN_CROP_SIZE);
        pendingCrop.right = fixedX;
      } else {
        pendingCrop.right = Math.max(x, fixedX + MIN_CROP_SIZE);
        pendingCrop.left = fixedX;
      }
      if (corner.includes('n')) {
        pendingCrop.top = Math.min(y, fixedY - MIN_CROP_SIZE);
        pendingCrop.bottom = fixedY;
      } else {
        pendingCrop.bottom = Math.max(y, fixedY + MIN_CROP_SIZE);
        pendingCrop.top = fixedY;
      }
      renderCropBox();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

cropBoxEl.addEventListener('mousedown', (e) => {
  if (e.target !== cropBoxEl) return; // a handle's own listener handles that case
  e.preventDefault();
  const start = clientToFraction(e.clientX, e.clientY);
  const startCrop = { ...pendingCrop };
  const width = startCrop.right - startCrop.left;
  const height = startCrop.bottom - startCrop.top;

  function onMove(moveEvent) {
    const { x, y } = clientToFraction(moveEvent.clientX, moveEvent.clientY);
    let dx = x - start.x;
    let dy = y - start.y;
    dx = Math.max(-startCrop.left, Math.min(1 - startCrop.right, dx));
    dy = Math.max(-startCrop.top, Math.min(1 - startCrop.bottom, dy));
    pendingCrop = {
      left: startCrop.left + dx,
      right: startCrop.right + dx,
      top: startCrop.top + dy,
      bottom: startCrop.bottom + dy,
    };
    renderCropBox();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

pickImageBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.api.pickImage();
    if (filePath) await openPreview(filePath);
  } catch (err) {
    importStatus.textContent = `Could not open file picker: ${err.message}`;
    importStatus.classList.add('error');
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const filePath = window.api.getPathForFile(file);
  if (!filePath) {
    importStatus.textContent = 'Could not resolve a file path for the dropped item.';
    importStatus.classList.add('error');
    return;
  }
  await openPreview(filePath);
});

// ---------------------------------------------------------------------------
// Notes list + detail
// ---------------------------------------------------------------------------

refreshBtn.addEventListener('click', loadNotes);

async function loadNotes() {
  notes = await window.api.listNotes();
  renderNotesList();
  if (activeNoteId && !notes.find((n) => n.id === activeNoteId)) {
    activeNoteId = null;
    renderDetailPlaceholder();
  }
}

function renderNotesList() {
  notesListEl.innerHTML = '';
  for (const note of notes) {
    const li = document.createElement('li');
    li.className = 'note-item' + (note.id === activeNoteId ? ' active' : '');
    const snippet = document.createElement('div');
    snippet.className = 'note-snippet';
    snippet.textContent = (note.text || '').slice(0, 60) || '(empty)';
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = `${formatTimestamp(note.timestamp)} · ${note.sourceMachine || ''}`;
    li.appendChild(snippet);
    li.appendChild(meta);
    li.addEventListener('click', () => selectNote(note.id));
    notesListEl.appendChild(li);
  }
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || '';
  }
}

function renderDetailPlaceholder() {
  detailPane.innerHTML = '<p class="muted placeholder">Select or create a note to see it here.</p>';
}

async function confirmDelete(id) {
  const ok = window.confirm(
    'Delete this note? It will be moved to the trash/recycle bin (recoverable), not permanently erased.'
  );
  if (!ok) return;

  try {
    await window.api.deleteNote(id);
    if (activeNoteId === id) {
      activeNoteId = null;
      renderDetailPlaceholder();
    }
    await loadNotes();
  } catch (err) {
    alert(`Could not delete note: ${err.message}`);
  }
}

function selectNote(id) {
  activeNoteId = id;
  renderNotesList();
  const note = notes.find((n) => n.id === id);
  if (!note) return renderDetailPlaceholder();

  detailPane.innerHTML = '';

  const img = document.createElement('img');
  img.className = 'detail-photo';
  img.src = `file://${encodeURI(note.photoPath)}`;
  detailPane.appendChild(img);

  const textarea = document.createElement('textarea');
  textarea.className = 'detail-text';
  textarea.value = note.text || '';
  detailPane.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-primary';
  copyBtn.textContent = 'Copy to Clipboard';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(textarea.value);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy to Clipboard'), 1500);
  });
  actions.appendChild(copyBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = 'Save Edits';
  saveBtn.addEventListener('click', async () => {
    await window.api.updateNoteText(note.id, textarea.value);
    note.text = textarea.value;
    renderNotesList();
    saveBtn.textContent = 'Saved!';
    setTimeout(() => (saveBtn.textContent = 'Save Edits'), 1500);
  });
  actions.appendChild(saveBtn);

  const revealBtn = document.createElement('button');
  revealBtn.className = 'btn-secondary';
  revealBtn.textContent = 'Show Photo File';
  revealBtn.addEventListener('click', () => window.api.revealInFolder(note.photoPath));
  actions.appendChild(revealBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger';
  deleteBtn.textContent = 'Delete Note';
  deleteBtn.addEventListener('click', () => confirmDelete(note.id));
  actions.appendChild(deleteBtn);

  detailPane.appendChild(actions);
}

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------

async function checkForUpdate() {
  try {
    const result = await window.api.checkForUpdate();
    if (result.available) {
      pendingUpdate = result;
      updateBannerText.textContent = `A new version (v${result.version}) is available.`;
      updateBanner.classList.remove('hidden');
    }
  } catch {
    // Offline or GitHub unreachable — fail silently, not worth bothering the user.
  }
}

updateBannerBtn.addEventListener('click', async () => {
  if (!pendingUpdate) return;
  updateBannerBtn.disabled = true;
  updateBannerText.textContent = `Downloading v${pendingUpdate.version}… the app will restart automatically.`;
  try {
    await window.api.applyUpdate(pendingUpdate.assetUrl);
    // On success the main process quits this instance and relaunches the
    // new one — nothing left to do here.
  } catch (err) {
    updateBannerBtn.disabled = false;
    updateBannerText.textContent = `Update failed: ${err.message}`;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async function init() {
  await refreshSetupBanner();
  await loadNotes();
  checkForUpdate();
})();
