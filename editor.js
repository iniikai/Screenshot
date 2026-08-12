import { getShot, updateShot, addShot, notifyShotsChanged } from './db.js';
import { FORMATS, getSettings } from './settings.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toastEl = document.getElementById('toast');

const shotId = Number(new URLSearchParams(location.search).get('id'));
let baseBitmap = null;   // the original image, never mutated
let shot = null;
let ops = [];            // committed annotations, in image coordinates
let draft = null;        // op currently being drawn
let tool = 'pen';

document.querySelectorAll('.tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
  });
});

function style() {
  return {
    color: document.getElementById('color').value,
    width: Number(document.getElementById('width').value),
  };
}

// ---------- rendering ----------

function drawArrow(g, op) {
  const { x1, y1, x2, y2, width, color } = op;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, width * 3);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  g.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  g.closePath();
  g.fill();
}

function drawOp(g, op) {
  if (op.type === 'pen') {
    g.strokeStyle = op.color;
    g.lineWidth = op.width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    op.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  } else if (op.type === 'arrow') {
    drawArrow(g, op);
  } else if (op.type === 'rect') {
    g.strokeStyle = op.color;
    g.lineWidth = op.width;
    g.strokeRect(op.x1, op.y1, op.x2 - op.x1, op.y2 - op.y1);
  } else if (op.type === 'blur') {
    const x = Math.min(op.x1, op.x2);
    const y = Math.min(op.y1, op.y2);
    const w = Math.abs(op.x2 - op.x1);
    const h = Math.abs(op.y2 - op.y1);
    if (w < 2 || h < 2) return;
    // Pixelate: downscale the region from the base image, then upscale it back.
    const block = 14;
    const small = new OffscreenCanvas(Math.max(1, Math.round(w / block)), Math.max(1, Math.round(h / block)));
    small.getContext('2d').drawImage(baseBitmap, x, y, w, h, 0, 0, small.width, small.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
    g.imageSmoothingEnabled = true;
  }
}

function redraw() {
  ctx.drawImage(baseBitmap, 0, 0);
  for (const op of ops) drawOp(ctx, op);
  if (draft) drawOp(ctx, draft);
}

// ---------- pointer handling ----------

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    ((e.clientX - rect.left) / rect.width) * canvas.width,
    ((e.clientY - rect.top) / rect.height) * canvas.height,
  ];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = canvasPoint(e);
  const s = style();
  draft = tool === 'pen'
    ? { type: 'pen', points: [[x, y]], ...s }
    : { type: tool, x1: x, y1: y, x2: x, y2: y, ...s };
});

canvas.addEventListener('pointermove', (e) => {
  if (!draft) return;
  const [x, y] = canvasPoint(e);
  if (draft.type === 'pen') draft.points.push([x, y]);
  else {
    draft.x2 = x;
    draft.y2 = y;
  }
  redraw();
});

canvas.addEventListener('pointerup', () => {
  if (!draft) return;
  ops.push(draft);
  draft = null;
  redraw();
});

document.getElementById('undo').addEventListener('click', () => {
  ops.pop();
  redraw();
});

// ---------- save ----------

async function annotatedBlob() {
  redraw();
  const { format, quality } = await getSettings();
  const chosen = FORMATS[format] || FORMATS.png;
  return new Promise((resolve) => canvas.toBlob(resolve, chosen.mime, quality));
}

document.getElementById('save-over').addEventListener('click', async () => {
  const blob = await annotatedBlob();
  await updateShot(shotId, { blob });
  notifyShotsChanged();
  toast('Saved — returning to library…');
  setTimeout(() => { location.href = 'library.html'; }, 700);
});

document.getElementById('save-copy').addEventListener('click', async () => {
  const blob = await annotatedBlob();
  await addShot({
    blob,
    pageUrl: shot.pageUrl,
    tabTitle: `${shot.tabTitle} (annotated)`,
    width: canvas.width,
    height: canvas.height,
    kind: shot.kind,
  });
  notifyShotsChanged();
  toast('Copy saved — returning to library…');
  setTimeout(() => { location.href = 'library.html'; }, 700);
});

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  setTimeout(() => { toastEl.hidden = true; }, 2000);
}

// ---------- init ----------

(async () => {
  shot = await getShot(shotId);
  if (!shot) {
    document.querySelector('.stage').textContent = 'Screenshot not found.';
    return;
  }
  baseBitmap = await createImageBitmap(shot.blob);
  canvas.width = baseBitmap.width;
  canvas.height = baseBitmap.height;
  redraw();
})();
