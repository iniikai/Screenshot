import { captureActiveTab } from './capture.js';
import { getAllShots, countShots } from './db.js';

const captureBtn = document.getElementById('capture');
const statusEl = document.getElementById('status');
const recentEl = document.getElementById('recent');
const stripEl = document.getElementById('recent-strip');
const countEl = document.getElementById('count');

let objectUrls = [];

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  try {
    await captureActiveTab();
    showStatus('Saved to library ✓', 'ok');
    await refresh();
  } catch (err) {
    showStatus(err.message, 'err');
  } finally {
    captureBtn.disabled = false;
  }
});

// Full-page and area captures outlive the popup, so the background worker
// runs them; the badge flashes when they finish.
document.getElementById('capture-full').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'capture-full-page' });
  window.close();
});
document.getElementById('capture-area').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'capture-area' });
  window.close();
});

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
