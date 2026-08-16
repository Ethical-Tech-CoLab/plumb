/**
 * geometry.js — metrology core for Plumb: measured photography for landmarks.
 *
 * Dependency-free ES module. Runs unchanged in the browser and in Node (unit tests).
 *
 * Conventions
 *   world  : millimetres on the calibrated plane, {x, y}
 *   image  : pixels in the source photograph,     {x, y}
 *   H      : 3x3 row-major homography mapping WORLD -> IMAGE
 *   Hinv   : 3x3 row-major homography mapping IMAGE -> WORLD
 */

// ---------------------------------------------------------------- 3x3 helpers

export function matMul3(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  }
  return C;
}

export function invert3x3(M) {
  const [a, b, c] = M[0];
  const [d, e, f] = M[1];
  const [g, h, i] = M[2];

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-15) {
    throw new Error('Matrix is singular; the four points are probably collinear or coincident.');
  }

  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const Hh = -(a * f - c * d);
  const I = a * e - b * d;

  return [
    [A / det, D / det, G / det],
    [B / det, E / det, Hh / det],
    [C / det, F / det, I / det],
  ];
}

/** Apply a 3x3 projective transform to a point. */
export function applyHomography(H, p) {
  const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
  if (Math.abs(w) < 1e-15) throw new Error('Point maps to infinity under this homography.');
  return {
    x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w,
    y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w,
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ------------------------------------------------- symmetric eigen (Jacobi)

/**
 * Cyclic Jacobi eigenvalue decomposition for a real symmetric matrix.
 * Returns { values: number[], vectors: number[][] } where vectors[i] is the
 * eigenvector for values[i].
 */
export function jacobiEigen(Ain, maxSweeps = 100, tol = 1e-14) {
  const n = Ain.length;
  const A = Ain.map((r) => r.slice());
  let V = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (Math.sqrt(off) < tol) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = A.map((row, i) => row[i]);
  const vectors = values.map((_, i) => V.map((row) => row[i]));
  return { values, vectors };
}

// ------------------------------------------------------- Hartley normalisation

function normalisePoints(pts) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const meanDist =
    pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const scale = meanDist > 1e-12 ? Math.SQRT2 / meanDist : 1;

  const T = [
    [scale, 0, -scale * cx],
    [0, scale, -scale * cy],
    [0, 0, 1],
  ];
  return { T, pts: pts.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })) };
}

// --------------------------------------------------------------- homography

/**
 * Solve the homography mapping `world` -> `image` by normalised DLT.
 * Accepts 4 or more correspondences; with more than 4 this is a least-squares fit.
 *
 * @param {{x:number,y:number}[]} world  real-world plane coordinates (mm)
 * @param {{x:number,y:number}[]} image  pixel coordinates
 * @returns {number[][]} 3x3 H, normalised so H[2][2] === 1 where possible
 */
export function computeHomography(world, image) {
  if (!Array.isArray(world) || !Array.isArray(image) || world.length !== image.length) {
    throw new Error('World and image point arrays must be the same length.');
  }
  if (world.length < 4) {
    throw new Error('At least 4 point correspondences are required for a homography.');
  }

  const nw = normalisePoints(world);
  const ni = normalisePoints(image);

  const rows = [];
  for (let k = 0; k < world.length; k++) {
    const { x, y } = nw.pts[k];
    const { x: u, y: v } = ni.pts[k];
    rows.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    rows.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }

  // M = A^T A  (9x9 symmetric)
  const M = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const r of rows) {
    for (let i = 0; i < 9; i++) {
      for (let j = i; j < 9; j++) M[i][j] += r[i] * r[j];
    }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) M[i][j] = M[j][i];

  const { values, vectors } = jacobiEigen(M);
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[best]) best = i;
  const h = vectors[best];

  const Hn = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], h[8]],
  ];

  // Denormalise: H = Ti^-1 * Hn * Tw
  const H = matMul3(invert3x3(ni.T), matMul3(Hn, nw.T));

  if (Math.abs(H[2][2]) > 1e-15) {
    const s = H[2][2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i][j] /= s;
  }
  return H;
}

/**
 * Reprojection residuals of a homography fit, expressed both in pixels and in
 * millimetres on the plane. The RMS millimetre figure is the number reported to
 * the operator as the calibration quality signal.
 */
export function reprojectionResiduals(H, world, image) {
  const Hinv = invert3x3(H);
  const perPointPx = [];
  const perPointMm = [];

  for (let i = 0; i < world.length; i++) {
    const projected = applyHomography(H, world[i]);
    perPointPx.push(distance(projected, image[i]));
    const backProjected = applyHomography(Hinv, image[i]);
    perPointMm.push(distance(backProjected, world[i]));
  }

  const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
  return {
    perPointPx,
    perPointMm,
    rmsPx: rms(perPointPx),
    rmsMm: rms(perPointMm),
    maxPx: Math.max(...perPointPx),
    maxMm: Math.max(...perPointMm),
  };
}

// -------------------------------------------------------------- measurement

/** Convert an image-space point to world millimetres. */
export function imageToWorld(Hinv, p) {
  return applyHomography(Hinv, p);
}

/**
 * Local ground sample distance (mm per pixel) at an image point.
 * Perspective means GSD varies across the frame, so it is always evaluated locally.
 */
export function localGsd(Hinv, imagePoint) {
  const p0 = applyHomography(Hinv, imagePoint);
  const px = applyHomography(Hinv, { x: imagePoint.x + 1, y: imagePoint.y });
  const py = applyHomography(Hinv, { x: imagePoint.x, y: imagePoint.y + 1 });
  return (distance(p0, px) + distance(p0, py)) / 2;
}

/**
 * Measure the straight-line distance between two image points, in millimetres
 * on the calibrated plane.
 */
export function measureDistance(Hinv, a, b) {
  return distance(applyHomography(Hinv, a), applyHomography(Hinv, b));
}

/** Signed polygon area (mm^2) of image-space vertices projected onto the plane. */
export function measureArea(Hinv, imagePoints) {
  if (imagePoints.length < 3) return 0;
  const w = imagePoints.map((p) => applyHomography(Hinv, p));
  let sum = 0;
  for (let i = 0; i < w.length; i++) {
    const p = w[i];
    const q = w[(i + 1) % w.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** Interior angle at vertex `b`, in degrees, measured on the plane. */
export function measureAngle(Hinv, a, b, c) {
  const A = applyHomography(Hinv, a);
  const B = applyHomography(Hinv, b);
  const C = applyHomography(Hinv, c);
  const v1 = { x: A.x - B.x, y: A.y - B.y };
  const v2 = { x: C.x - B.x, y: C.y - B.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (mag < 1e-12) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

// ------------------------------------------------------- uncertainty budget

/**
 * Monte-Carlo propagation of target-corner localisation noise through the
 * homography onto a specific measured distance.
 *
 * This is the accurate way to obtain the geometric term: perturbing the detected
 * target corners and re-solving is exact by construction, and it automatically
 * captures the strong error amplification that occurs when measuring far outside
 * the calibration target. The closed-form approximation in
 * `approximateGeometricSigma` systematically under-predicts that amplification,
 * so this function is preferred whenever the target correspondences are known.
 *
 * @returns {{sigmaMm:number, meanMm:number, trials:number}}
 */
export function propagateHomographyUncertainty({
  world,
  image,
  a,
  b,
  detectPx = 0.5,
  trials = 400,
  seed = 0x5eed,
}) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const samples = [];
  for (let t = 0; t < trials; t++) {
    const perturbed = image.map((p) => ({
      x: p.x + gauss() * detectPx,
      y: p.y + gauss() * detectPx,
    }));
    try {
      const Hinv = invert3x3(computeHomography(world, perturbed));
      const d = measureDistance(Hinv, a, b);
      if (isFinite(d)) samples.push(d);
    } catch {
      /* degenerate perturbation: skip */
    }
  }

  if (samples.length < 2) return { sigmaMm: NaN, meanMm: NaN, trials: samples.length };
  const mean = samples.reduce((x, y) => x + y, 0) / samples.length;
  const variance =
    samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (samples.length - 1);
  return { sigmaMm: Math.sqrt(variance), meanMm: mean, trials: samples.length };
}

/**
 * Closed-form fallback for the geometric term when the target correspondences
 * are not available (for example CAL-2, or a re-opened archived measurement).
 *
 * The amplification is quadratic in the extrapolation ratio. That was not a
 * guess: Monte-Carlo propagation showed a naive linear form
 * (sqrt(2)*detectPx*gsd*(1+ratio)) gives only ~89% coverage at 2 sigma, and
 * under-predicts by ~40% once a measurement extends more than two target-radii
 * beyond the calibration target. This form is deliberately a slight
 * over-estimate; prefer `propagateHomographyUncertainty` when you can.
 */
export function approximateGeometricSigma({ gsdMmPerPx, detectPx = 0.5, extrapolationRatio = 0 }) {
  const r = Math.max(0, extrapolationRatio);
  return 2.0 * detectPx * gsdMmPerPx * (1 + r) ** 2;
}

/**
 * Combined standard uncertainty (1 sigma, mm) for a single measured distance.
 * See docs/02-calibration-methodology.md section 3.3.
 *
 * Terms, combined in quadrature:
 *   sigmaTarget  certified tolerance of the physical scale/target (mm)
 *   sigmaGeom    target-corner localisation, propagated through the homography and
 *                amplified when measuring away from the calibrated target.
 *                Pass `sigmaGeomMm` from `propagateHomographyUncertainty` for the
 *                accurate value; otherwise a conservative closed form is used.
 *   sigmaPick    operator endpoint picking error (two endpoints -> sqrt(2))
 *   sigmaPlane   depth offset of the feature from the calibrated plane
 *   sigmaLens    residual (uncorrected) lens distortion, as a fraction of length
 */
export function measurementUncertainty({
  gsdMmPerPx,
  measuredMm,
  targetToleranceMm = 0.1,
  detectPx = 0.5,
  pickPx = 1.5,
  extrapolationRatio = 0,
  depthOffsetMm = 0,
  distanceToPlaneMm = 0,
  offAxisRatio = 0,
  lensResidualPct = 0,
  sigmaGeomMm = null,
}) {
  const sigmaTarget = targetToleranceMm;
  const sigmaGeom =
    sigmaGeomMm != null && isFinite(sigmaGeomMm)
      ? sigmaGeomMm
      : approximateGeometricSigma({ gsdMmPerPx, detectPx, extrapolationRatio });
  const sigmaPick = Math.SQRT2 * pickPx * gsdMmPerPx;
  const sigmaPlane =
    distanceToPlaneMm > 0 ? Math.abs(depthOffsetMm) * Math.abs(offAxisRatio) : 0;
  const sigmaLens = (lensResidualPct / 100) * Math.abs(measuredMm);

  const total = Math.sqrt(
    sigmaTarget ** 2 + sigmaGeom ** 2 + sigmaPick ** 2 + sigmaPlane ** 2 + sigmaLens ** 2
  );

  return {
    sigmaTarget,
    sigmaGeom,
    sigmaPick,
    sigmaPlane,
    sigmaLens,
    sigmaTotalMm: total,
    expandedMm: 2 * total, // ~95% coverage
  };
}

/**
 * How far outside the calibration target a measurement sits, normalised by the
 * target's own half-diagonal. 0 = inside the target, 1 = one target-radius outside.
 * Drives the amplification term in `measurementUncertainty`.
 */
export function extrapolationRatio(targetImagePoints, measurementImagePoints) {
  const n = targetImagePoints.length;
  const cx = targetImagePoints.reduce((s, p) => s + p.x, 0) / n;
  const cy = targetImagePoints.reduce((s, p) => s + p.y, 0) / n;
  const centroid = { x: cx, y: cy };
  const radius = Math.max(...targetImagePoints.map((p) => distance(p, centroid)));
  if (radius < 1e-9) return 0;
  const far = Math.max(...measurementImagePoints.map((p) => distance(p, centroid)));
  return Math.max(0, far / radius - 1);
}

// --------------------------------------------------------- check validation

/**
 * Validate a calibration against hold-out check distances that were NOT used in
 * the homography fit. Returns a pass/fail verdict for the whole calibration.
 *
 * @param {number[][]} Hinv
 * @param {{label:string, knownMm:number, a:{x,y}, b:{x,y}}[]} checks
 * @param {number} tolerancePct
 */
export function validateChecks(Hinv, checks, tolerancePct = 1.0) {
  const results = checks.map((c) => {
    const measuredMm = measureDistance(Hinv, c.a, c.b);
    const errorMm = measuredMm - c.knownMm;
    const errorPct = c.knownMm !== 0 ? (100 * errorMm) / c.knownMm : NaN;
    return {
      label: c.label,
      knownMm: c.knownMm,
      measuredMm,
      errorMm,
      errorPct,
      pass: Math.abs(errorPct) <= tolerancePct,
    };
  });

  return {
    results,
    // A calibration with no independent check is never VERIFIED.
    status: results.length === 0 ? 'UNVERIFIED' : results.every((r) => r.pass) ? 'VERIFIED' : 'FAILED',
    worstErrorPct: results.length ? Math.max(...results.map((r) => Math.abs(r.errorPct))) : null,
  };
}

// ----------------------------------------------------------- CAL-1 / CAL-2

/**
 * CAL-1 nominal GSD from EXIF 35mm-equivalent focal length and an operator-supplied
 * subject distance. Indicative only (+/-10-30%): assumes a fronto-parallel plane and
 * ignores lens distortion.
 */
export function gsdFromFocal35({ focal35mm, distanceMm, imageWidthPx, fullFrameWidthMm = 36 }) {
  if (!(focal35mm > 0) || !(distanceMm > 0) || !(imageWidthPx > 0)) {
    throw new Error('focal35mm, distanceMm and imageWidthPx must all be positive.');
  }
  return (fullFrameWidthMm * distanceMm) / (focal35mm * imageWidthPx);
}

/** CAL-1 GSD from a physical sensor width and true focal length. */
export function gsdFromSensor({ sensorWidthMm, focalLengthMm, distanceMm, imageWidthPx }) {
  if (!(sensorWidthMm > 0) || !(focalLengthMm > 0) || !(distanceMm > 0) || !(imageWidthPx > 0)) {
    throw new Error('All sensor GSD inputs must be positive.');
  }
  return (sensorWidthMm * distanceMm) / (focalLengthMm * imageWidthPx);
}

/** CAL-2 uniform scale from one known length drawn in the plane. */
export function scaleFromKnownLength({ knownMm, a, b }) {
  const px = distance(a, b);
  if (px < 1e-9) throw new Error('The two reference points are coincident.');
  return knownMm / px;
}

// --------------------------------------------------------------- grid & view

/**
 * Generate a real-world grid on the calibrated plane and project it into image
 * space. On an oblique photograph the returned lines correctly converge — that
 * visible convergence is the operator's obliquity cue.
 *
 * @returns {{lines: {a:{x,y}, b:{x,y}, axis:'x'|'y', worldValue:number, major:boolean}[]}}
 */
export function buildMetricGrid(H, {
  worldBounds,           // {minX, minY, maxX, maxY} in mm
  intervalMm = 100,
  majorEvery = 10,
  segments = 24,         // subdivisions per line, so curvature/convergence renders correctly
}) {
  const lines = [];
  const { minX, minY, maxX, maxY } = worldBounds;

  const project = (x, y) => applyHomography(H, { x, y });

  const startX = Math.ceil(minX / intervalMm) * intervalMm;
  for (let x = startX; x <= maxX + 1e-9; x += intervalMm) {
    const major = Math.round(x / intervalMm) % majorEvery === 0;
    for (let s = 0; s < segments; s++) {
      const y0 = minY + ((maxY - minY) * s) / segments;
      const y1 = minY + ((maxY - minY) * (s + 1)) / segments;
      lines.push({ a: project(x, y0), b: project(x, y1), axis: 'x', worldValue: x, major });
    }
  }

  const startY = Math.ceil(minY / intervalMm) * intervalMm;
  for (let y = startY; y <= maxY + 1e-9; y += intervalMm) {
    const major = Math.round(y / intervalMm) % majorEvery === 0;
    for (let s = 0; s < segments; s++) {
      const x0 = minX + ((maxX - minX) * s) / segments;
      const x1 = minX + ((maxX - minX) * (s + 1)) / segments;
      lines.push({ a: project(x0, y), b: project(x1, y), axis: 'y', worldValue: y, major });
    }
  }

  return { lines, intervalMm, majorEvery };
}

/** World-space bounding box of an image rectangle, used to size the rectified view. */
export function worldBoundsOfImage(Hinv, widthPx, heightPx) {
  const corners = [
    { x: 0, y: 0 },
    { x: widthPx, y: 0 },
    { x: widthPx, y: heightPx },
    { x: 0, y: heightPx },
  ].map((p) => applyHomography(Hinv, p));

  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
    corners,
  };
}

// ----------------------------------------------------------------- tiers

export const CALIBRATION_TIERS = {
  'CAL-0': { label: 'Uncalibrated', tolerancePct: null, measurable: false, note: 'Composition grid only. NOT TO SCALE.' },
  'CAL-1': { label: 'Nominal / EXIF-derived', tolerancePct: 30, measurable: true, note: 'Indicative only. Not acceptable for a Landmarks deliverable.' },
  'CAL-2': { label: 'Known length in plane', tolerancePct: 3, measurable: true, note: 'Valid along the reference direction near frame centre.' },
  'CAL-3': { label: 'Planar homography (4-point)', tolerancePct: 1.5, measurable: true, note: 'Primary mode. Valid across the calibrated plane.' },
  'CAL-4': { label: 'Intrinsics + undistortion', tolerancePct: 0.5, measurable: true, note: 'Requires a per-device lens profile.' },
  'CAL-5': { label: 'Externally controlled', tolerancePct: 0.2, measurable: true, note: 'Laser / total station / RTK control. Surveyor sign-off possible.' },
};

/** Map a 1-sigma uncertainty to the USIBD Level of Accuracy band it satisfies. */
export function usibdLoa(sigmaTotalMm) {
  const expanded = 2 * sigmaTotalMm; // report at ~95%
  if (expanded <= 1) return { loa: 'LOA50', toleranceMm: 1 };
  if (expanded <= 3) return { loa: 'LOA40', toleranceMm: 3 };
  if (expanded <= 6) return { loa: 'LOA30', toleranceMm: 6 };
  if (expanded <= 15) return { loa: 'LOA20', toleranceMm: 15 };
  if (expanded <= 50) return { loa: 'LOA10', toleranceMm: 50 };
  return { loa: 'below LOA10', toleranceMm: null };
}

export function formatMeasurement(valueMm, sigmaMm, unit = 'mm') {
  const conv = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, ft: 1 / 304.8 };
  const f = conv[unit] ?? 1;
  const dp = unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3;
  return `${(valueMm * f).toFixed(dp)} ± ${(2 * sigmaMm * f).toFixed(dp)} ${unit} (95%)`;
}
