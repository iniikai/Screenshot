import { captureActiveTab, captureFullPage, captureArea } from './capture.js';
import { countShots, deleteOlderThan, notifyShotsChanged } from './db.js';

async function refreshBadge() {
  const count = await countShots();
  await chrome.action.setBadgeBackgroundColor({ color: '#475569' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(refreshBadge, 1500);
}

async function runCapture(fn, tab) {
  try {
    const id = await fn(tab);
    if (id !== null) await flashBadge('+1', '#16a34a');
    await clearLastError();
    return { ok: true, id };
  } catch (err) {
    // A bare ✕ tells nobody anything. Put the reason where it can be found:
    // hovering the toolbar icon, and in the popup the next time it opens.
    console.warn('Capture failed:', err);
    await chrome.storage.local.set({
      lastError: { message: err.message || String(err), at: Date.now() },
    });
    await chrome.action.setTitle({ title: `Screenshot Stash — last capture failed: ${err.message}` });
    await flashBadge('✕', '#dc2626');
    return { ok: false, error: err.message };
  }
}

async function clearLastError() {
  await chrome.storage.local.remove('lastError');
  await chrome.action.setTitle({ title: 'Screenshot Stash' });
}

// Shortcuts are rebindable by the user at chrome://extensions/shortcuts. No tab
// is passed here — there is no popup to ask, so the capture resolves the last
// focused window itself.
const SHORTCUT_CAPTURES = {
  'capture-screenshot': captureActiveTab,
  'capture-full-page': captureFullPage,
  'capture-area': captureArea,
};

chrome.commands.onCommand.addListener((command) => {
  const capture = SHORTCUT_CAPTURES[command];
  if (capture) runCapture(capture);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'shots-changed') {
    refreshBadge();
    return;
  }
  // Long-running captures run here so they survive the popup closing. Ack
  // before starting: the popup waits for it, so a worker that was asleep is
  // provably awake and holding the message before the popup goes away.
  const capture = { 'capture-full-page': captureFullPage, 'capture-area': captureArea }[msg?.type];
  if (capture) {
    sendResponse({ started: true });
    runCapture(capture, msg.tab);
  }
});

// ---------- optional local auto-cleanup ----------

async function runCleanup() {
  const { autoDeleteDays = 0 } = await chrome.storage.local.get('autoDeleteDays');
  if (!autoDeleteDays) return;
  const removed = await deleteOlderThan(autoDeleteDays);
  if (removed) {
    notifyShotsChanged();
    refreshBadge();
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-cleanup') runCleanup();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create('auto-cleanup', { periodInMinutes: 12 * 60 });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('library.html?welcome=1') });
  }
  await refreshBadge();
});

// The MV3 service worker is terminated when idle; refresh at top level so the
// badge is correct on every worker startup, not just on install.
refreshBadge();
runCleanup();
