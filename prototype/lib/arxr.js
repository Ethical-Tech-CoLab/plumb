/**
 * arxr.js — WebXR measurement and depth sensing (Android / ARCore).
 *
 * Two things this buys us that single-image metrology cannot do on its own:
 *
 *  1. Marker-free measurement. Hit-test against detected real-world geometry and
 *     measure between two anchored points — no printed target, no known rectangle.
 *
 *  2. Off-plane depth, MEASURED rather than typed. The dominant error in planar
 *     rectification is a feature standing proud of the calibrated plane. With the
 *     ARCore depth stream we can measure that offset instead of asking the
 *     operator to estimate it, which converts the biggest silent error source
 *     into an observed quantity.
 *
 * Not available on iOS Safari. That is an iOS limitation, not a reason to leave
 * it out of the Android product.
 */

export async function xrSupport() {
  if (!navigator.xr) {
    return { available: false, reason: 'navigator.xr is not present (no WebXR in this browser).' };
  }
  try {
    const ar = await navigator.xr.isSessionSupported('immersive-ar');
    return {
      available: ar,
      reason: ar ? 'immersive-ar supported' : 'immersive-ar not supported on this device.',
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Start an immersive-AR session with hit-test, and depth-sensing when the device
 * offers it. Depth is requested as optional so a device without ARCore depth
 * still gets marker-free measurement.
 */
export async function startArMeasureSession({ onPoint, onEnd, onStatus } = {}) {
  const support = await xrSupport();
  if (!support.available) throw new Error(support.reason);

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['depth-sensing', 'anchors', 'dom-overlay', 'light-estimation'],
    depthSensing: {
      usagePreference: ['cpu-optimized', 'gpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
  });

  const refSpace = await session.requestReferenceSpace('local-floor');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  const points = [];
  let depthAvailable = false;

  const state = {
    session,
    points,
    get depthAvailable() { return depthAvailable; },
    /** Record the current hit-test position as a measurement point. */
    capture: null,
    end: () => session.end(),
  };

  session.addEventListener('end', () => {
    hitTestSource?.cancel?.();
    onEnd?.(points);
  });

  let latestHit = null;

  const onFrame = (time, frame) => {
    session.requestAnimationFrame(onFrame);

    const pose = frame.getViewerPose(refSpace);
    if (!pose) return;

    // Depth availability check, once we have a view to ask about.
    if (!depthAvailable && frame.getDepthInformation) {
      for (const view of pose.views) {
        try {
          if (frame.getDepthInformation(view)) {
            depthAvailable = true;
            onStatus?.({ depthAvailable: true });
            break;
          }
        } catch { /* depth not available on this frame */ }
      }
    }

    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      const hitPose = hits[0].getPose(refSpace);
      if (hitPose) {
        latestHit = {
          x: hitPose.transform.position.x,
          y: hitPose.transform.position.y,
          z: hitPose.transform.position.z,
        };
      }
    }
  };

  state.capture = () => {
    if (!latestHit) return null;
    const p = { ...latestHit, at: new Date().toISOString() };
    points.push(p);
    onPoint?.(p, points);
    return p;
  };

  session.addEventListener('select', () => state.capture());
  session.requestAnimationFrame(onFrame);

  return state;
}

/** Straight-line distance between two WebXR points, in millimetres. */
export function xrDistanceMm(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 1000;
}

/**
 * Fit a plane to >=3 WebXR points and report how far each point lies off it.
 * Used to MEASURE the off-plane depth of a feature instead of having the
 * operator estimate it, and to validate that a "flat" facade really is flat.
 */
export function planeDeviationMm(points) {
  if (points.length < 3) return null;

  const n = points.length;
  const c = points.reduce(
    (acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n, z: acc.z + p.z / n }),
    { x: 0, y: 0, z: 0 }
  );

  // Plane normal by Newell's method — robust for non-triangular polygons.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    nx += (p.y - q.y) * (p.z + q.z);
    ny += (p.z - q.z) * (p.x + q.x);
    nz += (p.x - q.x) * (p.y + q.y);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  nx /= len; ny /= len; nz /= len;

  const deviations = points.map(
    (p) => ((p.x - c.x) * nx + (p.y - c.y) * ny + (p.z - c.z) * nz) * 1000
  );

  return {
    normal: { x: nx, y: ny, z: nz },
    centroid: c,
    deviationsMm: deviations,
    maxAbsMm: Math.max(...deviations.map(Math.abs)),
    rmsMm: Math.sqrt(deviations.reduce((s, d) => s + d * d, 0) / deviations.length),
  };
}
