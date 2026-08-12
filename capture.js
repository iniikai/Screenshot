// Capture flows. Used by both the popup (button click) and the background
// service worker (keyboard shortcut / long-running captures). All invocations
// start from a user gesture, so the "activeTab" permission is granted and no
// broad host permissions are needed.

import { addShot, getAllShots, notifyShotsChanged } from './db.js';
import { FORMATS, getSettings } from './settings.js';

const CAPTURE_DELAY_MS = 600; // captureVisibleTab is rate-limited to ~2/sec
const MAX_FULL_PAGE_SEGMENTS = 20;
// Chrome refuses to allocate a canvas taller than 32,767px. On a Retina screen
// a full-height viewport is ~1,700 device px, so twenty segments overshoot that
// and the stitch throws — which is how an endless feed turns into a red ✕.
const MAX_CANVAS_HEIGHT = 32000;

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

  // A tall full-page PNG runs to tens of megabytes; WebP and JPEG cut that by
  // roughly an order of magnitude on photo-heavy pages.
  const { format, quality } = await getSettings();
  const chosen = FORMATS[format] || FORMATS.png;
  const blob = await canvas.convertToBlob(
    chosen.mime === 'image/png' ? { type: 'image/png' } : { type: chosen.mime, quality },
  );
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
  const docHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);

  // Most web apps lock the document to the viewport and scroll an inner panel
  // instead, which makes the page look exactly one screen tall. When that
  // happens, find the biggest thing that actually scrolls and drive that.
  let scroller = null;
  if (docHeight <= window.innerHeight + 1) {
    let bestArea = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > bestArea) {
        bestArea = r.width * r.height;
        scroller = el;
      }
    }
  }

  // Smooth scrolling would animate under the capture and blur the seams.
  document.documentElement.style.scrollBehavior = 'auto';

  let rect = null;
  if (scroller) {
    scroller.dataset.stashScroller = '1';
    scroller.style.scrollBehavior = 'auto';
    const r = scroller.getBoundingClientRect();
    const cs = getComputedStyle(scroller);
    rect = {
      x: r.x + (parseFloat(cs.borderLeftWidth) || 0),
      y: r.y + (parseFloat(cs.borderTopWidth) || 0),
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    };
  }

  return {
    scrollHeight: scroller ? scroller.scrollHeight : docHeight,
    viewportHeight: scroller ? scroller.clientHeight : window.innerHeight,
    originalY: scroller ? scroller.scrollTop : window.scrollY,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    rect,
  };
}

// Returns where the page actually landed, which is not always where it was
// asked to go — infinite feeds move the ground underfoot, and a page that has
// stopped moving means there is nothing more to capture.
function scrollToOffset(y) {
  const scroller = document.querySelector('[data-stash-scroller]');
  if (scroller) {
    scroller.scrollTop = y;
    return scroller.scrollTop;
  }
  window.scrollTo(0, y);
  return window.scrollY;
}

// Feeds hang their images off lazy loading, so a fixed delay either wastes time
// on simple pages or captures half-loaded ones. Wait for the images actually on
// screen, with a ceiling so a single stalled request cannot hold up the capture.
function settleViewport() {
  const height = window.innerHeight;
  const pending = [...document.images].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < height && r.width > 0 && !img.complete;
  });
  const loaded = Promise.all(
    pending.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }),
    ),
  );
  return Promise.race([loaded, new Promise((r) => setTimeout(r, 1500))]).then(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

// Fixed/sticky headers would repeat in every stitched segment, so hide them
// on every segment after the first. This runs as its own step, well after the
// scroll: many sites (Google results among them) only pin their header from a
// scroll handler, and those fire asynchronously — checking any earlier sees
// the header still unpinned and walks straight past it.
function hidePinned() {
  for (const el of document.querySelectorAll('*')) {
    const pos = getComputedStyle(el).position;
    if ((pos === 'fixed' || pos === 'sticky') && !el.dataset.stashHidden && !el.dataset.stashScroller) {
      el.dataset.stashHidden = '1';
      el.style.visibility = 'hidden';
    }
  }
  // Let the page repaint without them before the capture is taken.
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function unpinAndRestore(y) {
  for (const el of document.querySelectorAll('[data-stash-hidden]')) {
    el.style.visibility = '';
    delete el.dataset.stashHidden;
  }
  const scroller = document.querySelector('[data-stash-scroller]');
  if (scroller) {
    scroller.scrollTop = y;
    scroller.style.scrollBehavior = '';
    delete scroller.dataset.stashScroller;
  } else {
    window.scrollTo(0, y);
  }
  document.documentElement.style.scrollBehavior = '';
}

export async function captureFullPage(fromTab) {
  const tab = await resolveTab(fromTab);
  const [{ result: m }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageMetrics,
  });

  const deviceSegmentHeight = m.viewportHeight * (m.dpr || 1);
  const fitsInCanvas = Math.max(1, Math.floor(MAX_CANVAS_HEIGHT / deviceSegmentHeight));
  const segments = Math.min(
    Math.ceil(m.scrollHeight / m.viewportHeight),
    MAX_FULL_PAGE_SEGMENTS,
    fitsInCanvas,
  );
  // Each segment is drawn into the canvas and released straight away. Holding
  // all twenty as bitmaps meant peak memory of twenty full-viewport images at
  // once, which is where a long feed on a modest machine runs out of room.
  let canvas = null;
  let g = null;
  let scale = 1;
  let filledTo = 0;
  let lastY = -1;
  try {
    for (let i = 0; i < segments; i++) {
      const target = Math.min(i * m.viewportHeight, m.scrollHeight - m.viewportHeight);
      const [{ result: y }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrollToOffset,
        args: [target],
      });
      // The page refused to go any further, so every remaining segment would
      // just repeat this one.
      if (i > 0 && y <= lastY + 1) break;
      lastY = y;

      // Lets scroll handlers run and lazy content start arriving.
      await sleep(CAPTURE_DELAY_MS);
      await chrome.scripting
        .executeScript({ target: { tabId: tab.id }, func: settleViewport })
        .catch(() => {});
      if (i > 0) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: hidePinned });
      }
      const dataUrl = await grabVisible(tab.windowId);
      const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());

      let piece = shot;
      if (m.rect) {
        // Only the scrolling panel advances between segments; everything around
        // it would repeat, so keep just the panel.
        const deviceScale = shot.height / m.innerHeight;
        piece = await createImageBitmap(
          shot,
          Math.round(m.rect.x * deviceScale),
          Math.round(m.rect.y * deviceScale),
          Math.max(1, Math.round(m.rect.width * deviceScale)),
          Math.max(1, Math.round(m.rect.height * deviceScale)),
        );
        shot.close();
      }

      if (!canvas) {
        scale = piece.height / m.viewportHeight; // actual device pixel ratio
        const planned = Math.round(Math.min(m.scrollHeight, segments * m.viewportHeight) * scale);
        canvas = new OffscreenCanvas(piece.width, Math.min(planned, MAX_CANVAS_HEIGHT));
        g = canvas.getContext('2d');
      }
      const top = Math.round(y * scale);
      g.drawImage(piece, 0, top);
      filledTo = Math.max(filledTo, Math.min(top + piece.height, canvas.height));
      piece.close();
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: unpinAndRestore,
      args: [m.originalY],
    }).catch(() => {});
  }

  if (!canvas) throw new Error('Nothing could be captured from this page.');

  // Trim to what was actually drawn. The loop stops early when the page runs
  // out of scroll, and the remainder would otherwise be blank.
  const stitched = await createImageBitmap(canvas, 0, 0, canvas.width, filledTo || canvas.height);
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
