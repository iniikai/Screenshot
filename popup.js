import { captureActiveTab } from './capture.js';
import { getAllShots, countShots, getShot } from './db.js';
import { getSettings } from './settings.js';

const captureBtn = document.getElementById('capture');
const statusEl = document.getElementById('status');
const recentEl = document.getElementById('recent');
const stripEl = document.getElementById('recent-strip');
const countEl = document.getElementById('count');

let objectUrls = [];

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Only the popup can do this. A service worker has no clipboard, so the
// full-page and area captures — which run there so they survive the popup
// closing — cannot copy themselves. Hence the narrow wording on the setting.
async function maybeCopy(id) {
  const { autoCopy } = await getSettings();
  if (!autoCopy || id == null) return false;
  try {
    const shot = await getShot(id);
    let blob = shot.blob;
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      blob = await canvas.convertToBlob({ type: 'image/png' });
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  try {
    const id = await captureActiveTab(await currentTab());
    showStatus(await maybeCopy(id) ? 'Saved and copied ✓' : 'Saved to library ✓', 'ok');
    await refresh();
  } catch (err) {
    showStatus(err.message, 'err');
  } finally {
    captureBtn.disabled = false;
  }
});

// Full-page and area captures outlive the popup, so the background worker runs
// them; the badge flashes when they finish. The worker can't resolve the tab on
// its own (no "current window" there), so hand it over. Wait for the ack before
// closing — an idle worker takes a moment to boot and the message is lost if
// the sending page disappears first.
async function startBackgroundCapture(type) {
  const tab = await currentTab();
  if (!tab) return;
  const message = { type, tab };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    await chrome.runtime.sendMessage(message).catch(() => {});
  }
  window.close();
}

document.getElementById('capture-full').addEventListener('click', () => startBackgroundCapture('capture-full-page'));
document.getElementById('capture-area').addEventListener('click', () => startBackgroundCapture('capture-area'));

document.getElementById('open-library').addEventListener('click', openLibrary);

function openLibrary() {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
  window.close();
}

function showStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

async function refresh() {
  const [shots, count] = await Promise.all([getAllShots(), countShots()]);
  countEl.textContent = count;

  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  stripEl.textContent = '';

  const recent = shots.slice(0, 4);
  recentEl.hidden = recent.length === 0;
  for (const shot of recent) {
    const url = URL.createObjectURL(shot.blob);
    objectUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.title = shot.tabTitle;
    img.addEventListener('click', openLibrary);
    stripEl.appendChild(img);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'shots-changed') refresh();
});

// Read the live bindings rather than hardcoding the defaults, so the hint stays
// honest after someone rebinds the keys in chrome://extensions/shortcuts.
async function showShortcuts() {
  const labels = {
    'capture-screenshot': 'this tab',
    'capture-full-page': 'full page',
    'capture-area': 'area',
  };
  const hint = document.getElementById('shortcut-hint');
  const bound = (await chrome.commands.getAll()).filter((c) => c.shortcut && labels[c.name]);
  if (!bound.length) return;

  const heading = document.createElement('div');
  heading.className = 'hint-heading';
  heading.textContent = 'Works anywhere';
  hint.append(heading);

  for (const command of bound) {
    const row = document.createElement('div');
    row.className = 'hint-row';
    const key = document.createElement('kbd');
    key.textContent = command.shortcut;
    const what = document.createElement('span');
    what.textContent = labels[command.name];
    row.append(key, what);
    hint.append(row);
  }
  hint.hidden = false;
}

refresh();
showShortcuts();
