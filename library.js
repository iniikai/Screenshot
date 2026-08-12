import {
  getAllShots, getShot, deleteShots, restoreShots, updateShot, notifyShotsChanged,
} from './db.js';
import { hammingDistance } from './capture.js';
import { buildZip } from './zipper.js';
import { FORMATS, formatOf, getSettings, setSetting } from './settings.js';

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const noMatchEl = document.getElementById('no-match');
const template = document.getElementById('card-template');
const selectAllBox = document.getElementById('select-all');
const selectionCountEl = document.getElementById('selection-count');
const compareBtn = document.getElementById('compare');
const bulkRenameBtn = document.getElementById('bulk-rename');
const bulkDownloadBtn = document.getElementById('bulk-download');
const bulkDeleteBtn = document.getElementById('bulk-delete');
const searchInput = document.getElementById('search');
const siteFilter = document.getElementById('site-filter');
const storageMeter = document.getElementById('storage-meter');
const autoCleanSelect = document.getElementById('auto-clean');
const formatSelect = document.getElementById('format');
const formatNote = document.getElementById('format-note');
const autoCopyBox = document.getElementById('auto-copy');
const toastEl = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastUndo = document.getElementById('toast-undo');

let shots = [];        // everything in the library
let visible = [];      // after search/site filter
const selected = new Set();
const urlCache = new Map(); // shot id -> object URL, kept stable across renders
let toastTimer = null;
let pendingUndo = null; // records awaiting permanent deletion
let focusedIndex = -1;  // card the arrow keys are on

const KIND_LABELS = { fullpage: 'Full page', area: 'Area' };

// ---------- rendering ----------

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const site = siteFilter.value;
  visible = shots.filter((s) => {
    if (site && hostnameOf(s.pageUrl) !== site) return false;
    if (!q) return true;
    const tagHit = (s.tags || []).some((t) => `#${t}`.toLowerCase().includes(q) || t.toLowerCase().includes(q.replace(/^#/, '')));
    return (s.tabTitle || '').toLowerCase().includes(q)
      || (s.note || '').toLowerCase().includes(q)
      || (s.pageUrl || '').toLowerCase().includes(q)
      || tagHit;
  });
}

function refreshSiteFilter() {
  const current = siteFilter.value;
  const hosts = [...new Set(shots.map((s) => hostnameOf(s.pageUrl)).filter(Boolean))].sort();
  siteFilter.textContent = '';
  siteFilter.appendChild(new Option('All sites', ''));
  for (const h of hosts) siteFilter.appendChild(new Option(h, h));
  if (hosts.includes(current)) siteFilter.value = current;
}

function refreshStorageMeter() {
  const bytes = shots.reduce((sum, s) => sum + (s.blob?.size || 0), 0);
  const mb = bytes / (1024 * 1024);
  const size = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
  storageMeter.textContent = shots.length
    ? `${shots.length} shot${shots.length === 1 ? '' : 's'} · ${size}`
    : '';
}

function markDuplicates() {
  // Compare each shot against earlier (older) shots; flag near-identical ones.
  const seen = [];
  for (const shot of [...shots].sort((a, b) => a.createdAt - b.createdAt)) {
    shot.isDuplicate = shot.hash
      ? seen.some((h) => hammingDistance(h, shot.hash) <= 4)
      : false;
    if (shot.hash) seen.push(shot.hash);
  }
}

function urlFor(shot) {
  let url = urlCache.get(shot.id);
  if (!url) {
    url = URL.createObjectURL(shot.blob);
    urlCache.set(shot.id, url);
  }
  return url;
}

async function render() {
  shots = await getAllShots();
  markDuplicates();
  refreshSiteFilter();
  refreshStorageMeter();
  applyFilters();

  // Drop selections and cached URLs for shots that no longer exist.
  const ids = new Set(shots.map((s) => s.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  for (const [id, url] of urlCache) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }

  grid.textContent = '';
  emptyEl.hidden = shots.length > 0;
  noMatchEl.hidden = !(shots.length > 0 && visible.length === 0);

  for (const shot of visible) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = shot.id;

    const url = urlFor(shot);
    const img = card.querySelector('.thumb');
    img.src = url;
    img.addEventListener('click', () => openLightbox(url));

    // Lets the screenshot be dragged straight into Slack, Figma, an email…
    img.addEventListener('dragstart', (e) => {
      const name = filenameFor(shot, true);
      e.dataTransfer.setData('DownloadURL', `${shot.blob.type}:${name}:${url}`);
      e.dataTransfer.effectAllowed = 'copy';
    });

    const kindBadge = card.querySelector('.kind-badge');
    if (KIND_LABELS[shot.kind]) {
      kindBadge.textContent = KIND_LABELS[shot.kind];
      kindBadge.hidden = false;
    }
    card.querySelector('.dup-badge').hidden = !shot.isDuplicate;

    card.querySelector('.card-title').textContent = shot.tabTitle || 'Untitled';
    card.querySelector('.card-title').title = shot.tabTitle || '';
    if (shot.note) {
      const note = card.querySelector('.card-note');
      note.textContent = shot.note;
      note.title = shot.note;
      note.hidden = false;
    }
    const when = new Date(shot.createdAt).toLocaleString();
    const ext = formatOf(shot.blob).ext.toUpperCase();
    card.querySelector('.card-meta').textContent = `${when} · ${shot.width}×${shot.height} · ${ext}`;
    card.querySelector('.card-meta').title = shot.pageUrl || '';

    const tagRow = card.querySelector('.card-tags');
    for (const tag of shot.tags || []) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = `#${tag}`;
      chip.title = 'Click to remove this tag';
      chip.addEventListener('click', () => removeTag(shot.id, tag));
      tagRow.appendChild(chip);
    }

    const box = card.querySelector('.select-box');
    box.checked = selected.has(shot.id);
    card.classList.toggle('selected', box.checked);
    box.addEventListener('change', () => {
      if (box.checked) selected.add(shot.id);
      else selected.delete(shot.id);
      card.classList.toggle('selected', box.checked);
      updateSelectionUi();
    });

    card.querySelector('.act-copy').addEventListener('click', () => copyShot(shot.id));
    card.querySelector('.act-download').addEventListener('click', () => downloadShot(shot.id));
    card.querySelector('.act-edit').addEventListener('click', () => {
      location.href = `editor.html?id=${shot.id}`;
    });
    card.querySelector('.act-rename').addEventListener('click', () => renameShot(shot.id));
    card.querySelector('.act-tag').addEventListener('click', () => addTag(shot.id));
    card.querySelector('.act-delete').addEventListener('click', () => removeShots([shot.id]));

    grid.appendChild(card);
  }

  if (focusedIndex >= visible.length) focusedIndex = visible.length - 1;
  updateSelectionUi();
}

function updateSelectionUi() {
  const n = selected.size;
  selectionCountEl.textContent = n ? `${n} selected` : '';
  bulkRenameBtn.disabled = n === 0;
  bulkDownloadBtn.disabled = n === 0;
  bulkDeleteBtn.disabled = n === 0;
  compareBtn.disabled = n !== 2;
  selectAllBox.checked = visible.length > 0 && n === visible.length;
  selectAllBox.indeterminate = n > 0 && n < visible.length;
}

// ---------- per-item actions ----------

async function copyShot(id) {
  const shot = await getShot(id);
  if (!shot) return;
  try {
    // The clipboard only takes PNG, so anything saved as WebP or JPEG has to be
    // converted on the way out.
    let blob = shot.blob;
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      blob = await canvas.convertToBlob({ type: 'image/png' });
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied to clipboard');
  } catch (err) {
    toast(`Copy failed: ${err.message}`);
  }
}

function filenameFor(shot, inZip = false) {
  const stamp = new Date(shot.createdAt)
    .toISOString()
    .replace(/[:T]/g, '-')
    .slice(0, 19);
  const title = (shot.tabTitle || 'screenshot')
    .replace(/[^\p{L}\p{N}-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'screenshot';
  const name = `${stamp}_${title}.${formatOf(shot.blob).ext}`;
  return inZip ? name : `screenshot-stash/${name}`;
}

async function downloadShot(id) {
  const shot = await getShot(id);
  if (!shot) return;
  const url = URL.createObjectURL(shot.blob);
  try {
    await chrome.downloads.download({ url, filename: filenameFor(shot) });
  } finally {
    // Give the download manager a moment to grab the blob before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

async function renameShot(id) {
  const shot = await getShot(id);
  if (!shot) return;
  const answer = await askDialog({
    title: 'Rename screenshot',
    label1: 'Name',
    value1: shot.tabTitle || '',
    label2: 'Note (optional)',
    value2: shot.note || '',
  });
  if (!answer) return;
  await updateShot(id, { tabTitle: answer.v1.trim() || shot.tabTitle, note: answer.v2.trim() });
  await render();
  toast('Renamed');
}

async function addTag(id) {
  const answer = await askDialog({
    title: 'Add a tag',
    label1: 'Tag',
    value1: '',
    hint: 'Letters, numbers and dashes. Search for it later with #tag.',
  });
  if (!answer) return;
  const clean = answer.v1.trim().replace(/^#/, '').replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 30);
  if (!clean) return;
  const shot = await getShot(id);
  if (!shot) return;
  const tags = [...new Set([...(shot.tags || []), clean])];
  await updateShot(id, { tags });
  await render();
}

async function removeTag(id, tag) {
  const shot = await getShot(id);
  if (!shot) return;
  await updateShot(id, { tags: (shot.tags || []).filter((t) => t !== tag) });
  await render();
}

// Instant delete with a 6-second undo window instead of a confirm dialog.
async function removeShots(ids) {
  await commitPendingUndo(); // only one undo batch at a time

  const records = [];
  for (const id of ids) {
    const shot = await getShot(id);
    if (shot) records.push(shot);
  }
  await deleteShots(ids);
  ids.forEach((id) => selected.delete(id));
  notifyShotsChanged();
  await render();

  pendingUndo = records;
  const label = ids.length === 1 ? 'Screenshot deleted' : `${ids.length} screenshots deleted`;
  toast(label, {
    undo: async () => {
      const toRestore = pendingUndo;
      pendingUndo = null;
      if (!toRestore) return;
      await restoreShots(toRestore);
      notifyShotsChanged();
      await render();
      toast('Restored');
    },
  });
}

async function commitPendingUndo() {
  pendingUndo = null;
}

// ---------- bulk actions ----------

selectAllBox.addEventListener('change', () => {
  selected.clear();
  if (selectAllBox.checked) visible.forEach((s) => selected.add(s.id));
  for (const card of grid.children) {
    const checked = selected.has(Number(card.dataset.id));
    card.querySelector('.select-box').checked = checked;
    card.classList.toggle('selected', checked);
  }
  updateSelectionUi();
});

bulkRenameBtn.addEventListener('click', async () => {
  const ids = visible.filter((s) => selected.has(s.id)).map((s) => s.id);
  if (!ids.length) return;
  const answer = await askDialog({
    title: `Rename ${ids.length} screenshot${ids.length === 1 ? '' : 's'}`,
    label1: 'Name them all',
    value1: '',
    label2: 'Note for all (optional)',
    value2: '',
    hint: `They get numbered in the order shown — "work" becomes work_1, work_2, work_3…`,
  });
  if (!answer) return;
  const base = answer.v1.trim();
  if (!base) return;
  const note = answer.v2.trim();

  const pad = String(ids.length).length;
  await Promise.all(
    ids.map((id, i) =>
      updateShot(id, {
        tabTitle: `${base}_${String(i + 1).padStart(pad, '0')}`,
        ...(note ? { note } : {}),
      }),
    ),
  );
  await render();
  toast(`Renamed ${ids.length} screenshot${ids.length === 1 ? '' : 's'}`);
});

bulkDownloadBtn.addEventListener('click', async () => {
  const ids = [...selected];
  for (const id of ids) {
    await downloadShot(id);
  }
  toast(`Downloading ${ids.length} screenshot${ids.length === 1 ? '' : 's'}`);
});

bulkDeleteBtn.addEventListener('click', () => removeShots([...selected]));

compareBtn.addEventListener('click', async () => {
  const [a, b] = [...selected];
  const overlay = document.getElementById('compare-overlay');
  document.getElementById('compare-a').src = urlCache.get(a) || '';
  document.getElementById('compare-b').src = urlCache.get(b) || '';
  overlay.hidden = false;
});
document.getElementById('compare-close').addEventListener('click', () => {
  document.getElementById('compare-overlay').hidden = true;
});

// ---------- settings menu ----------

const settingsToggle = document.getElementById('settings-toggle');
const settingsMenu = document.getElementById('settings-menu');

settingsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = settingsMenu.hidden;
  settingsMenu.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!settingsMenu.hidden && !settingsMenu.contains(e.target)) {
    settingsMenu.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
  }
});

// Chrome owns the shortcut editor; an extension cannot rebind keys itself, and
// a plain link to a chrome:// URL is blocked, so open it as a tab.
document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

document.getElementById('export-all').addEventListener('click', async () => {
  if (!shots.length) {
    toast('Nothing to export yet');
    return;
  }
  toast('Building zip…');
  const entries = [];
  const used = new Set();
  for (const shot of [...shots].sort((a, b) => a.createdAt - b.createdAt)) {
    let name = filenameFor(shot, true);
    while (used.has(name)) {
      const ext = formatOf(shot.blob).ext;
      name = name.replace(new RegExp(`\\.${ext}$`), `_${shot.id}.${ext}`);
    }
    used.add(name);
    entries.push({
      name,
      data: new Uint8Array(await shot.blob.arrayBuffer()),
      mtime: shot.createdAt,
    });
  }
  const zip = buildZip(entries);
  const url = URL.createObjectURL(zip);
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await chrome.downloads.download({ url, filename: `screenshot-stash/export-${stamp}.zip` });
    toast(`Exporting ${entries.length} screenshots as zip`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
});

// ---------- features dialog ----------

const featuresBackdrop = document.getElementById('features-backdrop');
document.getElementById('features').addEventListener('click', () => {
  featuresBackdrop.hidden = false;
});
document.getElementById('features-close').addEventListener('click', () => {
  featuresBackdrop.hidden = true;
});
featuresBackdrop.addEventListener('click', (e) => {
  if (e.target === featuresBackdrop) featuresBackdrop.hidden = true;
});

// ---------- filters & settings ----------

searchInput.addEventListener('input', () => render());
siteFilter.addEventListener('change', () => render());

autoCleanSelect.addEventListener('change', async () => {
  const days = Number(autoCleanSelect.value);
  await setSetting('autoDeleteDays', days);
  toast(days ? `Screenshots older than ${days} days will be auto-deleted` : 'Auto-delete turned off');
});

formatSelect.addEventListener('change', async () => {
  await setSetting('format', formatSelect.value);
  describeFormat();
  toast(`New screenshots will be saved as ${FORMATS[formatSelect.value].ext.toUpperCase()}`);
});

autoCopyBox.addEventListener('change', async () => {
  await setSetting('autoCopy', autoCopyBox.checked);
});

function describeFormat() {
  formatNote.textContent = formatSelect.value === 'png'
    ? 'Tall full-page captures can run to tens of megabytes as PNG.'
    : 'Roughly ten times smaller than PNG on photo-heavy pages. Existing screenshots are not changed.';
}

async function loadSettings() {
  for (const [key, f] of Object.entries(FORMATS)) {
    formatSelect.appendChild(new Option(f.label, key));
  }
  const { autoDeleteDays, format, autoCopy } = await getSettings();
  autoCleanSelect.value = String(autoDeleteDays);
  formatSelect.value = format;
  autoCopyBox.checked = autoCopy;
  describeFormat();
}

// ---------- keyboard navigation ----------

function focusCard(index) {
  const cards = [...grid.children];
  if (!cards.length) return;
  focusedIndex = Math.max(0, Math.min(index, cards.length - 1));
  cards[focusedIndex].focus();
  cards[focusedIndex].scrollIntoView({ block: 'nearest' });
}

function columnCount() {
  const cards = [...grid.children];
  if (cards.length < 2) return 1;
  const top = cards[0].offsetTop;
  const perRow = cards.findIndex((c) => c.offsetTop > top);
  return perRow === -1 ? cards.length : perRow;
}

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const dialogOpen = !document.getElementById('dialog-backdrop').hidden;
  if (typing || dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!visible.length) return;

  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columnCount(), ArrowUp: -columnCount() }[e.key];
  if (step !== undefined) {
    e.preventDefault();
    focusCard(focusedIndex < 0 ? 0 : focusedIndex + step);
    return;
  }
  if (focusedIndex < 0) return;
  const shot = visible[focusedIndex];
  if (!shot) return;

  if (e.key === ' ') {
    e.preventDefault();
    openLightbox(urlFor(shot));
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeShots([shot.id]);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const box = grid.children[focusedIndex].querySelector('.select-box');
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
  }
});

// ---------- welcome card ----------

async function maybeShowWelcome() {
  const params = new URLSearchParams(location.search);
  const { welcomeDismissed = false } = await chrome.storage.local.get('welcomeDismissed');
  const welcome = document.getElementById('welcome');
  welcome.hidden = !(params.get('welcome') === '1' && !welcomeDismissed);
  document.getElementById('welcome-dismiss').addEventListener('click', async () => {
    welcome.hidden = true;
    await chrome.storage.local.set({ welcomeDismissed: true });
  });
}

// ---------- misc ----------

// A small in-page prompt. window.prompt is blocked on extension pages, and this
// can ask for two things at once (a name and a note).
function askDialog({ title, label1, value1 = '', label2, value2 = '', hint = '' }) {
  const backdrop = document.getElementById('dialog-backdrop');
  const form = document.getElementById('dialog');
  const input1 = document.getElementById('dialog-input-1');
  const input2 = document.getElementById('dialog-input-2');
  const field2 = document.getElementById('dialog-field-2');

  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-label-1').textContent = label1;
  document.getElementById('dialog-label-2').textContent = label2 || '';
  document.getElementById('dialog-hint').textContent = hint;
  input1.value = value1;
  input2.value = value2;
  field2.hidden = !label2;
  backdrop.hidden = false;
  input1.focus();
  input1.select();

  return new Promise((resolve) => {
    const done = (result) => {
      backdrop.hidden = true;
      form.onsubmit = null;
      document.getElementById('dialog-cancel').onclick = null;
      backdrop.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      done({ v1: input1.value, v2: input2.value });
    };
    document.getElementById('dialog-cancel').onclick = () => done(null);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) done(null);
    };
    document.addEventListener('keydown', onKey, true);
  });
}

function toast(text, { undo } = {}) {
  toastText.textContent = text;
  toastUndo.hidden = !undo;
  toastUndo.onclick = undo
    ? () => {
        toastEl.hidden = true;
        undo();
      }
    : null;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
    if (undo) commitPendingUndo();
  }, undo ? 6000 : 2500);
}

function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  const img = document.createElement('img');
  img.src = url;
  overlay.appendChild(img);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      close();
    }
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// Refresh live when a new capture happens while this page is open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'shots-changed') render();
});

loadSettings();
maybeShowWelcome();
render();
