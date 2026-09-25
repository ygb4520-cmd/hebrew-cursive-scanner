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
const segApiKeyInput = document.getElementById('segApiKeyInput');
const saveSegApiKeyBtn = document.getElementById('saveSegApiKeyBtn');
const segApiKeyStatus = document.getElementById('segApiKeyStatus');
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

  const hasSegKey = await window.api.hasSegmentationApiKey();
  segApiKeyStatus.textContent = hasSegKey
    ? 'A dedicated key is saved on this machine.'
    : 'Not set — currently reusing the transcription key above.';
  segApiKeyStatus.classList.remove('error');
  segApiKeyInput.value = '';

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

saveSegApiKeyBtn.addEventListener('click', async () => {
  const key = segApiKeyInput.value.trim();
  if (!key) {
    segApiKeyStatus.textContent = 'Paste a key first.';
    segApiKeyStatus.classList.add('error');
    return;
  }
  try {
    await window.api.setSegmentationApiKey(key);
    segApiKeyInput.value = '';
    segApiKeyStatus.textContent = 'Saved and encrypted on this machine.';
    segApiKeyStatus.classList.remove('error');
  } catch (err) {
    segApiKeyStatus.textContent = `Could not save key: ${err.message}`;
    segApiKeyStatus.classList.add('error');
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

// ---------------------------------------------------------------------------
// Note detail: side-by-side photo (zoomable/pannable) + text, with
// hover-a-word-to-see-it-on-the-photo highlighting.
//
// Word-level precision is best-effort: Hebrew cursive letters are mostly
// disconnected, so the local ink-cluster count computed from the photo
// (see lineSegmenter.js) frequently doesn't match the number of words
// Gemini actually transcribed for that line. When it matches, hovering a
// word highlights exactly that ink cluster. When it doesn't, the highlight
// falls back to an approximate position (proportional placement among the
// clusters that were found) within a precise line-height band -- not a
// promise of the exact word, just a narrowed-down area instead of the
// whole line every time.
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

function computeHighlightBox(note, lineIndex, wordIndex, lineTokenCounts) {
  const lineBoxes = note.lineBoxes;
  if (!lineBoxes || !lineBoxes[lineIndex]) return null;
  const line = lineBoxes[lineIndex];
  const wordBoxes = line.wordBoxes;
  const tokenCount = lineTokenCounts[lineIndex] || 0;

  if (!wordBoxes || wordBoxes.length === 0 || tokenCount === 0) {
    return { x0: 0, x1: 1, y0: line.top, y1: line.bottom };
  }
  if (wordBoxes.length === tokenCount) {
    return { x0: wordBoxes[wordIndex].left, x1: wordBoxes[wordIndex].right, y0: line.top, y1: line.bottom };
  }
  const boxIndex = Math.min(wordBoxes.length - 1, Math.floor((wordIndex / tokenCount) * wordBoxes.length));
  return { x0: wordBoxes[boxIndex].left, x1: wordBoxes[boxIndex].right, y0: line.top, y1: line.bottom };
}

// Renders `note.text` into `container` as hoverable per-word spans, and
// returns the word-count of each line (needed by computeHighlightBox to
// decide exact-vs-approximate matching; recomputed on every render since
// the user can edit the text, which can change word counts per line).
function renderWordSpans(container, note) {
  container.innerHTML = '';
  const lines = (note.text || '').split('\n');
  const lineTokenCounts = [];
  lines.forEach((lineText, lineIndex) => {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'text-line';
    const tokens = lineText.split(/\s+/).filter(Boolean);
    lineTokenCounts.push(tokens.length);
    if (tokens.length === 0) {
      lineDiv.innerHTML = '&nbsp;';
    } else {
      tokens.forEach((tok, wordIndex) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = tok;
        span.dataset.line = String(lineIndex);
        span.dataset.word = String(wordIndex);
        lineDiv.appendChild(span);
        if (wordIndex < tokens.length - 1) lineDiv.appendChild(document.createTextNode(' '));
      });
    }
    container.appendChild(lineDiv);
  });
  return lineTokenCounts;
}

function selectNote(id) {
  activeNoteId = id;
  renderNotesList();
  const note = notes.find((n) => n.id === id);
  if (!note) return renderDetailPlaceholder();

  detailPane.innerHTML = '';

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let imgBaseWidth = 0;
  let imgBaseHeight = 0;
  let editing = false;
  let lineTokenCounts = [];

  const split = document.createElement('div');
  split.className = 'detail-split';
  detailPane.appendChild(split);

  // ---- Photo pane: zoom + pan ----
  const photoPane = document.createElement('div');
  photoPane.className = 'detail-photo-pane';
  split.appendChild(photoPane);

  const toolbar = document.createElement('div');
  toolbar.className = 'photo-toolbar';
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.className = 'btn-secondary';
  zoomOutBtn.textContent = '−';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'zoom-label';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.className = 'btn-secondary';
  zoomInBtn.textContent = '+';
  const zoomResetBtn = document.createElement('button');
  zoomResetBtn.className = 'btn-secondary';
  zoomResetBtn.textContent = 'Reset';
  toolbar.append(zoomOutBtn, zoomLabel, zoomInBtn, zoomResetBtn);
  photoPane.appendChild(toolbar);

  const viewport = document.createElement('div');
  viewport.className = 'photo-viewport';
  photoPane.appendChild(viewport);

  const content = document.createElement('div');
  content.className = 'photo-content';
  viewport.appendChild(content);

  const img = document.createElement('img');
  img.className = 'detail-photo';
  content.appendChild(img);

  const highlight = document.createElement('div');
  highlight.className = 'word-highlight';
  highlight.hidden = true;
  content.appendChild(highlight);

  function applyTransform() {
    content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function zoomAtViewportPoint(cx, cy, factor) {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const contentX = (cx - panX) / zoom;
    const contentY = (cy - panY) / zoom;
    panX = cx - contentX * newZoom;
    panY = cy - contentY * newZoom;
    zoom = newZoom;
    applyTransform();
  }

  zoomInBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAtViewportPoint(rect.width / 2, rect.height / 2, 1.25);
  });
  zoomOutBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAtViewportPoint(rect.width / 2, rect.height / 2, 1 / 1.25);
  });
  zoomResetBtn.addEventListener('click', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  });
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAtViewportPoint(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false }
  );
  viewport.addEventListener('mousedown', (e) => {
    e.preventDefault();
    viewport.classList.add('dragging');
    function onMove(moveEvent) {
      panX += moveEvent.movementX;
      panY += moveEvent.movementY;
      applyTransform();
    }
    function onUp() {
      viewport.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  img.onload = () => {
    const viewportWidth = viewport.clientWidth || 1;
    imgBaseWidth = viewportWidth;
    imgBaseHeight = viewportWidth * (img.naturalHeight / img.naturalWidth);
    img.style.width = `${imgBaseWidth}px`;
    img.style.height = `${imgBaseHeight}px`;
    content.style.width = `${imgBaseWidth}px`;
    content.style.height = `${imgBaseHeight}px`;
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };
  img.src = `file://${encodeURI(note.photoPath)}`;

  function showHighlight(box) {
    if (!box || !imgBaseWidth) return;
    highlight.style.left = `${box.x0 * imgBaseWidth}px`;
    highlight.style.top = `${box.y0 * imgBaseHeight}px`;
    highlight.style.width = `${(box.x1 - box.x0) * imgBaseWidth}px`;
    highlight.style.height = `${(box.y1 - box.y0) * imgBaseHeight}px`;
    highlight.hidden = false;
  }
  function hideHighlight() {
    highlight.hidden = true;
  }

  // ---- Text pane: hoverable word spans + edit toggle ----
  const textPane = document.createElement('div');
  textPane.className = 'detail-text-pane';
  split.appendChild(textPane);

  const textView = document.createElement('div');
  textView.className = 'detail-text-view';
  textView.dir = 'rtl';
  textPane.appendChild(textView);

  const textEdit = document.createElement('textarea');
  textEdit.className = 'detail-text';
  textEdit.hidden = true;
  textPane.appendChild(textEdit);

  function refreshTextView() {
    lineTokenCounts = renderWordSpans(textView, note);
  }
  refreshTextView();

  textView.addEventListener('mouseover', (e) => {
    const span = e.target.closest('.word');
    if (!span) return;
    const box = computeHighlightBox(note, Number(span.dataset.line), Number(span.dataset.word), lineTokenCounts);
    showHighlight(box);
  });
  textView.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.word')) return;
    hideHighlight();
  });

  if (!note.lineBoxes) {
    const note1 = document.createElement('p');
    note1.className = 'muted small';
    note1.textContent = 'Hover-to-highlight isn’t available for this note (it was transcribed as a whole page rather than line-by-line).';
    textPane.insertBefore(note1, textView);
  }

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  textPane.appendChild(actions);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary';
  editBtn.textContent = 'Edit Text';
  editBtn.addEventListener('click', () => {
    editing = !editing;
    if (editing) {
      textEdit.value = note.text || '';
      textView.hidden = true;
      textEdit.hidden = false;
      editBtn.textContent = 'Done Editing';
    } else {
      textView.hidden = false;
      textEdit.hidden = true;
      editBtn.textContent = 'Edit Text';
    }
  });
  actions.appendChild(editBtn);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-primary';
  copyBtn.textContent = 'Copy to Clipboard';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(editing ? textEdit.value : note.text || '');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy to Clipboard'), 1500);
  });
  actions.appendChild(copyBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = 'Save Edits';
  saveBtn.addEventListener('click', async () => {
    const newText = textEdit.value;
    await window.api.updateNoteText(note.id, newText);
    note.text = newText;
    renderNotesList();
    refreshTextView();
    editing = false;
    textView.hidden = false;
    textEdit.hidden = true;
    editBtn.textContent = 'Edit Text';
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
