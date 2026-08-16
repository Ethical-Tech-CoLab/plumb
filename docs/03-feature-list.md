# 03 — Feature List

Priority: **P0** = required for a credible v1 · **P1** = needed for Landmarks-grade submission ·
**P2** = scale / crowd · **P3** = future.

**Platform: Android Chrome is the primary delivery target.** The `Plat` column reads:
**A** = Android PWA (reference platform) · **A!** = Android-only capability that iOS cannot match ·
**iOS−** = degraded or unavailable on iOS Safari, by iOS's limitation, not our design ·
**S** = server / post-processing · **H** = physical hardware.

**Capture is not real-time metrology.** The field client produces a provenance-complete bundle; the
authoritative measurement happens in server post-processing. Live overlays exist for *capture
assurance*. See [05-server-and-provenance.md](05-server-and-provenance.md).

---

## A. Capture (Android PWA)

| # | Feature | Pri | Plat | Notes / evidence |
|---|---|---|---|---|
| A1 | **Full-resolution in-page capture** via `ImageCapture.takePhoto()` with `getPhotoCapabilities()` max dimensions | P0 | A / iOS− | Primary archival path on Android. iOS Safari has no `ImageCapture` in any stable version incl. Safari 26 → falls back to `<input capture>` native camera. |
| A2 | **Optics lock** — focus, zoom, exposure, white balance pinned for the session | P0 | **A!** | Metrology-critical: autofocus silently changes effective focal length, invalidating any cached lens profile. Locking is what makes CAL-4 profiles valid across a session. Implemented in [camera.js](../prototype/lib/camera.js). |
| A3 | **Raw-first artifact rule** — archival image stored byte-identical, never re-encoded, never overlaid | P0 | A | ProofMode's rule: "do not modify the original media files; all proof metadata stored alongside." Also keeps the raw photo usable for material survey. |
| A4 | **Paired capture** — one exposure with the physical scale in frame, one clean, linked as a pair | P0 | A | Satisfies SOI/HABS: Level I duplicate photos with scale; Level II/III at least one photo with a scale. |
| A5 | **Live level/plumb HUD** from `DeviceOrientationEvent` | P0 | A | Capture assurance — keeps shots fronto-parallel, the cheapest accuracy win available. |
| A6 | **Compass bearing + GNSS** with accuracy figures | P0 | A | Provenance only. **Never scale** — smartphone GNSS alone gives ~165 cm in SfM. |
| A7 | **Capture-quality gate** — blur (Laplacian variance), exposure, tilt, target-in-frame, zoom ≠ 1 | P0 | A | Post-processing cannot rescue a bad capture; this is the client's core responsibility. |
| A8 | **Torch and zoom control** | P1 | **A!** | `torch` / `zoom` constraints; zoom factor recorded because it invalidates lens profiles. |
| A9 | **Guided shot list per subject** — station diagram, required elevations, overlap prompts | P1 | A | Turns an untrained volunteer into a usable photographer. |
| A10 | **X-Ray re-shoot mode** — semi-transparent overlay of a prior capture on the live view | P1 | A | Copied from DroneDeploy Ground's X-Ray. Essential for re-shooting HAER NY-18 Brooklyn Bridge viewpoints and for change monitoring. |
| A11 | Bracketed / multi-exposure capture for high-dynamic-range facades | P2 | A | Android `ImageCapture` gives the control to do this properly. |

## B. On-screen grid, ruler and overlays (capture assurance)

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| B1 | **Toggleable overlay layer, rendered separately from the photo** — never composited into the archival file | P0 | A | The explicit "grid on/off so the raw photo is still useful" requirement. Overlay stored as vector JSON + optional rendered PNG. |
| B2 | **Composition grid** in screen space, hard-labelled *NOT TO SCALE* | P0 | A | `CAL-0`. |
| B3 | **Metric grid** — real-world grid projected through the homography, converging correctly on oblique shots | P0 | A | The visible convergence is itself the operator's obliquity cue. Working in [overlay.js](../prototype/lib/overlay.js). |
| B4 | **On-screen ruler** with real-unit ticks, unit switch, and a live tier badge + RMS residual readout | P0 | A | A ruler without a stated tier and residual is a lie. |
| B5 | **Scale bar burned into the *derivative* export** (never the raw) | P0 | A/S | Standard archival practice. |
| B6 | **Target-in-frame + legibility check** — is the physical scale present and big enough in pixels to process? | P0 | A | The single most important capture-assurance check, since post-processing depends on it. |
| B7 | **Rectified (orthophoto) view** | P0 | S (preview in A) | Authoritative version produced server-side; the client can show a fast preview. Precedent: smallpond.ca browser rectification tool. |
| B8 | **Magnifier loupe on point-pick** with sub-pixel snap | P1 | A | Reduces σ_pick for in-field provisional measurements. |
| B9 | Plumb/level reference lines and vanishing-point guides | P1 | A | |
| B10 | Overlay presets per job type (facade elevation, detail, condition survey) | P2 | A | |

## C. Calibration

| # | Feature | Pri | Plat | Notes — full detail in [02-calibration-methodology.md](02-calibration-methodology.md) |
|---|---|---|---|---|
| C1 | **Five-tier calibration ladder `CAL-0` … `CAL-5`**, stamped on every measurement and export | P0 | A/S | The mechanism that makes crowd data filterable. |
| C2 | **`CAL-3` 4-point homography from a known rectangle** (DLT + SVD, least-squares for >4 points) | P0 | A/S | Working and unit-tested in [geometry.js](../prototype/lib/geometry.js). Also enables **retro-calibration of archival photographs**. |
| C3 | **Automatic fiducial detection** (ArUco / AprilTag) with sub-pixel refinement | P0 | A/S | `js-aruco2` (pure JS) and `apriltag-js-standalone` (WASM) client-side for assurance; authoritative sub-pixel detection server-side. |
| C4 | **`CAL-2` known-length scale** (draw a line, type the real length) | P0 | A | The ImageJ "Set Scale" interaction users already know. |
| C5 | **Measured-not-nominal target entry** — operator must type the steel-rule-measured size | P0 | A | Home printers scale. Field defaults to empty; no nominal fallback. |
| C6 | **`CAL-4` device lens profiles** — chessboard/ChArUco calibration, cached per make/model/lens/resolution/**zoom** | P1 | A + S | OpenCV.js `calibrateCamera`; served by a profile DB (the calibDB pattern, arXiv 1907.04100). **Applied in post-processing only when the capture profile shows locked optics and zoom = 1.** |
| C7 | **Mandatory hold-out check distance(s)** — calibration is `FAILED` and measurement disabled until a check passes | P0 | A/S | Prefer two checks, one horizontal one vertical, to catch anisotropic error. |
| C8 | **Multi-plane calibration in one photo** with per-plane `H` | P1 | S | The honest answer to the off-plane problem. |
| C9 | **Uncertainty budget** per measurement (`value ± 2σ`, 95 %) via Monte-Carlo propagation | P0 | A/S | Implemented and validated; the naive closed form under-reported at 89 % coverage. |
| C10 | **`CAL-5` laser distance meter ingest** (Leica DISTO class) over Web Bluetooth | P1 | **A!** | Chrome/Edge/Samsung Internet. **Not available on iOS** → manual entry there. Makes the hold-out check one button. |
| C11 | **`CAL-5` external survey control** — RTK GNSS / total station import, WebUSB where possible | P2 | A! / S | Reaches USIBD LOA30 with surveyor sign-off. |
| C12 | **Scale-bar-constrained bundle adjustment** across all images of a subject | P1 | S | Post-processing only; mirrors Agisoft's coded-target + scale-bar workflow. |
| C13 | Vanishing-point / auto-rectification fallback when no target is present | P2 | S | Single-view metrology (Criminisi); lower tier, always labelled. |
| C14 | Certified-target registry — serial → certificate → tolerance | P1 | S | CHI-style scale bars certified to 0.1 mm; provenance of the *ruler itself*, referenced by serial in the C2PA manifest. |

## D. Measurement

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| D1 | **Authoritative measurement in post-processing**, with uncertainty, tier and LOA band | P0 | S | The number of record. |
| D2 | **Provisional in-field measurement**, clearly labelled PROVISIONAL | P0 | A | Sanity check while on site; never the deliverable value. |
| D3 | **Point-to-point, polyline, area, angle** | P0 | A/S | Areas labelled as planar projections. |
| D4 | **AR marker-free measurement** via WebXR hit-test | P1 | **A!** | No printed target needed — for bridge soffits, cornices at height, live roadways. Implemented in [arxr.js](../prototype/lib/arxr.js). |
| D5 | **Measured off-plane depth** via ARCore depth sensing, instead of operator estimate | P1 | **A!** | Converts the dominant silent error source into an observed quantity. Plane-fit deviation reported in mm. |
| D6 | **Repeat/aggregate measures** (e.g. 10 brick courses ÷ 10) | P1 | A/S | Big accuracy win for free. |
| D7 | **Measurement register** per photo/subject — named, typed, exportable | P0 | A/S | ImageMeter precedent: annotate photo, export PDF/spreadsheet. |
| D8 | **Cross-observation corroboration** across contributors, stations and dates | P1 | S | The crowd-sourcing trust mechanism. |
| D9 | Material/condition tagging on measured regions | P1 | A/S | Feeds the "external materials details" goal. |
| D10 | Crack-width measurement with a calibrated comparator overlay | P2 | A/S | Condition-survey value-add. |
| D11 | Export measurements as DXF / SVG / GeoJSON elevation linework | P1 | S | The bridge into CAD/BIM, carrying the accuracy statement with it. |

## E. Provenance and verifiable lineage (C2PA-backed)

Full design in [05-server-and-provenance.md](05-server-and-provenance.md) §4.

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| E1 | **C2PA signing of the raw capture at ingest** — the root of trust | P0 | S | Private key in HSM/KMS. A browser cannot hold a key the user can't extract, so signing is server-side by necessity. |
| E2 | **C2PA ingredient chain on every derivative** — undistorted → rectified → measured → DXF, each naming its parents | P0 | S | Produces a verifiable DAG from any deliverable back to the original exposures. |
| E3 | **Custom survey assertion namespace** (`org.plumb.survey.v1`) carrying calibration record, pipeline version, measurements, uncertainty, LOA band | P0 | S | Standard C2PA has no metrology vocabulary; this is where the engineering content lives. |
| E4 | **In-browser C2PA verification** with an ingredient-tree viewer | P1 | A | `c2pa-js` (WASM) validates client-side, no server round-trip. |
| E5 | **Client-side SHA-256 at capture**, carried through ingest | P0 | A | `crypto.subtle.digest`. Proves the bytes did not change in transit. |
| E6 | **Provenance sidecar** for offline/interim use, never modifying the original | P0 | A | ProofMode model. Working in [manifest.js](../prototype/lib/manifest.js). |
| E7 | **Who**: contributor identity, credential level, organisation | P0 | S | Identity assurance requires a server. |
| E8 | **When**: device clock **plus an independent trusted timestamp** at ingest | P0 | S | Device clocks are trivially spoofable; the server timestamp is the defensible one. |
| E9 | **Where**: GNSS + heading with accuracy figures, plus **operator-confirmed subject identifier** (LPC / NRHP / HAER / BIN-BBL) | P0 | A | Human confirmation beats a 10 m GPS fix for identifying *which* building. |
| E10 | **What**: device, lens, **capture profile** (zoom, focus mode, optics-locked, lens-profile validity), exposure, app version | P0 | A | Recorded because it governs whether a lens profile may be applied downstream. |
| E11 | **Full chain-of-custody log** — every transform appended as an event; original always recoverable | P0 | S | Digital-evidence practice (ISO/IEC 27037 class). |
| E12 | **Documented C2PA limits, in-product** — proves pipeline integrity, not scene authenticity | P0 | A/S | A signed photo of a printed photo still validates. Countered by scale-in-frame, corroboration, sensor-coherence checks and contributor tiering. |
| E13 | **Human-readable provenance sheet** (PDF) per capture for submission packages | P1 | S | What actually gets stapled to an LPC/HABS submission. |
| E14 | Licence declaration per contribution with an explicit rights picker | P0 | A/S | Mapillary is CC BY-SA 4.0 — share-alike can contaminate downstream commercial deliverables. |
| E15 | Sensor-coherence checks (sun angle vs shadow vs claimed date/time/heading) | P2 | S | Detects staged or misattributed captures that C2PA alone cannot. |
| E16 | Hardware attestation / Play Integrity for high-assurance submissions | P3 | A! / S | Android offers a real attestation path; only if a legal use case demands it. |

## J. Server post-processing pipeline

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| J1 | **Resumable chunked upload**, idempotent on capture UUID | P0 | S | A day offline is normal; retries must never fork the provenance graph. |
| J2 | **Ingest verification** — hash check, EXIF normalise, format scan, WORM raw storage | P0 | S | |
| J3 | **Versioned, deterministic pipeline** — every result records the exact worker version and parameters | P0 | S | A result without a pipeline version is not reproducible. |
| J4 | **Sub-pixel fiducial detection + RANSAC** across all images in a session | P0 | S | Better than anything achievable live on a phone. |
| J5 | **Lens undistortion gated on capture profile** — refuses to apply a profile to floating optics | P0 | S | Directly consumes A2. |
| J6 | **Scale-bar-constrained bundle adjustment** | P1 | S | |
| J7 | **Rectified orthophoto generation** at a stated GSD | P0 | S | |
| J8 | **SfM/MVS reconstruction** on request | P1 | S | COLMAP / OpenMVG+OpenMVS / Meshroom / WebODM — all open source, GPU pool. |
| J9 | **Reprocessing** — re-run any capture on a newer pipeline, results additive not destructive | P1 | S | Today's photo yields a better number in five years. Both results stay signed and comparable. |
| J10 | **Export packaging** — HABS photo sets, USIBD LOA statements, DXF/SVG, provenance PDFs | P1 | S | Compliance as a button. |
| J11 | **Device lens-profile service** keyed by make/model/lens/resolution/zoom | P1 | S | The calibDB pattern. |
| J12 | Job status surfaced back into the field app session view | P1 | A/S | Results arrive later; the operator sees them on return. |

## F. Corpus, archive and reuse

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| F1 | **Subject registry** keyed to authoritative identifiers (LPC designation, NRHP, HAER/HABS number, BIN/BBL) | P0 | S | Brooklyn Bridge = HAER NY-18; DUMBO Historic District = LPC-designated 2007, ~95 contributing buildings. Register against what exists; don't start a parallel universe. |
| F2 | **Deep-zoom review viewer** with scale bar, annotations, measurement replay and a **C2PA ingredient-tree panel** | P1 | A | OpenSeadragon + `OpenSeadragonScalebar` + annotation plugins + `c2pa-js`. |
| F3 | **IIIF-compliant delivery** of imagery and annotations | P1 | S | Interoperates with museum/library/archive infrastructure. |
| F4 | **Persistent identifiers + explicit per-dataset licence** | P1 | S | Open Heritage 3D / CyArk model: DOI + licence + metadata per dataset. |
| F5 | **Coverage map and gap gamification** — which elevations of which listed buildings are still unshot | P2 | S | Wiki Loves Monuments' list-driven model is what gets volunteers to shoot boring buildings. |
| F6 | **Curator queue** — filter by calibration tier, contributor level, corroboration state; bulk accept/reject | P1 | S | Answers the documented "integration gap": crowd material rarely reaches the authoritative collection. |
| F7 | **Change detection** — re-shoot pairs aligned by homography, differenced, for condition monitoring | P2 | S | DUMBO's Belgian block restoration is a live, funded example. |

## G. 3D and reconstruction (the escalation path)

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| G1 | **SfM photo-network capture assistant** — overlap tracking, convergent-station prompts, scale-bar visibility check | P1 | A | The client's job is to *collect a valid network*, not to solve it. |
| G2 | **Server-side SfM/MVS** pipeline | P1 | S | COLMAP / OpenMVG+OpenMVS / Meshroom(AliceVision) / WebODM — all open source. No production WASM SfM exists, and with post-processing accepted there is no reason to want one. |
| G3 | **Scale-bar-constrained bundle adjustment** using certified targets | P1 | S | Agisoft's coded-target + scale-bar workflow is the reference to mirror. |
| G4 | **Point-cloud / mesh web viewer with measurement** | P1 | A | Potree (TU Wien) or three.js; MassDOT extended Potree's measurement tools with GeoJSON features. |
| G5 | **ARCore depth capture contributed to reconstruction** — depth maps uploaded alongside images as extra constraints | P2 | **A!** | Android-only input that improves the solve; iOS simply contributes fewer channels. |
| G6 | Gaussian-splat viewer for visual recreation deliverables | P2 | A | SuperSplat (PlayCanvas, MIT). |
| G7 | Registration to existing TLS/HAER control networks | P2 | S | How this becomes surveyor-grade. |

## H. Field operations

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| H1 | **Offline-first PWA** — service worker; full capture with no network | P0 | A | Bridges and waterfronts have bad signal. A day offline is a normal case, not an error. |
| H2 | **Local durable queue** (OPFS blobs + IndexedDB records), `storage.persist()`, loud quota warnings, one-tap local export | P0 | A | Browser storage is evictable; Chrome quota ≈60 % of free disk. |
| H3 | **Background sync on reconnect**, resumable chunked upload keyed by capture UUID | P0 | A/S | |
| H3a | **Wi-Fi-only upload by default** — policy options: Wi-Fi only · Wi-Fi preferred (fast cellular OK) · any network · manual. Data Saver and offline always hold; one-shot "upload now" override | P0 | A | Full-resolution captures run to hundreds of MB per session; sending that over a volunteer's cellular plan is a real cost. Because processing is async, holding an upload costs nothing. Uses `navigator.connection` (`type` is authoritative on Android Chrome). Implemented in [upload.js](../prototype/lib/upload.js) |
| H3b | **Queue never blocks capture** — captures wait in the durable local queue until policy is satisfied, and drain automatically when Wi-Fi appears | P0 | A | The user must never feel that waiting = losing data |
| H3c | **Unknown-network handling** — desktop and iOS Safari often don't report connection type; default is to hold, with an explicit "treat unknown as unmetered" opt-in | P1 | A | Wi-Fi-only should mean Wi-Fi only unless the user says otherwise. Roaming is undetectable on the web — documented, not solved |
| H4 | **Session/job model** — subject, plane definitions, shot list, targets used, operator notes, audio notes | P1 | A | ImageMeter ships audio notes; field users love them. |
| H5 | **Install-free operation** + "Add to Home Screen" | P0 | A | Zero install is what makes crowd-sourcing viable at all. Android PWA install is a first-class experience. |
| H6 | **Processing status view** — queued / uploaded / processing / results ready | P0 | A/S | The user-visible consequence of async processing; must never feel like data vanished. |
| H7 | Printable target/scale-bar sheets generated by the app, with a mandatory post-print measurement step | P0 | A | |
| H8 | Team/multi-device sessions with role separation (shooter / measurer / verifier) | P2 | A/S | |

## I. Trust, safety, governance

| # | Feature | Pri | Plat | Notes |
|---|---|---|---|---|
| I1 | **Tiered evidence model** — every artifact carries calibration tier + contributor level + corroboration state | P0 | S | |
| I2 | **Accuracy statement generator** mapping results to **USIBD LOA** (LOA10 5 cm … LOA50 1 mm) and **ASPRS** reporting language | P1 | S | USIBD's *Measured vs Represented* split must be preserved — a 15 mm measurement must not become an implied 15 mm CAD line. |
| I3 | **Anti-pattern guards** — refuse measurement claims when the target is out of plane, off-frame, too small in pixels, or the check distance failed | P0 | A/S | |
| I4 | Privacy: face/plate blurring on public derivatives, recorded as a C2PA action so the redaction is provable | P1 | S | |
| I5 | Safety guidance: no trespass, no roadway obstruction, permit reminders for LPC-regulated work | P1 | A | |
| I6 | Contributor training path and certification badge | P2 | S | HeritageTogether's lesson: community training matters more than software. |

---

## Deliberate non-goals for v1

- Replacing a total station, TLS, or a licensed survey. The docs say so explicitly and the export
  language says so too.
- **Real-time on-device metrology as the number of record.** In-field measurement is a provisional
  sanity check; the authoritative value comes from the server pipeline.
- In-browser dense 3D reconstruction. Escalate to the server; there is no reason to want a WASM SfM.
- Trusting GNSS as scale, or a device clock as a legal timestamp.
- Burning overlays into archival images, ever.
- **Reducing the Android feature set to what iOS Safari can support.** iOS gets a working
  reduced-capability client; it does not get a veto over the product.
