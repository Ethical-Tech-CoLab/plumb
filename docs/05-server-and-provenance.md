# 05 — Server Architecture, Post-Processing and C2PA Provenance

Three decisions shape this document:

1. **Android Chrome is the primary delivery platform.** iOS Safari is a reduced-capability client.
2. **Capture is not a real-time measurement requirement.** The field client's job is to produce a
   *provenance-complete, metrologically sufficient* bundle. All authoritative metrology happens in
   post-processing.
3. **C2PA is the provenance backbone.** Every artifact — raw capture, rectified orthophoto,
   measurement report, 3D model — is a signed C2PA asset whose lineage is cryptographically traceable
   back to the original capture.

---

## 1. Why post-processing is an upgrade, not a compromise

Dropping the real-time constraint is the single most valuable architectural decision available, and
it improves accuracy rather than trading it away:

| Live on-device | Post-processed on server |
|---|---|
| One image at a time | **All images of a subject solved together** — shared lens model, cross-image constraints, redundancy |
| Approximate corner detection under time pressure | **Sub-pixel refinement**, RANSAC outlier rejection, iterative re-weighting |
| Homography only | **Full bundle adjustment** with scale-bar constraints and control points |
| No dense reconstruction | **SfM/MVS** (COLMAP / OpenMVG+OpenMVS / Meshroom / WebODM) |
| Algorithms frozen at capture time | **Re-runnable forever** — improve the pipeline, re-process the 2019 archive, get better numbers from the same photographs |
| Phone thermal/battery limits | No limits |

The last row is the important one for Landmarks work. Because raw captures are immutable and signed,
**they remain valid inputs indefinitely.** A capture made today can be re-solved in five years with a
better algorithm and produce a *better* measurement from the same evidence — and the C2PA chain will
show exactly which pipeline version produced which number.

### What the field client is still responsible for

Post-processing cannot rescue a bad capture. The client must guarantee, at capture time:

- The **physical scale / calibration target is in frame** and legible (this is also the SOI/HABS
  requirement — see [01-research-findings.md](01-research-findings.md) §1).
- The shot is **acceptably square** and in focus (level HUD + blur gate).
- **Optics are locked** for the session, so one lens profile covers every frame.
- The **provenance sidecar is complete** — device, sensors, operator, subject, timing, hashes.
- Enough **coverage and overlap** if the subject is destined for 3D.

The live grid and ruler therefore serve **capture assurance**, not measurement: they tell the operator
"your target is in frame, you are square, your scale is legible, this shot will process." In-field
measurement remains available as a sanity check, clearly labelled as provisional.

---

## 2. System architecture

```
┌──────────── ANDROID PWA (offline-first, primary platform) ────────────┐
│                                                                        │
│  CAPTURE (fast, dumb, complete)          ASSURANCE (live overlay)      │
│  ─────────────────────────────           ────────────────────────      │
│  ImageCapture.takePhoto() full-res       metric grid / ruler           │
│  optics lock (focus/zoom/exposure)       level + plumb HUD             │
│  EXIF + sensors + GNSS + heading         target-in-frame check         │
│  WebXR depth + AR points (optional)      blur / exposure / tilt gate   │
│  SHA-256 at capture                      shot-list progress            │
│                                                                        │
│  Provisional in-field measurement (optional, labelled PROVISIONAL)     │
│  Durable queue: OPFS blobs + IndexedDB records + persist()             │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ resumable chunked upload (background sync)
┌───────────────────────────────▼────────────────────────────────────────┐
│                          INGEST & TRUST                                 │
│  hash verify · trusted timestamp · identity/contributor tier            │
│  virus/format scan · EXIF normalise · immutable raw object store (WORM) │
│  ► C2PA SIGN the raw capture  ◄  (first link in the chain)              │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ job queue
┌───────────────────────────────▼────────────────────────────────────────┐
│                     POST-PROCESSING PIPELINE (async)                    │
│  1 fiducial detect (sub-pixel)      5 measurement solve + uncertainty   │
│  2 lens undistort (device profile)  6 cross-observation corroboration   │
│  3 homography / bundle adjust       7 SfM / MVS (when 3D requested)     │
│  4 rectified orthophoto             8 export packages (HABS/LOA/DXF)    │
│  ► every output C2PA-SIGNED with the raw capture as an INGREDIENT ◄     │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                    CORPUS, CURATION & DELIVERY                          │
│  subject registry (LPC/NRHP/HAER/BIN) · curator queue · tiered evidence │
│  IIIF image service · OpenSeadragon viewer · Potree / SuperSplat        │
│  DOIs + per-dataset licences · coverage map · change detection          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Service inventory

| Service | Responsibility | Notes |
|---|---|---|
| **ingest-api** | Resumable chunked upload, hash verification, quota, idempotency | Client may retry for days; must be idempotent on capture UUID |
| **trust-service** | Trusted timestamp (RFC 3161 or equivalent), identity, contributor tiering | The *only* defensible clock |
| **c2pa-signer** | Signs raw captures and every derivative; holds the private key in an HSM/KMS | Never in the browser |
| **profile-service** | Per-device lens calibration profiles keyed by make/model/lens/resolution/zoom | The calibDB pattern (arXiv 1907.04100) |
| **metrology-worker** | Fiducial detection, undistortion, homography/bundle adjust, measurement, uncertainty | Deterministic and versioned |
| **recon-worker** | SfM/MVS via COLMAP / OpenMVG+OpenMVS / WebODM; scale-bar-constrained | GPU pool, long-running |
| **corroboration-service** | Cross-observation agreement across contributors and dates | Promotes to *corroborated* or flags |
| **registry-service** | Subjects keyed to LPC / NRHP / HAER / BIN-BBL; elevations; shot lists | Register against existing authorities |
| **curation-api** | Curator queue, tier/level filters, bulk accept/reject, moderation | Answers the documented "integration gap" |
| **export-service** | HABS photo sets, USIBD LOA statements, DXF/SVG linework, provenance PDFs | Compliance as a button |
| **object-store** | WORM raw bucket + derivative bucket | Raw is immutable; derivatives are regenerable |

---

## 3. Post-processing pipeline in detail

Every stage is **versioned, deterministic and recorded**. A result is meaningless unless you know
which pipeline version produced it.

### Stage 1 — Fiducial and target detection
Sub-pixel ArUco/AprilTag/ChArUco corner detection, RANSAC outlier rejection across all images of the
session. Certified target dimensions pulled from the target registry by serial number, so scale
provenance is traceable to a calibration certificate rather than to a typed number.

### Stage 2 — Lens undistortion
Apply the device lens profile (`CAL-4`). **Only applied if the capture profile shows locked optics and
zoom = 1** — the client records this, and the pipeline refuses to apply a profile to a frame whose
optics were floating. This check is why the Android optics lock is a metrology feature.

### Stage 3 — Orientation solve
Planar homography for single-plane subjects; scale-bar-constrained bundle adjustment when multiple
images and/or control points exist. Redundant observations become least-squares residuals rather than
being discarded.

### Stage 4 — Rectified orthophoto
Fronto-parallel warp per calibrated plane, with a true square grid and scale bar, at a stated GSD.

### Stage 5 — Measurement and uncertainty
Measurements re-solved against the refined orientation. Uncertainty via Monte-Carlo propagation (see
[02-calibration-methodology.md](02-calibration-methodology.md) §3.3), reported as `value ± 2σ` with the
USIBD LOA band and the calibration tier.

### Stage 6 — Corroboration
Same feature, different contributors/stations/dates → spread computed against stated uncertainties.
Agreement promotes to *corroborated*; disagreement flags for curator review.

### Stage 7 — Reconstruction (on request)
SfM/MVS with certified scale bars as constraints. Outputs point cloud, mesh, optional Gaussian splat.

### Stage 8 — Packaging
HABS-style photo sets with indices, Historic England-style survey reports, USIBD LOA accuracy
statements, DXF/SVG elevation linework, provenance PDFs.

### Reprocessing policy
Any capture can be re-run against a newer pipeline version. Results are **additive, never
destructive**: a new signed result is added alongside the old one, both referencing the same raw
ingredient, so the historical record of what was believed and when is preserved.

---

## 4. C2PA provenance chain

C2PA is what turns "we have metadata" into "we have verifiable lineage." Each artifact carries a
signed manifest; each derivative names its parents as **ingredients**, producing a directed acyclic
graph from any deliverable back to the original exposures.

```
  raw capture (signed at ingest)
        │  ingredient
        ├──► undistorted image (signed)
        │         │  ingredient
        │         ├──► rectified orthophoto (signed)
        │         │         │  ingredient
        │         │         └──► measurement report / DXF (signed)
        │         └──► SfM point cloud (signed, many raw ingredients)
        └──► annotated derivative with grid + ruler (signed)
```

### What goes in each manifest

**Raw capture manifest (signed at ingest — the root of trust):**
- `c2pa.actions`: `c2pa.created` with the capture digital-source-type
- Capture assertions: device make/model, **capture profile** (zoom, focus mode, optics-locked flag,
  lens-profile validity), exposure, EXIF digest
- Sensor assertions: GNSS with accuracy radius, compass heading with accuracy, device orientation
- **Trusted timestamp** from the trust-service, alongside the self-reported device clock
- Operator identity and contributor tier as asserted by the trust-service
- Subject identifier (LPC / NRHP / HAER / BIN) as confirmed by the operator
- `c2pa.hash.data` binding to the immutable bytes

**Derivative manifest (signed per pipeline output):**
- `c2pa.ingredients`: parent asset(s) with their manifest IDs and hashes
- `c2pa.actions`: the exact transforms applied (`c2pa.color_adjustments`, `c2pa.transcoded`,
  plus custom actions for `undistort`, `rectify`, `measure`)
- **Pipeline version, algorithm parameters, and calibration record** as a custom assertion
- Measurement results with uncertainty, tier, and USIBD LOA band
- Accuracy statement preserving the USIBD **Measured vs Represented** distinction

### Custom assertion namespace

Standard C2PA assertions do not describe metrology, so the survey-specific data lives in a custom
namespace, for example `org.plumb.survey.v1`:

```jsonc
{
  "org.plumb.survey.v1": {
    "calibration": {
      "tier": "CAL-4",
      "method": "bundle-adjust-scalebar",
      "lens_profile_id": "pixel8pro/main/4080x3072/zoom1.0/v3",
      "optics_locked": true,
      "target_serial": "SB-2026-0031",
      "target_certified_mm": 600.02,
      "target_certificate_tolerance_mm": 0.1,
      "rms_residual_mm": 0.42,
      "checks": [
        { "label": "window head", "known_mm": 1220.0, "measured_mm": 1220.3, "error_pct": 0.02, "pass": true }
      ],
      "status": "VERIFIED"
    },
    "pipeline": {
      "version": "metrology-worker@2.4.1",
      "stages": ["detect", "undistort", "bundle-adjust", "rectify", "measure"],
      "processed_at": "2026-08-20T09:14:03Z",
      "reprocessing_of": null
    },
    "measurements": [
      {
        "label": "window head width",
        "value_mm": 1219.8,
        "expanded_mm_95pct": 4.1,
        "usibd_measured_accuracy": "LOA30",
        "plane_id": "north-facade-brick",
        "depth_offset_mm": 0,
        "corroborated_by": 2
      }
    ],
    "accuracy_statement": "Measured accuracy only, per USIBD LOA v3.1. Represented accuracy of derived drawings is not implied."
  }
}
```

### Verification story

- **In the browser**, `c2pa-js` (WASM) validates manifests client-side — the review viewer shows a
  Content Credentials panel with the full ingredient tree, no server round-trip needed.
- **Third parties** can validate with any C2PA-conformant tool, because we use the open standard
  rather than a proprietary scheme.
- **The archive** keeps the raw bytes, so any signature can be re-verified independently forever.

### Signing credentials — what the standard actually requires

Decided in [06-trust-anchor-and-licensing.md](06-trust-anchor-and-licensing.md); summarised here
because it constrains the implementation:

- Claim-signing certificates must be **X.509** with the **`id-kp-emailProtection`** or
  **`id-kp-documentSigning`** EKU, valid for exactly one C2PA purpose, chaining to a CA on the
  **C2PA Trust List** (~$289/yr). Self-signed certs validate cryptographically but are **reported as
  untrusted**, which is unusable in a Landmarks or legal context.
- **A blockchain key cannot sign a conformant C2PA claim.** No X.509 identity, no EKU, no trust-list
  path. See §4b for where a chain anchor *is* useful.
- **RFC 3161 timestamps** are the spec-native answer to certificate expiry: a timestamp remains valid
  after the signer's credential expires, provided the attested time falls inside the TSA certificate's
  validity window.
- C2PA supports **offline signing** with pre-provisioned certificates renewed on reconnect — which
  fits the offline-first field model unchanged.

### 4b. Optional archival anchor (Phase 5, not the trust anchor)

C2PA's long-term validity ultimately depends on institutions surviving: CAs close, trust lists change,
TSA certificates expire. For a heritage archive with a 50–100 year horizon that is a real structural
risk — the same one PAdES B-LTA addresses with periodic re-timestamping.

An optional supplement: publish a **daily Merkle root over every manifest hash ingested that day** to a
public ledger (Base L2; the OpenTimestamps pattern). One transaction covers unlimited captures at
roughly **$0.001–0.002**, i.e. **under $1/year**, and yields an existence proof anyone can verify
without our servers, our CA, or our organisation continuing to exist.

Explicit limits: blockchain notarisation "lacks universal legal recognition; courts often require
additional evidence for admissibility," so it **supplements RFC 3161 rather than replacing it**, and it
proves existence-at-a-time only — nothing about content validity or identity. It is additive: drop it
and every C2PA manifest remains fully valid.

### 4c. Device-attested capture (Phase 6, conditional)

Today the chain of trust begins at **ingest**, leaving the shutter→upload interval unattested. Closing
it requires hardware-backed signing at capture:

- Google's **Pixel 10 Camera reached C2PA Assurance Level 2 — the highest currently defined** — using
  Android Key Attestation and StrongBox-class hardware, and Google explicitly notes that "Android
  developers can leverage these same tools." A Samsung S23+ has the equivalent hardware in Knox Vault.
- **A PWA cannot do this.** Web Crypto keys are software-backed and origin-bound; there is no web API
  exposing Android Keystore for general-purpose signing. It requires a native or TWA capture companion.
- Therefore: ship the PWA (Assurance Level 1, ingest-signed) for reach, and add an attested native
  companion for `trained`/`professional` tiers when a reviewer, insurer or counsel requires it.
- The sidecar carries a nullable **`capture_attestation`** block from v1 (security level, attestation
  chain, verified-boot state, app identity) so the upgrade is purely additive.

### Honest limits — stated in-product, not buried

Research surfaced this repeatedly and it must be repeated to users:

> C2PA "does not verify that the scene being photographed is itself authentic. A C2PA-signed photo of
> a printed image, a screen, or a staged scene carries valid credentials." — lumethic.com

So C2PA proves **who processed what, how, and when** — the integrity of our pipeline. It does **not**
prove the building looked like that. Defence against that is layered:

1. The **physical scale in frame** must be present and consistent with the claimed geometry.
2. **Cross-observation corroboration** from independent contributors and dates.
3. **Sensor coherence checks** — does the GNSS fix, compass heading, sun angle and shadow direction
   agree with the claimed subject, date and time?
4. **Contributor tiering** — a licensed professional's submission carries different weight.

Also true, and worth planning for: client-side signing is impossible to do securely, because a browser
cannot hold a private key the user cannot extract. **All signing is server-side, at ingest and after
each pipeline stage.** The client's contribution to integrity is the SHA-256 computed at capture,
which lets ingest prove the bytes did not change in transit.

---

## 5. Offline and sync behaviour

Because processing is asynchronous, the client never blocks on the network:

1. Capture → write blob to OPFS, record to IndexedDB, compute SHA-256, mark `queued`.
2. Request `navigator.storage.persist()`; surface quota pressure loudly; offer one-tap local export as
   an escape hatch.
3. On connectivity, Background Sync drives **resumable chunked upload** keyed by capture UUID
   (idempotent — a retry after a partial upload resumes rather than duplicates).
4. Server verifies the hash, timestamps, signs, and enqueues processing; client marks `ingested` and
   may now safely delete its local blob.
5. Results arrive later; the client shows them when the operator returns to the session.

A day of fieldwork with no signal is a normal case, not an error case.

---

## 6. Security and governance notes

- **Signing keys in an HSM/KMS.** Rotate on schedule; publish the certificate chain and a trust list.
- **WORM storage for raw.** Deletion requires an audited, dual-control process.
- **Idempotent ingest** keyed by capture UUID + hash, so retries can never fork the provenance graph.
- **Pipeline versions are immutable artifacts.** A version that produced a signed result can never be
  edited, only superseded.
- **PII handling.** Faces and plates blurred on public derivatives; raw retained under restricted
  access. The blur is itself a recorded C2PA action, so the redaction is provable.
- **Licence enforcement at export.** Share-alike inputs (e.g. CC BY-SA material) are blocked from
  mixing into incompatible commercial deliverables.
