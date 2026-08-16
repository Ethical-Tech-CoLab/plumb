# 04 — Implementation Plan

## 0. Platform and architecture decisions

**Primary platform: Android Chrome.** The feature set is designed against Android's capabilities.
iOS Safari is supported as a reduced-capability secondary client and does not constrain the design.

**Capture is not a real-time metrology requirement.** The field client produces a
provenance-complete, metrologically sufficient bundle. All authoritative measurement happens in
server-side post-processing.

**C2PA is the provenance backbone.** Raw captures are signed at ingest; every derivative names its
parents as C2PA ingredients, giving a cryptographically verifiable lineage from any deliverable back
to the original exposures.

> **"Could we build this entirely in a browser?"** The *field client* is entirely a browser app. The
> server is a deliberate design component, not a workaround — and moving metrology off the device
> makes the results better, not worse.

| Layer | Where | Why |
|---|---|---|
| Full-resolution archival capture | **Android browser** — `ImageCapture.takePhoto()` | In-page, no native-camera round trip; iOS falls back to `<input capture>` |
| Optics lock (focus/zoom/exposure) | **Android browser** | Keeps intrinsics constant so a lens profile stays valid — a real accuracy lever |
| Live grid / ruler / level HUD | **Browser** | *Capture assurance*, not measurement |
| Marker-free AR measurement, measured off-plane depth | **Android browser** (WebXR + ARCore depth) | Not available on iOS; attacks the dominant error source |
| Laser distance meter (DISTO class) | **Android browser** (Web Bluetooth) | Not available on iOS |
| Provisional in-field measurement | **Browser** | Sanity check, labelled PROVISIONAL |
| Offline durable queue + resumable upload | **Browser** (OPFS + IndexedDB + Background Sync) | A day with no signal is normal |
| Sub-pixel detection, undistortion, bundle adjustment, SfM/MVS | **Server** | Better algorithms than a phone can run, using all images together |
| Trusted timestamp, identity, **C2PA signing** | **Server** | A browser cannot hold a private key the user can't extract |
| Corroboration, curation, archive, export packages | **Server** | |

A working proof of the browser-side claim is in [prototype/](../prototype): Android-first capture with
optics locking, toggleable metric grid and ruler, 4-point homography calibration, hold-out check
validation, measurement with a validated uncertainty budget, WebXR AR measurement and plane-deviation
scaffolding, and raw + overlay + sidecar export — with the geometry core covered by 26 unit tests.

---

## 1. Architecture

```
┌────────── ANDROID PWA (primary, offline-first) ──────────┐
│  CAPTURE                     ASSURANCE                    │
│  full-res ImageCapture       metric grid / ruler          │
│  optics lock                 level + plumb HUD            │
│  EXIF + GNSS + heading       target-in-frame check        │
│  WebXR depth + AR points     blur / tilt / zoom gate      │
│  SHA-256 at capture          shot-list progress           │
│  OPFS + IndexedDB queue · Background Sync · persist()     │
└───────────────────────┬───────────────────────────────────┘
                        │ resumable chunked upload (idempotent on capture UUID)
┌───────────────────────▼───────────────────────────────────┐
│  INGEST & TRUST                                            │
│  hash verify · trusted timestamp · identity/tier           │
│  WORM raw store · ► C2PA SIGN raw capture ◄                │
└───────────────────────┬───────────────────────────────────┘
                        │ job queue
┌───────────────────────▼───────────────────────────────────┐
│  POST-PROCESSING (async, versioned, re-runnable)           │
│  detect → undistort → bundle adjust → rectify → measure    │
│  → corroborate → SfM/MVS → export packages                 │
│  ► every output C2PA-signed, raw as INGREDIENT ◄           │
└───────────────────────┬───────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────┐
│  CORPUS & DELIVERY                                         │
│  subject registry · curator queue · IIIF · OpenSeadragon   │
│  Potree / SuperSplat · DOIs + licences · coverage map      │
└────────────────────────────────────────────────────────────┘
```

Full detail, including the C2PA manifest schema and the custom survey assertion namespace, is in
[05-server-and-provenance.md](05-server-and-provenance.md).

**The backend is built and running** — see [07-backend-and-twin-integration.md](07-backend-and-twin-integration.md)
and [server/](../server). One decision from that work changes the picture above: Plumb does **not**
become another digital twin. It publishes `photo-survey` documents conforming to the CoLab's existing
[`digital-3d-shared-contracts`](https://github.com/Ethical-Tech-CoLab/digital-3d-shared-contracts), so
`dumbo-district-3d` and the bridge twins consume Plumb captures directly and promote inferred facade
data (grade `C`) to observed evidence (grade `B`).

### Stack

| Concern | Choice | Rationale |
|---|---|---|
| Client shell | TypeScript + Vite, PWA (Workbox), Android-first | The prototype is deliberately dependency-free vanilla JS so the geometry core lifts anywhere |
| Client rendering | Canvas 2D overlays; WebGL/WebGPU for preview warping | Warping a 50 MP image on the CPU is too slow |
| Client CV | `js-aruco2` for assurance; OpenCV.js/WASM lazily for device calibration | Don't ship a multi-MB WASM blob for the common path |
| Client AR | WebXR `hit-test` + `depth-sensing` (ARCore) | Android-only, and worth it |
| Client storage | OPFS (blobs) + IndexedDB (records) | OPFS handles large binaries efficiently |
| Server API | Any mainstream stack; object storage + job queue | Deliberately boring |
| Server CV | OpenCV, COLMAP, OpenMVG+OpenMVS, WebODM | All open source, all proven |
| Provenance | `c2pa-rs` / c2patool server-side for signing; `c2pa-js` in-browser for verification | Keys in HSM/KMS |
| Viewer | OpenSeadragon (+scalebar/annotations), Potree, SuperSplat | |

### Data model (core entities)

```
Subject      — LPC/NRHP/HAER/BIN identifier, name, geometry, elevations, shot list
Session      — subject, operator, device, datetime, capture profile, targets used
Capture      — raw blob (WORM) + sha256, EXIF, GNSS, heading, orientation,
               capture profile (zoom/focus/optics-locked), pair link, C2PA manifest id
DepthFrame   — optional ARCore depth map linked to a Capture (Android)
Plane        — id, description, homography H, tier, residual, GSD, checks[], uncertainty
Measurement  — plane, geometry, value, sigma, tier, LOA, method, depth offset, provisional|authoritative
Overlay      — vector definition (grid spec, ruler, annotations), separate from the image
PipelineRun  — worker version, parameters, inputs, outputs, started/finished
Derivative   — output asset + C2PA manifest id + ingredient links
```

---

## 2. Roadmap

### Phase 0 — Metrology foundations (2–3 weeks) — **substantially done**
- Geometry core: normalised DLT homography, least-squares, residuals, Monte-Carlo uncertainty
  propagation. **26 unit tests passing**, including two explicit exit-criteria tests.
  *(See [geometry.js](../prototype/lib/geometry.js), [geometry.test.mjs](../prototype/test/geometry.test.mjs).)*
- Calibration tier definitions and machine-readable calibration record.
- **Finding already banked:** the naive analytic uncertainty model gave only 89 % coverage at 2σ;
  replaced with Monte-Carlo propagation plus a conservative quadratic closed form.
- Remaining: physical target design + printable sheets with mandatory post-print measurement.
- **Exit criteria:** `CAL-3` recovers known distances to < 0.5 % under 0.5 px corner noise; reported σ
  brackets true error in ≥ 95 % of trials. **Both met.**

### Phase 1 — Android capture client (4–6 weeks)
- Full-res `ImageCapture` capture path + optics lock + capture profile recording (A1, A2, A8).
- Raw-first rule, paired scale/clean capture, level HUD, GNSS/heading (A3–A6).
- Capture-quality gate including target-in-frame legibility (A7, B6).
- Overlay engine: composition grid, metric grid, ruler, tier badge (B1–B4) — *capture assurance*.
- Provisional in-field `CAL-2`/`CAL-3` measurement, labelled PROVISIONAL (C2, C4, C7, D2).
- Offline PWA: OPFS+IndexedDB queue, `persist()`, quota warnings, local export (H1, H2, H5, H7).
- iOS reduced-capability fallback path verified working.
- **Exit criteria:** a volunteer with an Android phone can complete a facade session fully offline; every
  capture in the queue has a complete sidecar and passes the assurance gate.

### Phase 2 — Server ingest, C2PA and post-processing (6–8 weeks)
- Resumable idempotent upload + ingest verification + WORM raw store (J1, J2).
- Trusted timestamp + identity + contributor tiers (E7, E8).
- **C2PA signing of raw captures; ingredient chain on derivatives; custom survey assertion namespace**
  (E1–E3). In-browser verification viewer (E4).
- Metrology worker: sub-pixel detection, undistortion gated on capture profile, homography/bundle
  adjust, rectified orthophoto, measurement + uncertainty (J3–J7).
- Device lens-profile service (C6, J11); certified-target registry (C14).
- Processing status surfaced in the client (H6, J12).
- **Exit criteria:** a capture uploaded from the field returns a signed, rectified orthophoto and a
  measurement set whose C2PA chain validates in a third-party tool.

### Phase 3 — Landmarks-grade deliverables (4–6 weeks)
- Multi-plane calibration; measured off-plane depth from ARCore ingested as a constraint (C8, D5).
- AR marker-free measurement in the field (D4).
- Laser distance meter over Web Bluetooth → one-button hold-out check (C10).
- Export packages: HABS-style photo sets, USIBD LOA statements, DXF/SVG linework, provenance PDFs
  (J10, D11, E13, I2).
- Subject registry keyed to LPC/NRHP/HAER/BIN (F1).
- **Exit criteria:** a complete DUMBO facade package accepted in review by a preservation architect
  against SOI documentation standards.

### Phase 4 — Crowd and corpus (8–10 weeks)
- Coverage map + gap gamification (F5); guided shot lists (A9); X-Ray re-shoot (A10).
- Curator queue with tier/level/corroboration filters (F6); corroboration engine (D8).
- Tiered evidence model (I1); contributor training and certification (I6); licence picker (E14).
- IIIF delivery + deep-zoom viewer with scale bar and C2PA panel (F2, F3); DOIs (F4).
- Privacy blurring recorded as a C2PA action (I4).
- **Exit criteria:** ≥ 100 contributors, ≥ 80 % of submissions auto-triaged without curator time, zero
  un-tiered measurements reaching the public corpus.

### Phase 5 — 3D, reprocessing and durability (8–10 weeks)
- SfM capture assistant (G1); server SfM/MVS with scale-bar-constrained bundle adjustment (G2, G3).
- ARCore depth maps contributed as reconstruction constraints (G5).
- Potree / SuperSplat viewers (G4, G6); registration to TLS/HAER control (G7).
- **Reprocessing service** — re-run archives on newer pipelines, results additive (J9).
- **Optional Base archival anchor** — daily Merkle root of manifest hashes published on-chain as an
  institution-independent existence proof (< $1/yr). See
  [06-trust-anchor-and-licensing.md](06-trust-anchor-and-licensing.md) §2.
- Change detection on re-shoot pairs (F7).
- **Exit criteria:** a crowd-sourced photo set produces a scaled 3D model within 1–2 % (the ODM
  benchmark for GSD < 1 cm), independently checked against surveyed distances; and a 2026 capture
  re-processed on a 2027 pipeline yields a measurably better result from identical raw bytes.

### Phase 6 (conditional) — Device-attested capture
Triggered only by a concrete requirement from a reviewer, insurer or counsel.
- Native/TWA capture companion owning the camera and **Android Keystore (StrongBox / Knox Vault)**.
- Key attestation chain + verified-boot state recorded into `capture_attestation`.
- Target **C2PA Assurance Level 2** — the level Pixel 10 Camera reached with the same Android APIs.
- **Exit criteria:** a capture from an S23+-class device carries a verifiable hardware attestation, and
  the shutter→ingest gap is closed end to end.

---

## 3. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Off-plane error silently corrupts measurements** | High | Declare the plane; multi-plane calibration; **ARCore depth measures the offset instead of estimating it** (D5); σ_plane in the budget; UI refuses claims outside the calibrated plane |
| R2 | **Bad capture cannot be rescued in post** | High | The client's core job is the assurance gate: target-in-frame legibility, blur, tilt, exposure, optics lock (A7, B6). A session that fails the gate is re-shot on site, not discovered weeks later |
| R3 | **Users trust the grid without calibration** | High | `CAL-0` measurements are *disabled*, not warned; exports watermarked NOT TO SCALE; tier badge always visible; in-field values labelled PROVISIONAL |
| R4 | **Autofocus invalidates cached lens profiles** | High | Optics lock (A2) + capture profile recorded + **pipeline refuses to apply a profile to floating optics** (J5) |
| R5 | **Printed targets are the wrong size** | Medium | Mandatory measured-value entry with no nominal default (C5); certified-target registry (C14); hold-out check catches the rest |
| R6 | **Browser storage eviction loses field data** | Medium | `storage.persist()`, quota monitoring, loud warnings, one-tap local export, resumable upload |
| R7 | **Async processing feels like data loss** | Medium | Explicit processing status view (H6); local copy retained until ingest is confirmed |
| R8 | **Signing key compromise** | High | HSM/KMS, rotation schedule, published trust list, ability to re-sign the archive from immutable raw |
| R9 | **Provenance over-claim** — C2PA read as proof of scene truth | Medium | Documented limit in-product (E12); combine with scale-in-frame, corroboration, sensor-coherence checks (E15) |
| R10 | **Accuracy over-claim** — measured read as represented | High | USIBD Measured/Represented split enforced in every export (I2) |
| R11 | **Shutter→ingest gap is unattested** | Medium | Accepted for v1 (PWA cannot reach Android Keystore). Client SHA-256 at capture narrows it; nullable `capture_attestation` block reserved; Phase 6 native companion closes it |
| R12 | **iOS users expect parity** | Low | Explicit, honest in-product platform banner; iOS gets a genuinely useful reduced client, and the limits are Apple's, not ours |
| R13 | **Crowd data quality** | Medium | Assurance gate at source; tiered evidence; corroboration; curator queue; training path |
| R14 | **Licence contamination** — CC BY-SA sources absorbed into a CC BY corpus | Medium | Decided CC BY; BY-SA material (Commons, Mapillary) kept in a separately-licensed, separately-tagged collection; compatibility check at export |
| R15 | **Pipeline non-reproducibility** | Medium | Versioned immutable workers; every result records worker version + parameters (J3) |
| R16 | **Long-horizon institutional risk** — CA, TSA or the project itself ceases to exist, breaking validation decades out | Medium | RFC 3161 timestamps survive signer expiry; immutable raw enables re-signing; optional Base Merkle anchor gives an institution-independent existence proof |
| R17 | Server cost of WORM raw storage at 50 MP scale | Medium | Tiered/cold storage for raw; derivatives regenerable and therefore disposable |
| R18 | Safety / trespass during capture | Medium | In-app guidance, permit reminders, no-go geofences near active work |

---

## 4. Governance decisions needed before Phase 2

Analysed in [06-trust-anchor-and-licensing.md](06-trust-anchor-and-licensing.md); decisions recorded
here.

1. **Contributor licence — DECIDED: CC BY 4.0** for photographs and derivatives, **CC0** for
   measurement data and metadata, **Apache-2.0** for code. Control is exercised through **contributor
   vetting + a click-through CLA + curator publication gating**, not through share-alike.
   *Consequence to plan for:* CC BY material cannot absorb CC BY-SA sources (Wikimedia Commons,
   Mapillary) — historic comparison imagery must live in a separately-licensed, separately-tagged
   collection.
2. **C2PA trust anchor — DECIDED: X.509 certificate from a C2PA Trust List CA** (~$289/yr) plus an
   **RFC 3161 TSA**. A blockchain key cannot sign a conformant C2PA claim (X.509 + EKU + trust list are
   mandatory; self-signed validates as untrusted). Remaining sub-decision: which listed CA.
3. **Archival anchoring — OPTIONAL, Phase 5:** publish a **daily Merkle root of manifest hashes to
   Base** as an institution-independent existence proof (< $1/yr). Additive and droppable; explicitly
   *not* the trust anchor.
4. **Device-attested capture — DEFERRED to Phase 4+:** hardware keystore signing (Knox Vault /
   StrongBox) is the only route to C2PA **Assurance Level 2**, but is unreachable from a PWA. Ship the
   PWA first; add a native capture companion for `trained`/`professional` tiers when a reviewer,
   insurer or counsel actually requires it. The sidecar schema carries a nullable
   `capture_attestation` block from v1 so nothing downstream changes later.
5. **Who is the archival authority** — LPC, a university, a nonprofit, or self-hosted with DOIs via
   DataCite (the Open Heritage 3D model). **Open.**
6. **Raw retention policy** — WORM retention period and cost model at 50 MP originals. **Open.**
7. **Professional sign-off pathway** — does a licensed surveyor countersign `CAL-5` submissions, and
   what is their liability? **Open.**
8. **Personal-data policy** — faces, plates, interiors visible through windows. **Open.**

---

## 5. Immediate next actions

1. Run the prototype on a real Android phone at a DUMBO facade with a printed target and a tape
   reference; record check-distance errors and confirm the optics lock reports `lens_profile_valid`.
2. Print and physically measure the target set; seed the certified-target registry with real numbers.
3. Stand up the ingest + C2PA signing service skeleton and prove a signed raw capture validates in
   `c2patool` and in the browser via `c2pa-js`.
4. Obtain **Historic England, *Photogrammetric Applications for Cultural Heritage*** (2017) and the
   **USIBD LOA v3.1** spec; map the tier ladder onto their tolerance language formally.
5. Pull the **HAER NY-18** Brooklyn Bridge photo set from the Library of Congress and pick 5 viewpoints
   for the X-Ray re-shoot reference set.
6. Decide the contributor licence and the C2PA trust anchor — both block Phase 2.
7. Recruit one preservation architect and one licensed surveyor as Phase 3 acceptance reviewers.
