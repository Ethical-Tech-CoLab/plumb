/**
 * overlay.js — renders the metric grid, ruler and measurement annotations.
 *
 * Hard rule enforced here: the overlay is ALWAYS drawn on a separate canvas from
 * the archival image. Nothing in this module ever writes into the source pixels.
 */

import { applyHomography, buildMetricGrid, worldBoundsOfImage, invert3x3 } from './geometry.js';

const COLOURS = {
  minor: 'rgba(0, 229, 255, 0.35)',
  major: 'rgba(0, 229, 255, 0.85)',
  uncal: 'rgba(255, 255, 255, 0.28)',
  measure: '#ffd400',
  measureHalo: 'rgba(0,0,0,0.65)',
  target: '#ff4d6d',
  check: '#5df58a',
  text: '#ffffff',
};

export function clear(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Decide the overlay canvas's backing-store size for a given source.
 *
 * The overlay was only ever sized when a still was adopted, so during live
 * preview it kept the HTML default of 300x150. The grid was therefore drawn
 * into a small box floating in the middle of the stage rather than over the
 * picture — which reads as "the grid toggle does nothing in the viewfinder,
 * but the grid is in the photo".
 *
 * Matching the source's own pixel dimensions makes the canvas letterbox under
 * `max-width/max-height: 100%` exactly the way a <video> does, so the overlay
 * and the image stay registered without measuring any layout.
 *
 * Returns null when nothing needs to change, so callers can skip the resize —
 * assigning canvas.width clears the canvas even when the value is unchanged.
 */
export function overlayTargetSize({
  sourceWidth = 0,
  sourceHeight = 0,
  currentWidth = 0,
  currentHeight = 0,
} = {}) {
  if (!sourceWidth || !sourceHeight) return null;
  if (sourceWidth === currentWidth && sourceHeight === currentHeight) return null;
  return { width: sourceWidth, height: sourceHeight };
}

/** CAL-0: screen-space composition grid. Carries an explicit NOT TO SCALE stamp. */
export function drawCompositionGrid(ctx, { divisions = 3 } = {}) {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.strokeStyle = COLOURS.uncal;
  ctx.lineWidth = Math.max(1, w / 1400);
  ctx.setLineDash([6, 6]);
  for (let i = 1; i < divisions; i++) {
    const x = (w * i) / divisions;
    const y = (h * i) / divisions;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
  drawStamp(ctx, 'NOT TO SCALE — composition grid', '#ff4d6d');
}

/**
 * CAL-2+: real-world grid projected through the homography. On an oblique
 * photograph the lines correctly converge, which is itself the operator's cue
 * that the shot is not fronto-parallel.
 */
export function drawMetricGrid(ctx, H, { intervalMm = 100, majorEvery = 10, padding = 1.25 } = {}) {
  const { width: w, height: h } = ctx.canvas;
  const Hinv = invert3x3(H);
  const b = worldBoundsOfImage(Hinv, w, h);

  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const halfW = ((b.maxX - b.minX) / 2) * padding;
  const halfH = ((b.maxY - b.minY) / 2) * padding;

  const { lines } = buildMetricGrid(H, {
    worldBounds: { minX: cx - halfW, maxX: cx + halfW, minY: cy - halfH, maxY: cy + halfH },
    intervalMm,
    majorEvery,
    segments: 12,
  });

  ctx.save();
  for (const line of lines) {
    if (!isFinite(line.a.x) || !isFinite(line.b.x)) continue;
    ctx.strokeStyle = line.major ? COLOURS.major : COLOURS.minor;
    ctx.lineWidth = line.major ? Math.max(1.4, w / 1100) : Math.max(0.7, w / 2200);
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The on-screen ruler: a real-world scale bar laid along the calibrated plane,
 * ticked at true intervals. Always labelled with its interval.
 */
export function drawRuler(ctx, H, { intervalMm = 100, lengthMm = 1000, originMm = { x: 0, y: 0 }, label = '' } = {}) {
  const w = ctx.canvas.width;
  const ticks = Math.round(lengthMm / intervalMm);
  const pts = [];
  for (let i = 0; i <= ticks; i++) {
    pts.push(applyHomography(H, { x: originMm.x + i * intervalMm, y: originMm.y }));
  }
  if (pts.some((p) => !isFinite(p.x) || !isFinite(p.y))) return;

  ctx.save();
  ctx.lineWidth = Math.max(2, w / 700);
  ctx.lineCap = 'butt';

  for (let i = 0; i < ticks; i++) {
    ctx.strokeStyle = i % 2 === 0 ? '#ffffff' : '#111111';
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(1, w / 1600);
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, w / 900), 0, Math.PI * 2);
    ctx.stroke();
  }

  const mid = pts[Math.floor(pts.length / 2)];
  labelText(ctx, label || `${intervalMm} mm divisions`, mid.x, mid.y - 14, w);
  ctx.restore();
}

/** Draw the calibration target quad and its corner handles. */
export function drawTargetQuad(ctx, points, { active = -1 } = {}) {
  if (!points.length) return;
  const w = ctx.canvas.width;
  ctx.save();
  ctx.strokeStyle = COLOURS.target;
  ctx.lineWidth = Math.max(1.5, w / 1200);
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (points.length >= 3) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  points.forEach((p, i) => {
    const r = Math.max(7, w / 160);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === active ? COLOURS.target : 'rgba(255,77,109,0.35)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, w / 1200);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    labelText(ctx, String(i + 1), p.x + r + 4, p.y - r, w);
  });
  ctx.restore();
}

/** Draw a completed measurement with its value and expanded uncertainty. */
export function drawMeasurement(ctx, m, { colour = COLOURS.measure } = {}) {
  const w = ctx.canvas.width;
  ctx.save();
  ctx.lineWidth = Math.max(2, w / 900);
  ctx.strokeStyle = COLOURS.measureHalo;
  ctx.beginPath();
  ctx.moveTo(m.a.x, m.a.y);
  ctx.lineTo(m.b.x, m.b.y);
  ctx.stroke();

  ctx.lineWidth = Math.max(1.2, w / 1500);
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(m.a.x, m.a.y);
  ctx.lineTo(m.b.x, m.b.y);
  ctx.stroke();

  for (const p of [m.a, m.b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(4, w / 300), 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  labelText(ctx, m.label, (m.a.x + m.b.x) / 2, (m.a.y + m.b.y) / 2 - 12, w, colour);
  ctx.restore();
}

/** Corner stamp used for NOT TO SCALE and calibration status. */
export function drawStamp(ctx, text, colour = '#ff4d6d') {
  const w = ctx.canvas.width;
  const size = Math.max(14, w / 55);
  ctx.save();
  ctx.font = `700 ${size}px ui-monospace, Consolas, monospace`;
  const pad = size * 0.5;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(pad, pad, tw + pad * 2, size + pad);
  ctx.fillStyle = colour;
  ctx.fillText(text, pad * 2, pad + size * 0.85);
  ctx.restore();
}

function labelText(ctx, text, x, y, w, colour = COLOURS.text) {
  const size = Math.max(12, w / 75);
  ctx.save();
  ctx.font = `600 ${size}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.lineWidth = size / 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Produce a flattened derivative (image + overlay) for export.
 * The source canvas is untouched; this returns a NEW canvas.
 */
export function composite(imageCanvas, overlayCanvas) {
  const out = document.createElement('canvas');
  out.width = imageCanvas.width;
  out.height = imageCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(imageCanvas, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
  return out;
}
