// Shared user settings. Small enough for chrome.storage.local — the screenshots
// themselves live in IndexedDB.

export const FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG — lossless, biggest files' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP — much smaller, looks the same' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG — smallest, no transparency' },
};

const DEFAULTS = {
  format: 'png',
  quality: 0.92, // ignored for png
  autoDeleteDays: 0,
  autoCopy: false,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export function formatOf(blob) {
  return Object.values(FORMATS).find((f) => f.mime === blob?.type) || FORMATS.png;
}
