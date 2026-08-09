import { captureActiveTab } from './capture.js';
import { getAllShots, countShots } from './db.js';

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

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  try {
    await captureActiveTab(await currentTab());
    showStatus('Saved to library ✓', 'ok');
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

refresh();
