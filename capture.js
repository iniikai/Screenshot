// Capture flows. Used by both the popup (button click) and the background
// service worker (keyboard shortcut / long-running captures). All invocations
// start from a user gesture, so the "activeTab" permission is granted and no
// broad host permissions are needed.

import { addShot, getAllShots, notifyShotsChanged } from './db.js';

const CAPTURE_DELAY_MS = 600; // captureVisibleTab is rate-limited to ~2/sec
const MAX_FULL_PAGE_SEGMENTS = 20;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Callers that already know the tab (the popup) pass it in. The service worker
// has no "current window", so `currentWindow: true` would match nothing there —
// it has to anchor to the last focused browser window instead.
async function resolveTab(tab) {
  if (tab?.id != null) return tab;
  const [found] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!found) throw new Error('No active tab found.');
  return found;
}

async function grabVisible(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    // chrome://, the Web Store and other protected pages cannot be captured.
    if (/permission|access|cannot be scripted/i.test(err.message)) {
      throw new Error('This page cannot be captured (Chrome blocks capturing browser-internal pages).');
    }
    throw err;
  }
}

// 8x8 average hash for duplicate detection — cheap and good enough to flag
// "you captured this exact view twice".
async function averageHash(bitmap) {
  const canvas = new OffscreenCanvas(8, 8);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, 8, 8);
  const { data } = g.getImageData(0, 0, 8, 8);
  const gray = [];
  for (let i = 0; i < 64; i++) {
    gray.push(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  const avg = gray.reduce((a, b) => a + b, 0) / 64;
  return gray.map((v) => (v > avg ? '1' : '0')).join('');
}

export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function saveBitmapAsShot(bitmap, tab, kind) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const hash = await averageHash(bitmap);
  const id = await addShot({
    blob,
    pageUrl: tab.url || '',
    tabTitle: tab.title || 'Untitled',
    width: bitmap.width,
    height: bitmap.height,
    hash,
    kind,
  });
  bitmap.close();
  notifyShotsChanged();
  return id;
}

export async function captureActiveTab(fromTab) {
  const tab = await resolveTab(fromTab);
  const dataUrl = await grabVisible(tab.windowId);
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  return saveBitmapAsShot(bitmap, tab, 'visible');
}

// ---------- full-page capture: scroll, capture each segment, stitch ----------

function pageMetrics() {
  return {
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    viewportHeight: window.innerHeight,
    originalY: window.scrollY,
    dpr: window.devicePixelRatio,
  };
}

function scrollAndPin(y, hideFixed) {
  if (hideFixed) {
    // Fixed/sticky headers would repeat in every stitched segment — hide them
    // after the first one. Marked so they can be restored afterwards.
    for (const el of document.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && !el.dataset.stashHidden) {
        el.dataset.stashHidden = '1';
        el.style.visibility = 'hidden';
      }
    }
  }
  window.scrollTo(0, y);
}

function unpinAndRestore(y) {
  for (const el of document.querySelectorAll('[data-stash-hidden]')) {
    el.style.visibility = '';
    delete el.dataset.stashHidden;
  }
  window.scrollTo(0, y);
}

export async function captureFullPage(fromTab) {
  const tab = await resolveTab(fromTab);
  const [{ result: m }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageMetrics,
  });

  const segments = Math.min(Math.ceil(m.scrollHeight / m.viewportHeight), MAX_FULL_PAGE_SEGMENTS);
  const bitmaps = [];
  const offsets = [];
  try {
    for (let i = 0; i < segments; i++) {
      const y = Math.min(i * m.viewportHeight, m.scrollHeight - m.viewportHeight);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrollAndPin,
        args: [y, i > 0],
      });
      await sleep(CAPTURE_DELAY_MS);
      const dataUrl = await grabVisible(tab.windowId);
      bitmaps.push(await createImageBitmap(await (await fetch(dataUrl)).blob()));
      offsets.push(y);
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: unpinAndRestore,
      args: [m.originalY],
    }).catch(() => {});
  }

  const scale = bitmaps[0].height / m.viewportHeight; // device pixel ratio
  const totalHeight = Math.round(Math.min(m.scrollHeight, segments * m.viewportHeight) * scale);
  const canvas = new OffscreenCanvas(bitmaps[0].width, totalHeight);
  const g = canvas.getContext('2d');
  bitmaps.forEach((bmp, i) => g.drawImage(bmp, 0, Math.round(offsets[i] * scale)));
  bitmaps.forEach((bmp) => bmp.close());

  const stitched = await createImageBitmap(canvas);
  return saveBitmapAsShot(stitched, tab, 'fullpage');
}

// ---------- area capture: overlay selection, then crop ----------

function selectAreaOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,0.25)';
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;border:2px dashed #fff;background:rgba(37,99,235,0.15);display:none;pointer-events:none';
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    let sx = 0;
    let sy = 0;
    let dragging = false;

    const finish = (rect) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      // Let the page repaint without the overlay before the capture happens.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (e) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      box.style.display = 'block';
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${Math.abs(e.clientX - sx)}px`;
      box.style.height = `${Math.abs(e.clientY - sy)}px`;
    });
    overlay.addEventListener('mouseup', (e) => {
      const rect = {
        x: Math.min(sx, e.clientX),
        y: Math.min(sy, e.clientY),
        w: Math.abs(e.clientX - sx),
        h: Math.abs(e.clientY - sy),
        dpr: window.devicePixelRatio,
      };
      finish(rect.w > 4 && rect.h > 4 ? rect : null);
    });
  });
}

export async function captureArea(fromTab) {
  const tab = await resolveTab(fromTab);
  const [{ result: rect }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: selectAreaOverlay,
  });
  if (!rect) return null; // cancelled

  await sleep(150);
  const dataUrl = await grabVisible(tab.windowId);
  const full = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const cropped = await createImageBitmap(
    full,
    Math.round(rect.x * rect.dpr),
    Math.round(rect.y * rect.dpr),
    Math.max(1, Math.round(rect.w * rect.dpr)),
    Math.max(1, Math.round(rect.h * rect.dpr)),
  );
  full.close();
  return saveBitmapAsShot(cropped, tab, 'area');
}

// Flag near-identical captures so the library can badge them.
export async function findDuplicateOf(id) {
  const shots = await getAllShots();
  const target = shots.find((s) => s.id === id);
  if (!target?.hash) return null;
  const match = shots.find((s) => s.id !== id && hammingDistance(s.hash, target.hash) <= 4);
  return match ? match.id : null;
}
