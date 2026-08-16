/**
 * app.js — UI wiring for the browser metrology prototype.
 *
 * Demonstrates, end to end and entirely client-side:
 *   camera / full-resolution capture -> toggleable overlay -> calibration ->
 *   hold-out verification -> measurement with an uncertainty budget ->
 *   raw + overlay + provenance sidecar export.
 */

import {
  computeHomography,
  invert3x3,
  measureDistance,
  localGsd,
  reprojectionResiduals,
  measurementUncertainty,
  propagateHomographyUncertainty,
  extrapolationRatio,
  validateChecks,
  scaleFromKnownLength,
  usibdLoa,
  formatMeasurement,
  distance,
  CALIBRATION_TIERS,
} from './lib/geometry.js';

import {
  clear,
  drawCompositionGrid,
  drawMetricGrid,
  drawRuler,
  drawTargetQuad,
  drawMeasurement,
  drawStamp,
  composite,
} from './lib/overlay.js';

import {
  sha256,
  currentPosition,
  startOrientationWatch,
  browserCapabilities,
  buildManifest,
  downloadBlob,
  downloadJson,
} from './lib/manifest.js';

import { CameraController, detectPlatform } from './lib/camera.js';
import { xrSupport, startArMeasureSession, xrDistanceMm, planeDeviationMm } from './lib/arxr.js';
import { initBranding, brandProvenance } from './lib/branding.js';
import {
  UPLOAD_POLICIES,
  getPolicy,
  setPolicy,
  getTreatUnknownAsUnmetered,
  setTreatUnknownAsUnmetered,
  canUploadNow,
  watchConnection,
  formatBytes,
  uploadProvenance,
} from './lib/upload.js';

const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------- state

const state = {
  stream: null,
  imageBlob: null,
  imageName: null,
  sourceMode: null,          // 'image-capture-full-res' | 'camera-frame' | 'file'
  capturedAt: null,
  captureProfile: null,
  platform: detectPlatform(),

  H: null,                   // world(mm) -> image(px)
  Hinv: null,
  tier: 'CAL-0',
  targetImagePoints: [],
  targetWorldPoints: [],
  targetToleranceMm: 0.5,
  residuals: null,
  cal2ScaleMmPerPx: null,

  checks: [],
  calStatus: 'UNVERIFIED',

  measurements: [],
  arMeasurements: [],
  gridMode: 'off',           // 'off' | 'composition' | 'metric'
  showRuler: false,
  unit: 'mm',
  intervalMm: 100,

  picking: null,             // {kind, need, points, done}
  orientation: null,
  position: null,

  // Upload queue. Nothing blocks on the network: captures wait here until the
  // upload policy is satisfied (Wi-Fi only by default).
  queue: [],
  uploadOverride: false,
};

const camera = new CameraController();

const imageCanvas = $('imageCanvas');
const overlayCanvas = $('overlayCanvas');
const ictx = imageCanvas.getContext('2d');
const octx = overlayCanvas.getContext('2d');
const video = $('video');

// ------------------------------------------------------------- utilities

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function unitFactor(u) {
  return { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, ft: 1 / 304.8 }[u] ?? 1;
}

/** Map a pointer event to source-image pixel coordinates. */
function eventToImagePoint(evt) {
  const rect = overlayCanvas.getBoundingClientRect();
  const x = ((evt.clientX - rect.left) / rect.width) * overlayCanvas.width;
  const y = ((evt.clientY - rect.top) / rect.height) * overlayCanvas.height;
  return { x, y };
}

// ---------------------------------------------------------------- capture

function updateCamState() {
  const p = camera.captureProfile();
  $('camState').textContent =
    `zoom ${(p.zoom ?? 1).toFixed(1)}× · focus ${p.focus_mode ?? 'n/a'} · ` +
    `exposure ${p.exposure_mode ?? 'n/a'} · optics ${p.optics_locked ? 'LOCKED' : 'auto'} · ` +
    `lens profile ${p.lens_profile_valid ? 'valid' : 'invalid'}`;
  state.captureProfile = p;
}

async function startCamera() {
  try {
    await camera.start();
    video.srcObject = camera.stream;
    await video.play();
    video.classList.remove('hidden');
    $('emptyState').classList.add('hidden');

    const caps = camera.capabilities;
    const s = camera.settings;

    $('btnGrab').disabled = false;
    $('btnTakePhoto').disabled = !camera.imageCapture;
    $('camControls').classList.remove('hidden');
    $('btnTorch').disabled = !camera.supports('torch');
    $('btnLockOptics').disabled = !(caps.focusMode || caps.exposureMode || caps.whiteBalanceMode);

    if (camera.supports('zoom') && caps.zoom) {
      $('zoomWrap').classList.remove('hidden');
      const z = $('zoomSlider');
      z.min = caps.zoom.min;
      z.max = caps.zoom.max;
      z.step = caps.zoom.step || 0.1;
      z.value = s.zoom ?? caps.zoom.min;
      $('zoomVal').textContent = `${Number(z.value).toFixed(1)}×`;
    }

    updateCamState();

    const maxPhoto = camera.photoCapabilities?.imageWidth?.max;
    toast(
      camera.imageCapture
        ? `Camera live. Preview ${s.width}×${s.height}; full-res stills up to ${maxPhoto ?? '?'} px wide via ImageCapture.`
        : `Camera live at ${s.width}×${s.height}. No ImageCapture here — use the native camera input for archival stills.`,
      5600
    );
  } catch (err) {
    toast(`Camera unavailable: ${err.message}`);
  }
}

/** Primary archival capture path on Android: full sensor resolution, in-page. */
async function takeFullResPhoto() {
  try {
    const blob = await camera.takePhoto();
    updateCamState();
    await adoptImage(blob, `capture-${Date.now()}.jpg`, 'image-capture-full-res');
    toast(`Full-resolution still captured (${imageCanvas.width}×${imageCanvas.height}).`);
  } catch (err) {
    toast(`Full-res capture failed: ${err.message}`);
  }
}

async function grabFrame() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return toast('Camera not ready yet.');

  imageCanvas.width = w;
  imageCanvas.height = h;
  ictx.drawImage(video, 0, 0, w, h);

  const blob = await new Promise((res) => imageCanvas.toBlob(res, 'image/jpeg', 0.95));
  await adoptImage(blob, `frame-${Date.now()}.jpg`, 'camera-frame');
  toast('Preview frame frozen — framing/overlay use only, not an archival capture.', 5000);
}

async function loadFile(file) {
  await adoptImage(file, file.name, 'file');
  toast(`Loaded ${file.name}. Original bytes preserved for export.`);
}

async function adoptImage(blob, name, mode) {
  const bitmap = await createImageBitmap(blob);
  imageCanvas.width = bitmap.width;
  imageCanvas.height = bitmap.height;
  overlayCanvas.width = bitmap.width;
  overlayCanvas.height = bitmap.height;
  ictx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  state.imageBlob = blob;
  state.imageName = name;
  state.sourceMode = mode;
  state.capturedAt = new Date().toISOString();

  video.classList.add('hidden');
  $('emptyState').classList.add('hidden');

  resetCalibration();
  ['btnExportRaw', 'btnExportOverlay', 'btnExportComposite', 'btnExportManifest', 'btnPickTarget', 'btnQueue'].forEach(
    (id) => { $(id).disabled = false; }
  );
  render();
}

function resetCalibration() {
  state.H = null;
  state.Hinv = null;
  state.tier = 'CAL-0';
  state.targetImagePoints = [];
  state.targetWorldPoints = [];
  state.residuals = null;
  state.cal2ScaleMmPerPx = null;
  state.checks = [];
  state.calStatus = 'UNVERIFIED';
  state.measurements = [];
  state.picking = null;
  if (state.gridMode === 'metric') state.gridMode = 'off';
  syncUi();
}

// ------------------------------------------------------------- picking

function beginPick(kind, need, onDone) {
  if (!state.imageBlob) return toast('Load or capture an image first.');
  state.picking = { kind, need, points: [], onDone };
  toast(`Click ${need} point${need > 1 ? 's' : ''} on the image (${kind}).`, 5000);
  render();
}

overlayCanvas.addEventListener('click', (evt) => {
  if (!state.picking) return;
  const p = eventToImagePoint(evt);
  state.picking.points.push(p);
  render();

  if (state.picking.points.length >= state.picking.need) {
    const { points, onDone } = state.picking;
    state.picking = null;
    onDone(points);
    render();
  }
});

// --------------------------------------------------------- calibration

function solveCal3() {
  const pts = state.targetImagePoints;
  if (pts.length !== 4) return toast('Pick the 4 target corners first.');

  const W = parseFloat($('rectW').value);
  const Hh = parseFloat($('rectH').value);
  if (!(W > 0) || !(Hh > 0)) return toast('Enter the measured target width and height.');

  // TL, TR, BR, BL in world millimetres.
  const world = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: Hh },
    { x: 0, y: Hh },
  ];

  try {
    const H = computeHomography(world, pts);
    const Hinv = invert3x3(H);
    state.H = H;
    state.Hinv = Hinv;
    state.targetWorldPoints = world;
    state.targetToleranceMm = parseFloat($('targetTol').value) || 0.5;
    state.residuals = reprojectionResiduals(H, world, pts);
    state.tier = 'CAL-3';
    state.cal2ScaleMmPerPx = null;
    state.checks = [];
    state.calStatus = 'UNVERIFIED';

    const centre = { x: imageCanvas.width / 2, y: imageCanvas.height / 2 };
    const gsd = localGsd(Hinv, centre);

    $('calOut').classList.remove('hidden');
    $('calOut').textContent =
      `tier          CAL-3 (planar homography)\n` +
      `target        ${W} x ${Hh} mm, tol ±${state.targetToleranceMm} mm\n` +
      `RMS residual  ${state.residuals.rmsMm.toFixed(3)} mm  (${state.residuals.rmsPx.toFixed(3)} px)\n` +
      `max residual  ${state.residuals.maxMm.toFixed(3)} mm\n` +
      `GSD (centre)  ${gsd.toFixed(4)} mm/px\n` +
      `\nAdd at least one hold-out check to reach VERIFIED.`;

    toast('Calibration solved. Now add an independent check distance.');
  } catch (err) {
    toast(`Calibration failed: ${err.message}`);
  }
  syncUi();
  render();
}

function solveCal2(points) {
  const known = parseFloat($('knownLen').value);
  if (!(known > 0)) return toast('Enter the known length.');
  try {
    const mmPerPx = scaleFromKnownLength({ knownMm: known, a: points[0], b: points[1] });
    state.cal2ScaleMmPerPx = mmPerPx;
    state.H = null;
    state.Hinv = null;
    state.tier = 'CAL-2';
    state.checks = [];
    state.calStatus = 'UNVERIFIED';
    $('calOut').classList.remove('hidden');
    $('calOut').textContent =
      `tier    CAL-2 (uniform scale from one known length)\n` +
      `scale   ${mmPerPx.toFixed(4)} mm/px\n` +
      `\nValid only along that direction, near frame centre,\n` +
      `on a near-fronto-parallel shot. No metric grid available.`;
    toast('CAL-2 scale set. Uniform scale only — no perspective correction.');
  } catch (err) {
    toast(err.message);
  }
  syncUi();
  render();
}

function addCheck(points) {
  const known = parseFloat($('checkKnown').value);
  if (!(known > 0)) return toast('Enter the known check length.');

  state.checks.push({
    label: $('checkLabel').value || `check ${state.checks.length + 1}`,
    knownMm: known,
    a: points[0],
    b: points[1],
  });

  const tol = parseFloat($('checkTol').value) || 1.0;
  const verdict = state.Hinv
    ? validateChecks(state.Hinv, state.checks, tol)
    : validateChecksUniform(state.checks, state.cal2ScaleMmPerPx, tol);

  state.calStatus = verdict.status;
  renderChecks(verdict);
  $('checkLabel').value = `check ${state.checks.length + 1}`;
  syncUi();
  render();
}

/** CAL-2 has no homography, so checks are validated against the uniform scale. */
function validateChecksUniform(checks, mmPerPx, tolerancePct) {
  const results = checks.map((c) => {
    const measuredMm = distance(c.a, c.b) * mmPerPx;
    const errorMm = measuredMm - c.knownMm;
    const errorPct = (100 * errorMm) / c.knownMm;
    return { label: c.label, knownMm: c.knownMm, measuredMm, errorMm, errorPct, pass: Math.abs(errorPct) <= tolerancePct };
  });
  return {
    results,
    status: results.length === 0 ? 'UNVERIFIED' : results.every((r) => r.pass) ? 'VERIFIED' : 'FAILED',
    worstErrorPct: results.length ? Math.max(...results.map((r) => Math.abs(r.errorPct))) : null,
  };
}

function renderChecks(verdict) {
  const el = $('checkList');
  el.innerHTML = '';
  for (const r of verdict.results) {
    const d = document.createElement('div');
    d.className = `item ${r.pass ? 'pass' : 'fail'}`;
    d.innerHTML =
      `<b>${r.label}</b> ${r.pass ? 'PASS' : 'FAIL'}<br>` +
      `<span class="k">known</span> ${r.knownMm.toFixed(1)} mm ` +
      `<span class="k">measured</span> ${r.measuredMm.toFixed(1)} mm<br>` +
      `<span class="k">error</span> ${r.errorMm >= 0 ? '+' : ''}${r.errorMm.toFixed(2)} mm (${r.errorPct.toFixed(3)} %)`;
    el.appendChild(d);
  }
}

// -------------------------------------------------------------- measure

function addMeasurement(points) {
  const [a, b] = points;

  // Consistency with docs/03 I3: a failed hold-out check disables measurement.
  if (state.calStatus === 'FAILED') {
    return toast('Calibration FAILED its hold-out check — measurement is disabled until it is re-done.', 5000);
  }

  const label = $('measLabel').value || `m${state.measurements.length + 1}`;
  const depthMm = parseFloat($('measDepth').value) || 0;

  let valueMm;
  let gsd;
  let sigmaGeomMm = null;
  let ratio = 0;

  if (state.Hinv) {
    valueMm = measureDistance(state.Hinv, a, b);
    gsd = (localGsd(state.Hinv, a) + localGsd(state.Hinv, b)) / 2;
    ratio = extrapolationRatio(state.targetImagePoints, [a, b]);
    // Accurate geometric term: propagate corner-detection noise through the fit.
    sigmaGeomMm = propagateHomographyUncertainty({
      world: state.targetWorldPoints,
      image: state.targetImagePoints,
      a, b,
      detectPx: 0.5,
      trials: 300,
    }).sigmaMm;
  } else if (state.cal2ScaleMmPerPx) {
    valueMm = distance(a, b) * state.cal2ScaleMmPerPx;
    gsd = state.cal2ScaleMmPerPx;
  } else {
    return toast('Calibrate first — CAL-0 measurements are disabled by design.');
  }

  // Off-plane term: how far from the optical axis, as a fraction of half-width.
  const centre = { x: imageCanvas.width / 2, y: imageCanvas.height / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const offAxisRatio = distance(mid, centre) / (imageCanvas.width / 2);

  const u = measurementUncertainty({
    gsdMmPerPx: gsd,
    measuredMm: valueMm,
    targetToleranceMm: state.targetToleranceMm,
    detectPx: 0.5,
    pickPx: 1.5,
    extrapolationRatio: ratio,
    depthOffsetMm: depthMm,
    distanceToPlaneMm: depthMm ? 1 : 0,
    offAxisRatio,
    lensResidualPct: state.tier === 'CAL-4' ? 0 : 0.3,
    sigmaGeomMm,
  });

  const loa = usibdLoa(u.sigmaTotalMm);
  const f = unitFactor(state.unit);

  state.measurements.push({
    label, a, b,
    valueMm,
    sigmaMm: u.sigmaTotalMm,
    expandedMm: u.expandedMm,
    breakdown: u,
    tier: state.tier,
    calStatus: state.calStatus,
    // In-field values are always provisional; the authoritative number comes from
    // server post-processing. See docs/05-server-and-provenance.md.
    status: 'PROVISIONAL',
    depthOffsetMm: depthMm,
    extrapolationRatio: ratio,
    gsdMmPerPx: gsd,
    loa: loa.loa,
    display: formatMeasurement(valueMm, u.sigmaTotalMm, state.unit),
    displayUnit: state.unit,
    displayValue: valueMm * f,
  });

  $('measLabel').value = `m${state.measurements.length + 1}`;
  renderMeasurements();
  render();
}

function renderMeasurements() {
  const el = $('measList');
  el.innerHTML = '';
  for (const m of state.measurements) {
    const d = document.createElement('div');
    d.className = `item ${m.calStatus === 'VERIFIED' ? 'pass' : 'fail'}`;
    d.innerHTML =
      `<b>${m.label}</b> ${m.display} <span class="k">PROVISIONAL</span><br>` +
      `<span class="k">tier</span> ${m.tier} ` +
      `<span class="k">calibration</span> ${m.calStatus} ` +
      `<span class="k">USIBD</span> ${m.loa}<br>` +
      `<span class="k">σ</span> target ${m.breakdown.sigmaTarget.toFixed(2)} · ` +
      `geom ${m.breakdown.sigmaGeom.toFixed(2)} · pick ${m.breakdown.sigmaPick.toFixed(2)} · ` +
      `plane ${m.breakdown.sigmaPlane.toFixed(2)} · lens ${m.breakdown.sigmaLens.toFixed(2)} mm`;
    el.appendChild(d);
  }
}

// --------------------------------------------------------------- render

function render() {
  if (!overlayCanvas.width) return;
  clear(octx);

  if (state.gridMode === 'composition') {
    drawCompositionGrid(octx, { divisions: 3 });
  } else if (state.gridMode === 'metric' && state.H) {
    drawMetricGrid(octx, state.H, { intervalMm: state.intervalMm, majorEvery: 10 });
  }

  if (state.showRuler && state.H) {
    drawRuler(octx, state.H, {
      intervalMm: state.intervalMm,
      lengthMm: state.intervalMm * 10,
      originMm: { x: 0, y: 0 },
      label: `${state.intervalMm} mm divisions · ${state.tier}`,
    });
  }

  if (state.targetImagePoints.length) {
    drawTargetQuad(octx, state.targetImagePoints);
  }

  for (const m of state.measurements) {
    drawMeasurement(octx, { a: m.a, b: m.b, label: m.display });
  }

  if (state.picking?.points.length) {
    drawTargetQuad(octx, state.picking.points, { active: state.picking.points.length - 1 });
  }

  if (state.H || state.cal2ScaleMmPerPx) {
    const colour = state.calStatus === 'VERIFIED' ? '#3fb950'
      : state.calStatus === 'FAILED' ? '#ff4d6d' : '#d29922';
    const res = state.residuals ? ` · RMS ${state.residuals.rmsMm.toFixed(2)} mm` : '';
    drawStamp(octx, `${state.tier} · ${state.calStatus}${res}`, colour);
  } else if (state.imageBlob) {
    drawStamp(octx, 'CAL-0 · NOT TO SCALE', '#ff4d6d');
  }
}

function syncUi() {
  const badge = $('tierBadge');
  badge.className = 'badge ' + (state.tier === 'CAL-3' ? 'badge-cal3' : state.tier === 'CAL-2' ? 'badge-cal2' : 'badge-cal0');
  const note = CALIBRATION_TIERS[state.tier]?.label ?? '';
  badge.textContent = state.tier === 'CAL-0'
    ? 'CAL-0 · NOT TO SCALE'
    : `${state.tier} · ${note} · ${state.calStatus}`;

  const calibrated = !!(state.H || state.cal2ScaleMmPerPx);
  $('btnPickCheck').disabled = !calibrated;
  $('btnMeasure').disabled = !calibrated;
  $('btnGridMetric').disabled = !state.H;
  $('btnRuler').disabled = !state.H;
  $('btnSolve').disabled = state.targetImagePoints.length !== 4;

  const st = $('calStatus');
  st.textContent = state.calStatus;
  st.className = 'status ' + (state.calStatus === 'VERIFIED' ? 'status-verified'
    : state.calStatus === 'FAILED' ? 'status-failed' : 'status-unverified');
}

// ------------------------------------------------- upload policy & queue

function renderQueue() {
  const bytes = state.queue.reduce((s, q) => s + q.bytes, 0);
  $('queueCount').textContent =
    `${state.queue.length} capture${state.queue.length === 1 ? '' : 's'}`;
  $('queueSize').textContent = formatBytes(bytes);
}

function renderNetwork(decision = canUploadNow({ override: state.uploadOverride })) {
  const el = $('netStatus');
  const c = decision.conn;

  const detail = c.supported
    ? `${c.type}${c.effectiveType ? ` · ${c.effectiveType}` : ''}${c.saveData ? ' · Data Saver ON' : ''}`
    : 'network type not reported by this browser';

  el.textContent = `${decision.allowed ? 'UPLOADING' : 'HOLDING'} — ${detail}\n${decision.reason}`;
  el.classList.remove('net-ok', 'net-hold', 'net-off');
  el.classList.add(!c.online ? 'net-off' : decision.allowed ? 'net-ok' : 'net-hold');

  // Drain the queue when the policy is finally satisfied.
  if (decision.allowed && state.queue.length) {
    const n = state.queue.length;
    state.queue = [];
    renderQueue();
    toast(`Network allows upload — ${n} queued capture${n === 1 ? '' : 's'} would now be sent.`, 4500);
  }
  return decision;
}

function initUploadUi() {
  const policy = getPolicy();
  $('uploadPolicy').value = policy.id;
  $('policyDesc').textContent = policy.description;
  $('unknownAsUnmetered').checked = getTreatUnknownAsUnmetered();

  $('uploadPolicy').addEventListener('change', (e) => {
    const p = setPolicy(e.target.value);
    $('policyDesc').textContent = p.description;
    state.uploadOverride = false;
    renderNetwork();
    toast(`Upload policy: ${p.label}.`);
  });

  $('unknownAsUnmetered').addEventListener('change', (e) => {
    setTreatUnknownAsUnmetered(e.target.checked);
    renderNetwork();
  });

  $('btnQueue').addEventListener('click', () => {
    if (!state.imageBlob) return toast('Capture or load an image first.');
    state.queue.push({
      name: state.imageName,
      bytes: state.imageBlob.size,
      queuedAt: new Date().toISOString(),
    });
    renderQueue();
    const d = renderNetwork();
    toast(d.allowed
      ? 'Queued and eligible to upload now.'
      : `Queued and held: ${d.reason}`, 4500);
  });

  $('btnUploadNow').addEventListener('click', () => {
    state.uploadOverride = true;
    const d = renderNetwork();
    state.uploadOverride = false;
    if (!d.allowed) toast(d.reason, 4500);
  });

  watchConnection((decision) => {
    if (!state.uploadOverride) renderNetwork(decision);
  });

  renderQueue();
}

// --------------------------------------------------------------- export

async function exportManifest() {
  const buf = await state.imageBlob.arrayBuffer();
  const digest = await sha256(buf);

  const manifest = buildManifest({
    imageSha256: digest,
    imageBytes: state.imageBlob.size,
    imageWidth: imageCanvas.width,
    imageHeight: imageCanvas.height,
    sourceMode: state.sourceMode,
    capturedAt: state.capturedAt,
    subject: {
      name: $('subjName').value || null,
      identifier: $('subjId').value || null,
      registry: $('subjRegistry').value || null,
      face: $('subjFace').value || null,
      confirmed: $('subjConfirm').checked,
    },
    operator: {
      name: $('opName').value || null,
      org: $('opOrg').value || null,
      level: $('opLevel').value,
    },
    position: state.position,
    orientation: state.orientation,
    device: {
      user_agent: navigator.userAgent,
      platform: navigator.platform ?? null,
      platform_tier: state.platform.tier,
      platform_label: state.platform.label,
      capture_profile: state.captureProfile,
    },
    capabilities: browserCapabilities(),
    calibration: state.H || state.cal2ScaleMmPerPx ? {
      tier: state.tier,
      method: state.H ? 'homography-4pt-manual' : 'known-length-uniform-scale',
      plane_description: $('planeDesc').value || null,
      target: state.H ? {
        width_mm: parseFloat($('rectW').value),
        height_mm: parseFloat($('rectH').value),
        tolerance_mm: state.targetToleranceMm,
        image_points: state.targetImagePoints,
      } : null,
      scale_mm_per_px: state.cal2ScaleMmPerPx,
      homography: state.H,
      rms_residual_mm: state.residuals?.rmsMm ?? null,
      max_residual_mm: state.residuals?.maxMm ?? null,
      checks: state.checks.map((c) => ({ label: c.label, known_mm: c.knownMm, a: c.a, b: c.b })),
      status: state.calStatus,
    } : null,
    measurements: state.measurements.map((m) => ({
      label: m.label,
      status: 'PROVISIONAL',
      value_mm: m.valueMm,
      sigma_mm_1sigma: m.sigmaMm,
      expanded_mm_95pct: m.expandedMm,
      uncertainty_breakdown_mm: {
        target: m.breakdown.sigmaTarget,
        geometric: m.breakdown.sigmaGeom,
        pick: m.breakdown.sigmaPick,
        plane: m.breakdown.sigmaPlane,
        lens: m.breakdown.sigmaLens,
      },
      usibd_measured_accuracy: m.loa,
      calibration_tier: m.tier,
      calibration_status: m.calStatus,
      depth_offset_mm: m.depthOffsetMm,
      extrapolation_ratio: m.extrapolationRatio,
      gsd_mm_per_px: m.gsdMmPerPx,
      image_points: { a: m.a, b: m.b },
    })),
    overlay: {
      grid_mode: state.gridMode,
      grid_interval_mm: state.intervalMm,
      ruler: state.showRuler,
      burned_into_original: false,
    },
  });

  manifest.accuracy_statement =
    state.calStatus === 'VERIFIED'
      ? 'PROVISIONAL field measurement. Measured accuracy only, per USIBD LOA. The authoritative value ' +
        'is produced by server post-processing. Represented accuracy of any drawing derived from these ' +
        'measurements is NOT implied and must be assessed separately.'
      : 'CALIBRATION NOT VERIFIED — these values must not be used for design or submission.';

  manifest.pipeline = {
    stage: 'field-capture',
    authoritative: false,
    next: 'server post-processing: sub-pixel detection, undistortion, bundle adjustment, ' +
          'measurement re-solve, C2PA signing',
  };

  // Record which deployment produced this artifact.
  manifest.what.branding = brandProvenance(state.brand);
  manifest.what.transfer = uploadProvenance();

  manifest.unverified.push(
    'Field measurements are PROVISIONAL. Authoritative values come from server post-processing.'
  );

  downloadJson(manifest, `${(state.imageName || 'capture').replace(/\.[^.]+$/, '')}.manifest.json`);
  toast('Provenance sidecar exported. The original image was not modified.');
}

// ------------------------------------------------------------- listeners

$('btnStartCam').addEventListener('click', startCamera);
$('btnTakePhoto').addEventListener('click', takeFullResPhoto);
$('btnGrab').addEventListener('click', grabFrame);
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) loadFile(f);
});

let torchOn = false;
$('btnTorch').addEventListener('click', async () => {
  try {
    torchOn = !torchOn;
    await camera.setTorch(torchOn);
    $('btnTorch').classList.toggle('chip-on', torchOn);
    updateCamState();
  } catch (err) {
    toast(err.message);
  }
});

$('btnLockOptics').addEventListener('click', async () => {
  try {
    const r = await camera.lockOptics();
    updateCamState();
    toast(r.locked
      ? `Optics locked (${Object.entries(r.applied).map(([k, v]) => `${k}=${v}`).join(', ')}). Intrinsics now stable for this session.`
      : r.reason, 5200);
  } catch (err) {
    toast(`Lock failed: ${err.message}`);
  }
});

$('zoomSlider').addEventListener('input', async (e) => {
  try {
    const v = parseFloat(e.target.value);
    await camera.setZoom(v);
    $('zoomVal').textContent = `${v.toFixed(1)}×`;
    updateCamState();
  } catch (err) {
    toast(err.message);
  }
});

// ---- WebXR AR measurement (Android / ARCore)

$('btnArCheck').addEventListener('click', async () => {
  const s = await xrSupport();
  $('arState').textContent = s.available
    ? 'immersive-ar supported — marker-free AR measurement available.'
    : `Not available: ${s.reason}`;
  $('btnArMeasure').disabled = !s.available;
  toast(s.available ? 'WebXR immersive-AR is available.' : `WebXR unavailable: ${s.reason}`, 4600);
});

$('btnArMeasure').addEventListener('click', async () => {
  try {
    const session = await startArMeasureSession({
      onStatus: (st) => {
        if (st.depthAvailable) {
          $('arState').textContent = 'AR session active · ARCore depth stream available.';
        }
      },
      onPoint: (p, pts) => {
        $('arState').textContent = `AR point ${pts.length} captured.`;
        if (pts.length >= 2) {
          const a = pts[pts.length - 2];
          const b = pts[pts.length - 1];
          const mm = xrDistanceMm(a, b);
          state.arMeasurements.push({
            label: `ar${state.arMeasurements.length + 1}`,
            valueMm: mm,
            a, b,
            method: 'webxr-hit-test',
            depthAvailable: session.depthAvailable,
          });
          renderArMeasurements();
        }
        if (pts.length >= 3) {
          const dev = planeDeviationMm(pts);
          if (dev) {
            $('arState').textContent =
              `Plane fit over ${pts.length} points · RMS ${dev.rmsMm.toFixed(1)} mm · max ${dev.maxAbsMm.toFixed(1)} mm off-plane.`;
          }
        }
      },
      onEnd: () => { $('arState').textContent = 'AR session ended.'; },
    });
    $('arState').textContent = 'AR session starting — tap to place points.';
    window.__arSession = session;
  } catch (err) {
    $('arState').textContent = `AR failed: ${err.message}`;
    toast(`AR failed: ${err.message}`);
  }
});

function renderArMeasurements() {
  const el = $('arList');
  el.innerHTML = '';
  for (const m of state.arMeasurements) {
    const d = document.createElement('div');
    d.className = 'item pass';
    d.innerHTML =
      `<b>${m.label}</b> ${(m.valueMm * unitFactor(state.unit)).toFixed(1)} ${state.unit}<br>` +
      `<span class="k">method</span> ${m.method} ` +
      `<span class="k">depth</span> ${m.depthAvailable ? 'available' : 'n/a'}`;
    el.appendChild(d);
  }
}

$('btnSensors').addEventListener('click', async () => {
  const watch = startOrientationWatch((o) => {
    state.orientation = o;
    $('hudPitch').textContent = o.beta == null ? '–' : `${o.beta.toFixed(1)}°`;
    $('hudRoll').textContent = o.gamma == null ? '–' : `${o.gamma.toFixed(1)}°`;
    $('hudHeading').textContent = o.compass_heading == null
      ? (o.alpha == null ? '–' : `${o.alpha.toFixed(0)}°*`)
      : `${o.compass_heading.toFixed(0)}° ±${o.compass_accuracy_deg ?? '?'}`;
    const off = Math.max(Math.abs(o.gamma ?? 0), Math.abs((o.beta ?? 90) - 90));
    $('levelWarn').classList.toggle('hidden', off <= 3);
  });
  const ok = await watch.request();
  toast(ok ? 'Orientation sensors active.' : 'Orientation permission denied or unavailable.');

  state.position = await currentPosition();
  $('hudGps').textContent = state.position
    ? `±${state.position.accuracy_m.toFixed(0)} m`
    : 'n/a';
});

$('btnCaps').addEventListener('click', () => {
  const out = $('capsOut');
  out.classList.toggle('hidden');
  out.textContent = JSON.stringify(browserCapabilities(), null, 2);
});

document.querySelectorAll('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('seg-on'));
    b.classList.add('seg-on');
    const cal3 = b.dataset.mode === 'cal3';
    $('cal3Box').classList.toggle('hidden', !cal3);
    $('cal2Box').classList.toggle('hidden', cal3);
  });
});

$('btnPickTarget').addEventListener('click', () => {
  state.targetImagePoints = [];
  beginPick('target corners TL,TR,BR,BL', 4, (pts) => {
    state.targetImagePoints = pts;
    syncUi();
    toast('4 corners set. Enter the measured size and solve.');
  });
});

$('btnSolve').addEventListener('click', solveCal3);
$('btnPickScale').addEventListener('click', () => beginPick('known length endpoints', 2, solveCal2));
$('btnPickCheck').addEventListener('click', () => beginPick('check distance endpoints', 2, addCheck));
$('btnMeasure').addEventListener('click', () => beginPick('measurement endpoints', 2, addMeasurement));
$('btnClearMeas').addEventListener('click', () => {
  state.measurements = [];
  renderMeasurements();
  render();
});

const gridButtons = { off: $('btnGridOff'), composition: $('btnGridComp'), metric: $('btnGridMetric') };
function setGrid(mode) {
  state.gridMode = mode;
  Object.entries(gridButtons).forEach(([k, b]) => b.classList.toggle('chip-on', k === mode));
  render();
}
$('btnGridOff').addEventListener('click', () => setGrid('off'));
$('btnGridComp').addEventListener('click', () => setGrid('composition'));
$('btnGridMetric').addEventListener('click', () => setGrid('metric'));

$('btnRuler').addEventListener('click', () => {
  state.showRuler = !state.showRuler;
  $('btnRuler').classList.toggle('chip-on', state.showRuler);
  render();
});

$('gridInterval').addEventListener('change', (e) => {
  state.intervalMm = parseFloat(e.target.value);
  render();
});

$('unitSelect').addEventListener('change', (e) => {
  state.unit = e.target.value;
  for (const m of state.measurements) {
    m.display = formatMeasurement(m.valueMm, m.sigmaMm, state.unit);
    m.displayUnit = state.unit;
    m.displayValue = m.valueMm * unitFactor(state.unit);
  }
  renderMeasurements();
  render();
});

$('btnExportRaw').addEventListener('click', () => {
  downloadBlob(state.imageBlob, state.imageName || 'original.jpg');
  toast('Raw image exported byte-identical — no overlay, no re-encode.');
});

$('btnExportOverlay').addEventListener('click', () => {
  overlayCanvas.toBlob((b) => downloadBlob(b, 'overlay.png'), 'image/png');
});

$('btnExportComposite').addEventListener('click', () => {
  composite(imageCanvas, overlayCanvas).toBlob(
    (b) => downloadBlob(b, 'annotated-derivative.png'),
    'image/png'
  );
  toast('Annotated derivative exported. The original remains untouched.');
});

$('btnExportManifest').addEventListener('click', exportManifest);

// Expose the core for smoke testing and console experimentation.
window.__plumb = { state, render, syncUi, adoptImage, camera };

// Branding is presentational and opt-in; it never changes measurement behaviour.
state.brand = initBranding();

// Upload gating — Wi-Fi only by default, like every other photo-sync app.
initUploadUi();

// Platform banner — Android/Chromium is the reference platform.
(() => {
  const p = state.platform;
  const el = $('platformBadge');
  el.textContent = p.label;
  el.classList.add(p.tier === 'primary' ? 'platform-primary' : 'platform-reduced');
  if (p.tier === 'reduced') {
    $('captureHint').innerHTML =
      'This browser lacks <code>ImageCapture</code> and camera-optics control. ' +
      'Use the native camera input below for a full-resolution still with EXIF. ' +
      'Calibration, measurement and export all still work — but capture is not locked, ' +
      'so device lens profiles cannot be relied on.';
  }
})();

syncUi();
