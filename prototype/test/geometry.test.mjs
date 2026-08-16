/**
 * Unit tests for the metrology core.
 * Run: node --test prototype/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeHomography,
  invert3x3,
  applyHomography,
  matMul3,
  measureDistance,
  measureArea,
  measureAngle,
  reprojectionResiduals,
  localGsd,
  measurementUncertainty,
  approximateGeometricSigma,
  propagateHomographyUncertainty,
  extrapolationRatio,
  validateChecks,
  gsdFromFocal35,
  gsdFromSensor,
  scaleFromKnownLength,
  buildMetricGrid,
  worldBoundsOfImage,
  usibdLoa,
  formatMeasurement,
} from '../lib/geometry.js';

// ---------------------------------------------------------------- fixtures

/**
 * A synthetic "camera": a genuine projective transform mapping millimetres on a
 * facade plane to pixels in a 4000x3000 photograph, shot obliquely.
 */
const TRUE_H = [
  [2.9, 0.42, 480],
  [-0.31, 2.78, 320],
  [0.00016, 0.00009, 1],
];

const TRUE_HINV = invert3x3(TRUE_H);

/** 600 x 400 mm calibration target lying on the plane at the origin. */
const TARGET_WORLD = [
  { x: 0, y: 0 },
  { x: 600, y: 0 },
  { x: 600, y: 400 },
  { x: 0, y: 400 },
];

const project = (p) => applyHomography(TRUE_H, p);
const TARGET_IMAGE = TARGET_WORLD.map(project);

/** Deterministic Gaussian noise so the Monte Carlo test is reproducible. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------ matrix basics

test('invert3x3 round-trips to the identity', () => {
  const I = matMul3(TRUE_H, invert3x3(TRUE_H));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(I[i][j] - (i === j ? 1 : 0)) < 1e-9, `I[${i}][${j}] = ${I[i][j]}`);
    }
  }
});

test('invert3x3 rejects a singular matrix', () => {
  assert.throws(() => invert3x3([[1, 2, 3], [2, 4, 6], [3, 6, 9]]), /singular/i);
});

// -------------------------------------------------------- homography recovery

test('computeHomography recovers a known transform from 4 exact points', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);

  for (const w of [
    { x: 0, y: 0 },
    { x: 600, y: 400 },
    { x: 1500, y: 900 },
    { x: -200, y: 250 },
  ]) {
    const expected = applyHomography(TRUE_H, w);
    const actual = applyHomography(H, w);
    assert.ok(Math.hypot(expected.x - actual.x, expected.y - actual.y) < 1e-6,
      `world (${w.x},${w.y}) reprojected off by more than 1e-6 px`);
  }
});

test('computeHomography least-squares improves with redundant points', () => {
  const world = [
    ...TARGET_WORLD,
    { x: 300, y: 0 }, { x: 600, y: 200 }, { x: 300, y: 400 }, { x: 0, y: 200 }, { x: 300, y: 200 },
  ];
  const image = world.map(project);
  const H = computeHomography(world, image);
  const res = reprojectionResiduals(H, world, image);
  assert.ok(res.rmsPx < 1e-6, `rmsPx = ${res.rmsPx}`);
  assert.ok(res.rmsMm < 1e-6, `rmsMm = ${res.rmsMm}`);
});

test('computeHomography rejects fewer than 4 correspondences', () => {
  assert.throws(() => computeHomography(TARGET_WORLD.slice(0, 3), TARGET_IMAGE.slice(0, 3)), /4 point/i);
});

test('computeHomography rejects mismatched array lengths', () => {
  assert.throws(() => computeHomography(TARGET_WORLD, TARGET_IMAGE.slice(0, 3)), /same length/i);
});

test('collinear points are reported rather than silently producing garbage', () => {
  const world = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
  const image = world.map(project);
  assert.throws(() => {
    const H = computeHomography(world, image);
    invert3x3(H);
  });
});

// ------------------------------------------------------------- measurement

test('measureDistance recovers known world lengths from image points', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);
  const Hinv = invert3x3(H);

  const cases = [
    [{ x: 0, y: 0 }, { x: 600, y: 0 }, 600],
    [{ x: 0, y: 0 }, { x: 0, y: 400 }, 400],
    [{ x: 0, y: 0 }, { x: 600, y: 400 }, Math.hypot(600, 400)],
    [{ x: 1200, y: 150 }, { x: 1200, y: 2650 }, 2500], // well outside the target
  ];

  for (const [a, b, expected] of cases) {
    const measured = measureDistance(Hinv, project(a), project(b));
    assert.ok(Math.abs(measured - expected) < 1e-6,
      `expected ${expected} mm, got ${measured} mm`);
  }
});

test('measureArea recovers a known rectangle area', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);
  const Hinv = invert3x3(H);
  const area = measureArea(Hinv, TARGET_IMAGE);
  assert.ok(Math.abs(area - 600 * 400) < 1e-3, `area = ${area}`);
});

test('measureAngle recovers a known right angle', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);
  const Hinv = invert3x3(H);
  const deg = measureAngle(Hinv, project({ x: 600, y: 0 }), project({ x: 0, y: 0 }), project({ x: 0, y: 400 }));
  assert.ok(Math.abs(deg - 90) < 1e-6, `angle = ${deg}`);
});

test('localGsd varies across a perspective frame and is positive everywhere', () => {
  const Hinv = TRUE_HINV;
  const near = localGsd(Hinv, { x: 600, y: 400 });
  const far = localGsd(Hinv, { x: 3600, y: 2600 });
  assert.ok(near > 0 && far > 0);
  assert.ok(Math.abs(near - far) / near > 0.05,
    'expected a meaningful GSD gradient across an oblique frame');
});

// ------------------------------------------------- hold-out check validation

test('validateChecks passes a good calibration and fails a bad one', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);
  const Hinv = invert3x3(H);

  const good = validateChecks(Hinv, [
    { label: 'window head', knownMm: 1220, a: project({ x: 900, y: 100 }), b: project({ x: 2120, y: 100 }) },
    { label: '10 courses', knownMm: 2000, a: project({ x: 900, y: 100 }), b: project({ x: 900, y: 2100 }) },
  ], 1.0);
  assert.equal(good.status, 'VERIFIED');
  assert.ok(good.worstErrorPct < 1e-6);

  const bad = validateChecks(Hinv, [
    { label: 'wrong known length', knownMm: 1500, a: project({ x: 900, y: 100 }), b: project({ x: 2120, y: 100 }) },
  ], 1.0);
  assert.equal(bad.status, 'FAILED');
});

test('a calibration with no independent check is never VERIFIED', () => {
  const Hinv = TRUE_HINV;
  assert.equal(validateChecks(Hinv, []).status, 'UNVERIFIED');
});

// ------------------------------------ Phase 0 exit criteria (Monte Carlo)

test('EXIT CRITERION: CAL-3 recovers known distances to better than 0.5% under 0.5px corner noise', () => {
  const rng = makeRng(20260816);
  const detectPx = 0.5;
  const trials = 2000;
  const errorsPct = [];

  const A = { x: 100, y: 60 };
  const B = { x: 500, y: 340 };
  const trueMm = Math.hypot(B.x - A.x, B.y - A.y);
  const imgA = project(A);
  const imgB = project(B);

  for (let t = 0; t < trials; t++) {
    const noisy = TARGET_IMAGE.map((p) => ({
      x: p.x + gaussian(rng) * detectPx,
      y: p.y + gaussian(rng) * detectPx,
    }));
    const Hinv = invert3x3(computeHomography(TARGET_WORLD, noisy));
    const measured = measureDistance(Hinv, imgA, imgB);
    errorsPct.push((100 * (measured - trueMm)) / trueMm);
  }

  const rmsPct = Math.sqrt(errorsPct.reduce((s, e) => s + e * e, 0) / trials);
  const maxPct = Math.max(...errorsPct.map(Math.abs));

  assert.ok(rmsPct < 0.5, `RMS error ${rmsPct.toFixed(4)}% should be < 0.5%`);
  assert.ok(maxPct < 2.0, `worst-case error ${maxPct.toFixed(4)}% unexpectedly large`);
});

test('EXIT CRITERION: reported sigma brackets true error in at least 95% of trials', () => {
  const rng = makeRng(987654321);
  const detectPx = 0.5;
  const pickPx = 1.0;
  const trials = 2000;

  // Measure a span that extends beyond the calibration target, so the
  // extrapolation amplification term is genuinely exercised.
  const A = { x: -100, y: -80 };
  const B = { x: 900, y: 620 };
  const trueMm = Math.hypot(B.x - A.x, B.y - A.y);
  const imgA = project(A);
  const imgB = project(B);

  const Hinv0 = invert3x3(computeHomography(TARGET_WORLD, TARGET_IMAGE));
  const gsd = (localGsd(Hinv0, imgA) + localGsd(Hinv0, imgB)) / 2;

  // Accurate geometric term by propagating corner noise through the homography.
  const geom = propagateHomographyUncertainty({
    world: TARGET_WORLD,
    image: TARGET_IMAGE,
    a: imgA,
    b: imgB,
    detectPx,
    trials: 600,
  });

  const u = measurementUncertainty({
    gsdMmPerPx: gsd,
    measuredMm: trueMm,
    targetToleranceMm: 0.1,
    detectPx,
    pickPx,
    sigmaGeomMm: geom.sigmaMm,
  });

  let bracketed = 0;
  for (let t = 0; t < trials; t++) {
    const noisyTarget = TARGET_IMAGE.map((p) => ({
      x: p.x + gaussian(rng) * detectPx,
      y: p.y + gaussian(rng) * detectPx,
    }));
    const noisyA = { x: imgA.x + gaussian(rng) * pickPx, y: imgA.y + gaussian(rng) * pickPx };
    const noisyB = { x: imgB.x + gaussian(rng) * pickPx, y: imgB.y + gaussian(rng) * pickPx };

    const Hinv = invert3x3(computeHomography(TARGET_WORLD, noisyTarget));
    const measured = measureDistance(Hinv, noisyA, noisyB);
    if (Math.abs(measured - trueMm) <= u.expandedMm) bracketed++;
  }

  const coverage = bracketed / trials;
  assert.ok(coverage >= 0.95,
    `coverage ${(coverage * 100).toFixed(2)}% should be >= 95% (expanded sigma = ${u.expandedMm.toFixed(2)} mm)`);
});

test('the closed-form geometric sigma is conservative relative to Monte-Carlo propagation', () => {
  const detectPx = 0.5;
  const cases = [
    [{ x: 100, y: 60 }, { x: 500, y: 340 }],     // inside the target
    [{ x: -100, y: -80 }, { x: 900, y: 620 }],   // just outside
    [{ x: 0, y: 0 }, { x: 1800, y: 1200 }],      // well outside
  ];

  const Hinv0 = invert3x3(computeHomography(TARGET_WORLD, TARGET_IMAGE));

  for (const [A, B] of cases) {
    const imgA = project(A);
    const imgB = project(B);
    const gsd = (localGsd(Hinv0, imgA) + localGsd(Hinv0, imgB)) / 2;
    const ratio = extrapolationRatio(TARGET_IMAGE, [imgA, imgB]);

    const mc = propagateHomographyUncertainty({
      world: TARGET_WORLD, image: TARGET_IMAGE, a: imgA, b: imgB, detectPx, trials: 600,
    }).sigmaMm;
    const closed = approximateGeometricSigma({ gsdMmPerPx: gsd, detectPx, extrapolationRatio: ratio });

    assert.ok(closed >= mc,
      `closed form ${closed.toFixed(3)} mm must not under-predict Monte-Carlo ${mc.toFixed(3)} mm ` +
      `(extrapolation ratio ${ratio.toFixed(2)})`);
  }
});

// ------------------------------------------------------- uncertainty budget

test('measurementUncertainty combines terms in quadrature', () => {
  const u = measurementUncertainty({
    gsdMmPerPx: 2,
    measuredMm: 1000,
    targetToleranceMm: 0.1,
    detectPx: 0.5,
    pickPx: 1.5,
    extrapolationRatio: 0,
    lensResidualPct: 0.2,
  });

  const expected = Math.sqrt(
    u.sigmaTarget ** 2 + u.sigmaGeom ** 2 + u.sigmaPick ** 2 + u.sigmaPlane ** 2 + u.sigmaLens ** 2
  );
  assert.ok(Math.abs(u.sigmaTotalMm - expected) < 1e-12);
  assert.ok(Math.abs(u.expandedMm - 2 * u.sigmaTotalMm) < 1e-12);
  assert.ok(Math.abs(u.sigmaLens - 2) < 1e-12, '0.2% of 1000 mm = 2 mm');
});

test('off-plane depth inflates the uncertainty budget', () => {
  const base = { gsdMmPerPx: 2, measuredMm: 1000, detectPx: 0.5, pickPx: 1.5 };
  const flat = measurementUncertainty(base);
  const proud = measurementUncertainty({
    ...base,
    depthOffsetMm: 600,
    distanceToPlaneMm: 15000,
    offAxisRatio: 0.4,
  });
  assert.ok(proud.sigmaPlane > 200, 'a 600 mm cornice at 0.4 off-axis should dominate');
  assert.ok(proud.sigmaTotalMm > flat.sigmaTotalMm * 10);
});

test('extrapolationRatio is 0 inside the target and grows outside it', () => {
  assert.equal(extrapolationRatio(TARGET_IMAGE, [project({ x: 300, y: 200 })]), 0);
  const far = extrapolationRatio(TARGET_IMAGE, [project({ x: 3000, y: 2000 })]);
  assert.ok(far > 1, `expected significant extrapolation, got ${far}`);
});

// ---------------------------------------------------------------- CAL-1/2

test('gsdFromFocal35 matches the documented formula', () => {
  // 26 mm equivalent, 10 m away, 4000 px wide
  const gsd = gsdFromFocal35({ focal35mm: 26, distanceMm: 10000, imageWidthPx: 4000 });
  assert.ok(Math.abs(gsd - (36 * 10000) / (26 * 4000)) < 1e-12);
  assert.ok(gsd > 3.4 && gsd < 3.5, `gsd = ${gsd}`);
});

test('gsdFromSensor matches the documented formula and rejects bad input', () => {
  const gsd = gsdFromSensor({ sensorWidthMm: 9.8, focalLengthMm: 6.86, distanceMm: 10000, imageWidthPx: 4032 });
  assert.ok(Math.abs(gsd - (9.8 * 10000) / (6.86 * 4032)) < 1e-12);
  assert.throws(() => gsdFromSensor({ sensorWidthMm: 0, focalLengthMm: 1, distanceMm: 1, imageWidthPx: 1 }));
});

test('scaleFromKnownLength converts pixels to millimetres', () => {
  const s = scaleFromKnownLength({ knownMm: 1000, a: { x: 0, y: 0 }, b: { x: 500, y: 0 } });
  assert.equal(s, 2);
  assert.throws(() => scaleFromKnownLength({ knownMm: 1000, a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }), /coincident/i);
});

// -------------------------------------------------------------- grid & view

test('buildMetricGrid projects a real-world grid and converges under perspective', () => {
  const H = computeHomography(TARGET_WORLD, TARGET_IMAGE);
  const grid = buildMetricGrid(H, {
    worldBounds: { minX: 0, minY: 0, maxX: 600, maxY: 400 },
    intervalMm: 100,
    majorEvery: 5,
    segments: 4,
  });

  assert.ok(grid.lines.length > 0);
  assert.ok(grid.lines.every((l) => Number.isFinite(l.a.x) && Number.isFinite(l.b.y)));

  // Under a true perspective transform, equal world spacing must NOT map to equal
  // pixel spacing — that inequality is what makes the grid metrically honest.
  const vertical = grid.lines.filter((l) => l.axis === 'x');
  const xs = [...new Set(vertical.map((l) => l.worldValue))].sort((a, b) => a - b);
  const px = xs.map((x) => applyHomography(H, { x, y: 0 }).x);
  const gaps = px.slice(1).map((v, i) => v - px[i]);
  const spread = (Math.max(...gaps) - Math.min(...gaps)) / Math.max(...gaps);
  assert.ok(spread > 0.01, `expected perspective convergence in the grid, spread = ${spread}`);

  // Major lines must land exactly on multiples of interval * majorEvery.
  for (const l of grid.lines.filter((g) => g.major)) {
    assert.equal(Math.round(l.worldValue / 100) % 5, 0);
  }
});

test('worldBoundsOfImage returns a sane box covering the image corners', () => {
  const b = worldBoundsOfImage(TRUE_HINV, 4000, 3000);
  assert.ok(b.maxX > b.minX && b.maxY > b.minY);
  assert.equal(b.corners.length, 4);
  const origin = applyHomography(TRUE_HINV, { x: 0, y: 0 });
  assert.ok(origin.x >= b.minX - 1e-6 && origin.x <= b.maxX + 1e-6);
});

// ------------------------------------------------------------ reporting

test('usibdLoa maps expanded uncertainty onto the correct LOA band', () => {
  assert.equal(usibdLoa(0.4).loa, 'LOA50');   // 0.8 mm expanded
  assert.equal(usibdLoa(1.0).loa, 'LOA40');   // 2 mm
  assert.equal(usibdLoa(2.5).loa, 'LOA30');   // 5 mm
  assert.equal(usibdLoa(7).loa, 'LOA20');     // 14 mm
  assert.equal(usibdLoa(20).loa, 'LOA10');    // 40 mm
  assert.equal(usibdLoa(100).loa, 'below LOA10');
});

test('formatMeasurement always reports an expanded (95%) uncertainty', () => {
  assert.equal(formatMeasurement(1220, 3, 'mm'), '1220.0 ± 6.0 mm (95%)');
  assert.equal(formatMeasurement(1000, 5, 'm'), '1.000 ± 0.010 m (95%)');
});
