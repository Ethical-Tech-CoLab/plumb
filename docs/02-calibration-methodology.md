# 02 — Calibration Methodology

> **The one-sentence answer:** you cannot calibrate an on-screen grid from the camera alone, because
> browsers do not expose camera intrinsics and phone GNSS is ~1.6 m at best. **Scale must be carried
> into the scene as a physical object of certified length, recovered from the image by homography, and
> then verified against an independent check distance that was not used in the fit.**

---

## 0. Why the naive approach fails

A screen-space grid ("every 50 px = 100 mm") is only valid for a single object plane at a single
distance with a single lens. The moment the operator steps back, zooms, or tilts, it is wrong — and it
is wrong *silently*, which is worse than useless in a Landmarks submission.

Three separate unknowns must be resolved:

| Unknown | Why it matters | How we resolve it |
|---|---|---|
| **Interior orientation** (focal length, principal point, lens distortion) | Straight facade lines bow; measurements near the frame edge skew | Device profile DB + optional user chessboard calibration; or absorb into the homography for a single plane |
| **Scale** (pixels → millimetres) | The entire point | Physical certified target or known-length reference **in the measured plane** |
| **Exterior orientation** (where the camera was, and how tilted) | Oblique shots compress one axis | 4-point planar homography, or vanishing-point rectification |

---

## 1. The five calibration tiers

The app implements a ladder. Each tier is strictly better than the one below, and the app **labels
every measurement with the tier that produced it**. This is the mechanism that makes crowd-sourced
content usable: a curator filters by tier instead of auditing every photo.

### Tier 0 — Uncalibrated (`CAL-0`)
Grid is drawn in screen space with **no metric claim**. Composition aid only.
Export watermark: *"NOT TO SCALE — composition grid only."*
This is the only mode allowed to run with no reference in frame, and its measurements are disabled,
not merely flagged.

### Tier 1 — Nominal / EXIF-derived (`CAL-1`) — indicative only, ±10–30 %
Uses the pinhole model with focal length from EXIF and a subject distance the user supplies (paced,
laser, or map-derived):

```
GSD (mm/px) = (sensor_width_mm × distance_mm) / (focal_length_mm × image_width_px)
```

Equivalently, from the 35 mm-equivalent focal length that phones reliably write to EXIF
(`FocalLengthIn35mmFilm`), avoiding the need to know the physical sensor size:

```
GSD (mm/px) = (36 mm × distance_mm) / (focal_35mm_equiv × image_width_px)
```

*(36 mm = full-frame width; use the width-based equivalence, not the diagonal-based one — see the
35 mm-equivalent focal length definitions collected in [research/r6_summary.md](../research/r6_summary.md).)*

**Limits, stated in the UI:** valid only for the fronto-parallel plane at that exact distance, ignores
lens distortion, and inherits 100 % of the error in the operator's distance estimate. Phones with
multi-camera systems and digital crop can also write misleading focal data. **Never accept `CAL-1` for
a Landmarks deliverable.**

### Tier 2 — Single known length in plane (`CAL-2`) — ±1–3 %
The ImageJ "Set Scale" model. Operator draws a line across an object of known length **lying in the
plane being measured** (a certified scale bar, a ranging rod, a survey tape held taut, or a
pre-measured feature such as a standard brick course).

```
scale (mm/px) = known_length_mm / measured_length_px
```

Valid only along that direction, at that depth, near the frame centre. Good for a quick brick-course
or joint-width check. Requires the image to be near fronto-parallel: the app **blocks** `CAL-2` if the
device pitch/roll HUD showed > 5° off-plumb at capture, or if the detected target is visibly
trapezoidal.

### Tier 3 — Planar homography from a known rectangle (`CAL-3`) — ±0.5–1.5 % ★ primary mode
**This is the workhorse.** Four (or more) points of known real-world planar coordinates are matched to
their image pixels, and a 3×3 homography `H` is solved by DLT:

For each correspondence `(x, y) ↔ (u, v)` where `(x, y)` are real-world millimetres on the plane:

```
[ -x  -y  -1   0   0   0   u·x   u·y   u ]        [h11 … h33]ᵀ = 0
[  0   0   0  -x  -y  -1   v·x   v·y   v ]
```

Stack ≥ 4 correspondences (8 rows), solve by SVD for the null vector, normalise `h33 = 1`. Then any
image point maps to real millimetres via `H⁻¹`, and **any** distance in that plane can be measured —
including diagonals, and including regions far from the target.

The three ways to get those four points, in descending order of preference:

1. **Coded fiducial target** (ArUco / AprilTag) printed at a certified size — detected automatically
   and sub-pixel refined. `js-aruco2` or `apriltag-js-standalone` do this fully client-side. Corner
   IDs remove all ambiguity about which corner is which.
2. **Printed calibration card** of known dimensions (e.g. a 297 × 210 mm A4 sheet, or a purpose-made
   600 mm two-target scale bar) — operator drags 4 markers onto the corners. This is exactly the
   interaction of the existing browser tool at <https://smallpond.ca/jim/scale/rectify.html>.
3. **Known building rectangle** — a window opening, a door, a panel, whose real dimensions were
   measured once with a tape or DISTO. Enables *retro-calibration of archival photographs*, which is a
   major feature for Landmarks work: old photos become measurable.

With > 4 points the system is over-determined; solve least-squares and **report the RMS reprojection
residual in millimetres**. That residual is the honest, self-computed quality signal.

### Tier 4 — Full intrinsic calibration + undistortion (`CAL-4`) — ±0.1–0.5 %
Adds a per-device lens model before the homography:

1. Operator shoots 10–20 views of a chessboard (or ChArUco) at varied angles.
2. `cv.calibrateCamera` (OpenCV.js/WASM) returns the camera matrix `K` and distortion coefficients
   `[k1 k2 p1 p2 k3]`.
3. Store the profile keyed by `make/model/lens/resolution/**zoom**` — the **calibDB** pattern
   (arXiv 1907.04100), which was specifically designed to serve calibrations to browser CV apps.
4. All subsequent images from that device/lens are undistorted before rectification — **in
   post-processing**, where there is time to do it properly.

Necessary for wide-angle/ultrawide phone lenses, where uncorrected radial distortion alone can exceed
1 % at the frame edge — i.e. larger than the entire error budget of tiers 3–4.

**The optics-lock precondition (Android).** A cached lens profile is only valid while the intrinsics
are actually constant. Autofocus changes the effective focal length between frames, and any digital
zoom changes it outright. Android Chrome exposes `focusMode`, `exposureMode`, `whiteBalanceMode` and
`zoom` as constrainable properties, so the client **locks the optics for the session** and records the
resulting capture profile:

```jsonc
"capture_profile": {
  "zoom": 1, "focus_mode": "manual", "exposure_mode": "manual",
  "optics_locked": true, "lens_profile_valid": true
}
```

The post-processing pipeline **refuses to apply a `CAL-4` profile when `lens_profile_valid` is false**.
This is the difference between a lens profile that is a genuine correction and one that is a
plausible-looking fabrication. iOS Safari exposes none of these controls, so iOS captures generally
cannot reach `CAL-4` — an Apple limitation, not a reason to withhold it from Android users.

### Tier 5 — Externally controlled (`CAL-5`) — LOA30 and better, project-dependent
Reference lengths and/or 3D control points come from an instrument: **Bluetooth laser distance meter
(Leica DISTO via Web Bluetooth on Android)**, total station, RTK GNSS, or an existing TLS/HAER control
network. This is the tier that reaches USIBD LOA30 (6 mm) and can be signed off by a licensed surveyor.

On Android the laser meter also makes the mandatory hold-out check (§3.1) a **single button** rather
than a manual tape measurement, which is the difference between a check that always happens and one
that gets skipped.

Close-range photogrammetry practice (CAST, Univ. of Arkansas) sets the minimum here: **two 3D control
points and one 1D scale control point** to scale, position and orient the model.

---

## 1b. Where calibration actually runs

Calibration is computed **twice**, for two different purposes:

| | In the field (browser) | In post-processing (server) |
|---|---|---|
| Purpose | **Capture assurance** — is this shot good enough to process? | **The number of record** |
| Detection | Fast, approximate | Sub-pixel, RANSAC, across all session images |
| Undistortion | Skipped | Applied, gated on `lens_profile_valid` |
| Solve | Single-image homography | Scale-bar-constrained bundle adjustment over the whole set |
| Uncertainty | Monte-Carlo, 300 trials | Monte-Carlo, full trials + redundancy from multiple images |
| Label | **PROVISIONAL** | Authoritative, C2PA-signed |

Because capture is not a real-time measurement requirement, the field solve can be cheap and the
server solve can be expensive. The field number exists so the operator knows on site whether to
re-shoot — which is the only decision that genuinely cannot wait.

---

## 2. Making the on-screen grid metrically true

Once `H` is known, the grid stops being a screen decoration and becomes a **projected real-world
grid**:

1. Generate world-space grid lines at a chosen real interval (e.g. 100 mm, 1 ft) on the plane `z = 0`.
2. Push every grid vertex through `H` into image space.
3. Draw them. On an oblique shot the grid correctly appears as a converging perspective mesh — and that
   visible convergence is itself the operator's cue that the shot is oblique.

Two rendering modes, both required:

- **Overlay mode** — perspective grid + ruler drawn over the original photo. Used for field verification
  and for the HABS-style "photograph with a scale."
- **Rectified mode** — the whole image warped by `H⁻¹` to a fronto-parallel orthophoto with a true
  square grid and a real scale bar. Used for elevation drawings and material take-offs.
  *(This is orthorectification only for the calibrated plane — see §4.)*

The on-screen **ruler** is drawn along the grid, ticked at real intervals, and always carries: the
interval value, the calibration tier badge, and the current RMS residual.

---

## 3. Verification — the part that makes it defensible

**A calibration that is not verified is a claim, not a measurement.** Every calibration session must
produce a verification record.

### 3.1 Check distances (hold-out validation)
Require at least **one independent check distance** — a known length in the plane that was *not* used
to fit `H`. The app measures it and reports:

```
error      = measured − known
error_pct  = 100 × error / known
```

If `|error_pct|` exceeds the tier's stated tolerance, the calibration is marked **FAILED** and
measurements are disabled until re-done. Two check distances, one horizontal and one vertical, catch
anisotropic errors that a single check misses.

### 3.2 Reported residual
RMS reprojection residual of the homography fit, in millimetres, shown live and written to the sidecar.

### 3.3 Uncertainty budget (written into every export)
Combined in quadrature:

| Component | Typical magnitude | Source |
|---|---|---|
| σ_target — certified length of the physical scale | ±0.1 mm | CHI scale bars are calibrated to 0.1 mm or better |
| σ_geom — target corner localisation, propagated through the homography | 0.5–1.0 px of detection noise, **amplified quadratically** with distance beyond the target | see below |
| σ_pick — operator's endpoint clicks | √2 × 1–3 px × GSD | reduced by zoom-to-pick + magnifier loupe |
| σ_plane — depth offset of the measured feature from the calibrated plane | **`Δdepth × (d_from_axis / distance)`** | the dominant term (see §4) |
| σ_lens — residual lens distortion | 0.1–1.0 % of distance from principal point | eliminated at `CAL-4` |

```
σ_total = √(σ_target² + σ_geom² + σ_pick² + σ_plane² + σ_lens²)
```

**On σ_geom — a finding from implementing this, not a textbook formula.** The obvious closed form,
`√2 · detect_px · GSD · (1 + r)` where `r` is how far outside the target you are measuring
(in target-radii), was implemented first and then tested by Monte Carlo against synthetic ground truth.
**It failed: only 89.1 % of trials fell inside the stated 95 % interval.** The error does not grow
linearly with extrapolation distance — it grows quadratically, because both the homography's rotational
and its projective terms degrade together.

Two corrections were made, and both are in [prototype/lib/geometry.js](../prototype/lib/geometry.js):

1. **Preferred path — Monte-Carlo propagation** (`propagateHomographyUncertainty`). Perturb the detected
   target corners by the detection noise, re-solve the homography a few hundred times, and take the
   standard deviation of the resulting measurement. Exact by construction, captures the amplification
   automatically, and costs single-digit milliseconds in a browser. **Coverage: ≥ 95 %, verified.**
2. **Fallback closed form** (`approximateGeometricSigma`), for when the target correspondences aren't
   available: `σ_geom = 2 · detect_px · GSD · (1 + r)²`. Deliberately a slight over-estimate; a unit
   test asserts it never under-predicts the Monte-Carlo value.

The general lesson holds beyond this codebase: **an uncertainty model is a claim, and it must be
validated against ground truth like any other output.** A model that under-reports uncertainty is more
dangerous than no model, because it launders a guess into a number with a ± on it.

Every measurement is exported as `value ± σ_total` with a **95 % confidence figure (≈2σ)**, plus the
tier badge. No bare numbers, ever.

### 3.4 Cross-observation agreement (the crowd-sourcing check)
For any feature measured by ≥ 2 independent contributors from different stations, compute the spread.
Agreement within the stated uncertainties promotes the feature to *corroborated*; disagreement flags it
for review. This is how a crowd corpus becomes trustworthy without a surveyor auditing every photo.

---

## 4. The off-plane problem — state it, don't hide it

A homography is exact **only for points on the calibrating plane**. A feature standing off that plane
by `Δdepth` and appearing at distance `r` from the image's principal point incurs approximately:

```
lateral error ≈ Δdepth × r / distance_to_plane
```

So a cornice projecting 600 mm from a facade photographed from 15 m, appearing 40 % of the way to the
frame edge, is displaced by roughly 24 mm — larger than the entire `CAL-3` error budget.

Mitigations, all implemented as product features:

1. **Declare the plane.** The operator names it ("north facade, brick face at ground floor"). It goes
   in the metadata.
2. **Measure the depth, don't estimate it (Android).** WebXR depth sensing over ARCore gives a real
   depth stream. Fitting a plane to captured AR points reports each point's off-plane deviation in
   millimetres, so `Δdepth` becomes an **observed quantity rather than an operator's guess** — and the
   same fit tells you whether the "flat" facade is actually flat. Implemented in
   [arxr.js](../prototype/lib/arxr.js) (`planeDeviationMm`). This is the single strongest argument for
   Android as the primary platform.
3. **Plane-depth annotation (fallback).** Where no depth data exists, the operator enters the offset
   and `σ_plane` is computed and added, rather than being ignored.
4. **Multi-plane sessions.** A single photograph can hold several calibrated planes (facade plane,
   reveal plane, cornice plane), each with its own `H`. Measurements are attributed to a plane.
5. **Shoot square.** The live level HUD nudges the operator toward fronto-parallel and perpendicular
   station points, which shrinks `r` and `Δdepth` effects together.
6. **Escalate to 3D.** Depth genuinely matters → the capture becomes an SfM set, processed server-side.
   The app's job is then to *collect a valid photo network*, not to measure.

---

## 5. Capture geometry rules the app enforces

Derived from the close-range photogrammetry and heritage guidance sources:

- **Fronto-parallel where possible**; the level HUD flags roll/pitch beyond a configurable threshold
  (default 3°).
- **Fill the frame with the subject plane**; keep the calibration target in the same plane and, ideally,
  near the centre of the region being measured.
- **Two targets, one at each end** of the measured span beats one target in the middle — it bounds
  scale error across the span instead of extrapolating.
- **Avoid frame edges** for critical measurements at tiers below `CAL-4`.
- **Lock zoom.** Any digital zoom invalidates the intrinsic profile; the app records the zoom factor and
  refuses `CAL-4` profiles when zoom ≠ 1.
- **For SfM sets:** ≥ 60–80 % overlap, convergent (not just parallel) stations, consistent exposure,
  and at least one certified scale bar visible in multiple images.
- **Duplicate captures**: with-scale and clean, per the SOI/HABS requirement — automated as a single
  operator action.

---

## 6. Metadata written for every calibration

```jsonc
{
  "calibration": {
    "tier": "CAL-3",
    "method": "homography-4pt-aruco",
    "plane_id": "north-facade-brick",
    "plane_description": "Brick face, ground floor, north elevation",
    "target": {
      "type": "aruco-4x4-50",
      "id": 17,
      "certified_size_mm": 200.0,
      "certificate_ref": "SB-2026-0031",
      "certified_tolerance_mm": 0.1
    },
    "homography": [[...], [...], [...]],
    "rms_residual_mm": 0.8,
    "gsd_mm_per_px": 2.31,
    "checks": [
      { "label": "window head width", "known_mm": 1220.0, "measured_mm": 1223.1, "error_pct": 0.25, "pass": true },
      { "label": "course height x10",  "known_mm": 2000.0, "measured_mm": 1996.4, "error_pct": -0.18, "pass": true }
    ],
    "uncertainty_mm_1sigma": 3.4,
    "status": "VERIFIED",
    "verified_at": "2026-08-16T12:41:07Z"
  }
}
```

---

## 7. The physical kit (what a contributor actually carries)

Calibration is a hardware-plus-software problem. The recommended kit, in order of cost:

| Item | Cost | Gets you |
|---|---|---|
| Printed ArUco/AprilTag sheet on rigid board, self-measured with a steel rule | ~$5 | `CAL-3`, ±1 % |
| Purpose-made two-target scale bar, certified to 0.1 mm (CHI-style) | ~$100–300 | `CAL-3`, ±0.3 % |
| Chessboard/ChArUco sheet for device calibration (one-time, per device) | ~$5 | unlocks `CAL-4` |
| Bluetooth laser distance meter (Leica DISTO class) | ~$150–400 | `CAL-5` on Android/desktop |
| Telescopic ranging rod / photo scale stick with contrasting decimetre bands | ~$50–150 | HABS-compliant "photograph with a scale" |
| RTK GNSS rover / total station / TLS | $$$$ | `CAL-5` at LOA30, surveyor sign-off |

**Print-at-home caution:** printers scale. Every printed target must be measured after printing with a
steel rule and the *measured* value entered — the app must never trust the nominal print size. The UI
enforces this by requiring the operator to type the measured dimension, defaulting to nothing.
