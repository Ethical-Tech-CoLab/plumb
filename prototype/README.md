# Plumb prototype — browser metrology proof of concept

A dependency-free, build-step-free browser app that proves the client-side claims in
[../docs/04-implementation-plan.md](../docs/04-implementation-plan.md).

**Android Chrome is the reference platform.** The app detects the platform and tells you which tier
you are on; on iOS Safari it degrades honestly rather than pretending.

## Run

```powershell
cd prototype
python -m http.server 8777
# then open http://127.0.0.1:8777/
```

Camera access needs a secure context — `127.0.0.1` counts as secure. To test on a real Android phone
over the LAN you need HTTPS (e.g. an `ngrok`/`cloudflared` tunnel or a locally-trusted cert).

## Test

```powershell
node --test test/geometry.test.mjs test/level.test.mjs test/capture.test.mjs
```

52 tests. Two are explicit exit criteria from the plan:

- `CAL-3` recovers known distances to **better than 0.5 %** under 0.5 px corner-detection noise.
- The reported uncertainty **brackets true error in ≥ 95 % of trials** (Monte-Carlo, 2000 runs).

## Try it without a camera

1. Load any photo containing a rectangle whose real size you know.
2. **2 · Calibrate** → enter the measured width/height → *Pick 4 corners* (TL, TR, BR, BL) →
   *Solve calibration*.
3. **3 · Verify** → enter a known length you did *not* use in the fit → *Pick check points*.
   The status only reaches **VERIFIED** when a hold-out check passes.
4. **4 · Measure** → *Measure distance* → pick two points. You get `value ± 2σ (95 %)` with the
   calibration tier and the USIBD LOA band.
5. Toggle **Metric grid** and **Ruler** — on an oblique photo the grid correctly converges.
6. **6 · Export** → raw image (byte-identical), overlay PNG, annotated derivative, provenance sidecar.

## What it demonstrates

| Claim | How |
|---|---|
| Full-resolution capture in-page on Android | `ImageCapture.takePhoto()` with `getPhotoCapabilities()` max dimensions |
| **Optics lock keeps intrinsics stable** | `focusMode` / `exposureMode` / `whiteBalanceMode` / `zoom` constraints; `lens_profile_valid` recorded |
| Metric grid that is genuinely metric | Real-world grid projected through the homography — converges under perspective |
| Calibration from a known rectangle | Normalised DLT + Jacobi eigen solve, least-squares for > 4 points |
| Verification is mandatory | Hold-out check; no check ⇒ `UNVERIFIED`, failed check ⇒ `FAILED` |
| Honest uncertainty | Monte-Carlo propagation of corner noise through the homography, 5-term budget |
| Raw stays raw | Overlay is a separate canvas and a separate export; the original is never re-encoded |
| Provenance sidecar | SHA-256, sensors, capture profile, calibration record, and an explicit `unverified` list |
| Android AR measurement + measured off-plane depth | WebXR `hit-test` + `depth-sensing`, plane fit by Newell's method |

## Files

| File | Role |
|---|---|
| [lib/geometry.js](lib/geometry.js) | Metrology core — homography, measurement, uncertainty, tiers, LOA. Pure, testable, portable. |
| [lib/camera.js](lib/camera.js) | Android-first capture: full-res stills, optics locking, capture profile |
| [lib/arxr.js](lib/arxr.js) | WebXR AR measurement and ARCore depth / plane-deviation |
| [lib/overlay.js](lib/overlay.js) | Grid, ruler, target quad, measurement rendering — always on a separate canvas |
| [lib/level.js](lib/level.js) | Pose smoothing, graded tolerances, steadiness, bubble level, auto-capture readiness |
| [lib/manifest.js](lib/manifest.js) | Provenance sidecar, hashing, sensors, capability probe |
| [app.js](app.js) | UI wiring |
| [test/geometry.test.mjs](test/geometry.test.mjs) | 26 tests incl. Monte-Carlo coverage validation |
| [test/level.test.mjs](test/level.test.mjs) | 16 tests for tolerances, hysteresis, smoothing, steadiness |
| [test/capture.test.mjs](test/capture.test.mjs) | 10 tests for capture fallbacks, re-entrancy, empty-frame rejection |

## Scope

This is a **proof of concept for the client**, not the product. Not implemented here: automatic
fiducial detection, lens undistortion, offline queue and sync, the server pipeline, and C2PA signing —
all of which are specified in the docs and belong to Phases 1–3.

One deliberate honesty note: in-field measurement is **provisional**. In the real system the
authoritative number comes from server post-processing
(see [../docs/05-server-and-provenance.md](../docs/05-server-and-provenance.md)).
