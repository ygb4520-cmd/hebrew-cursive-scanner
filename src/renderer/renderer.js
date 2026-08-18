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

async function importFromPath(filePath) {
  setImporting(true, 'Transcribing with Gemini…');
  try {
    const note = await window.api.createNoteFromFile(filePath);
    await loadNotes();
    selectNote(note.id);
    setImporting(false, 'Done.');
  } catch (err) {
    setImporting(false);
    importStatus.textContent = `Import failed: ${err.message}`;
    importStatus.classList.add('error');
  }
}

pickImageBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.api.pickImage();
    if (filePath) await importFromPath(filePath);
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
  await importFromPath(filePath);
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
