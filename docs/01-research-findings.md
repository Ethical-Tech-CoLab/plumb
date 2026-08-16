# 01 — Research Findings

**Method:** All research in this document was gathered with the **Tavily API**, called directly over
REST (`https://api.tavily.com/search` and `/extract`) using the local `TAVILY_API_KEY` environment
variable. 86 queries across 7 thematic batches plus 9 targeted page extractions. Raw JSON responses
are preserved in [research/raw](../research/raw) and condensed summaries in
[research/](../research). The Tavily *MCP server* in this environment returns `Invalid API key`
(stale credential); the REST API with the environment-variable key works and was used instead. No
substitute search provider was used.

Re-run any batch with:

```powershell
.\research\tavily.ps1 -QueryFile .\research\q1_opensource.txt -OutFile .\research\raw\r1_opensource.json
```

---

## 1. The regulatory driver: a scale in the frame is not optional

The single most important finding for a Landmarks-grade product is that **the governing US standard
already mandates a scale in the photograph.**

The Secretary of the Interior's *Standards and Guidelines for Architectural and Engineering
Documentation* (HABS/HAER/HALS), published by the National Park Service, states:

> "Large-format photographs: **Level I photographs shall include duplicate photographs that include a
> scale.** Level II and III photographs shall include, at a minimum, **at least one photograph with a
> scale, usually of the principal facade.**"
> — <https://www.nps.gov/subjects/heritagedocumentation/soi-standards-guidelines.htm>

Consequences for the product:

- The "ruler on screen" is not a novelty. It is **the deliverable requirement**, and it must be
  physically in the scene (a scale bar / ranging rod), not only drawn in software.
- The correct pattern is therefore **duplicate captures**: one frame with the physical scale in view,
  one frame clean. This maps exactly onto the request for "grid on/off so the raw photo is still
  useful."
- Documentation is tiered (Level I / II / III), which gives us a natural quality-tier model to mirror
  in the app.

Supporting standards found:

| Standard | What it gives us | Source |
|---|---|---|
| SOI Standards for Architectural & Engineering Documentation (HABS/HAER/HALS) | Photo-with-scale mandate, Level I/II/III tiers, archival format rules | nps.gov, loc.gov `pictures/collection/hh/technote.html` |
| Historic England, *Geospatial Survey Specifications for Cultural Heritage* (4th ed., formerly *Metric Survey Specifications*) | Tolerance/deliverable specification language for heritage metric survey; covers SfM photogrammetry and drone imagery | historicengland.org.uk `/images-books/publications/geospatial-survey-specifications-cultural-heritage` |
| Historic England, *Photogrammetric Applications for Cultural Heritage* (Bedford, 2017, 124 pp.) | Practical SfM good-practice guidance for heritage recording | historicengland.org.uk `/images-books/publications/photogrammetric-applications-for-cultural-heritage` |
| USIBD *Level of Accuracy (LOA) Specification v3.1* (2025) | 5 accuracy tiers, and the crucial split between **Measured Accuracy** and **Represented Accuracy** | usibd.org `/level-of-accuracy`, lidarmag.com 2025-02-09 |
| ASPRS *Positional Accuracy Standards for Digital Geospatial Data*, Ed. 2 v2 (2024) | Sensor-agnostic, metric accuracy reporting language + addenda on ground control and checkpoints | asprs.org, USGS `ngp-standards-and-specifications` |
| CIPA / ICOMOS *Principles for the Recording of Monuments, Groups of Buildings and Sites* (1996) | International doctrinal basis for heritage recording | icomos.org `/charters-and-doctrinal-texts` |

**USIBD LOA tiers** (tolerance ranges, derived from DIN 18710; confirmed via Tavily):
LOA10 ≈ 5 cm · LOA20 ≈ 15 mm · LOA30 ≈ 6 mm · LOA40 ≈ 3 mm · LOA50 ≈ 1 mm.

The LOA "Measured vs Represented" distinction is directly reusable: our app produces *measured*
accuracy from imagery; anything a designer later draws from it carries *represented* accuracy. The
export must state both, or state measured only and refuse to imply the other.

**Realistic target:** a browser-based, marker-calibrated single-image workflow lands at **LOA20–LOA10**
(≈15 mm to 5 cm) for facade elements in a calibrated plane. That is enough for landmark condition
documentation, material take-offs, and visual recreation — and is *not* enough to replace a
total-station or TLS control survey. The plan says this explicitly.

---

## 2. Accuracy reality check for phone-camera capture

- **Democratizing photogrammetry: an accuracy perspective** (Geo-spatial Information Science,
  2023, tandfonline 10.1080/10095020.2023.2178336): smartphone SfM geo-referenced by phone GNSS alone
  reaches only **~165 cm** positional accuracy; using coarse public lidar (3DEP) as control improves
  it to **~43 cm**; using survey ground control gets to **~14.5 cm**. Fusing smartphone facade images
  with drone imagery reached **3–4 cm**.
  **Interpretation: phone GPS is worthless as a metric control. Scale must come from an object of
  known length in the scene.** This is the central design constraint of the whole system.
- OpenDroneMap docs: carefully executed projects with GSD < 1 cm should expect **1–2 % accuracy**,
  comparable to commercial packages (docs.opendronemap.org/tutorials).
- GCP practice: RTK-measured, well-distributed GCPs typically yield **1–3 cm horizontal / 2–5 cm
  vertical** (skyebrowse, Pix4D, Wingtra).
- Close-range photogrammetry minimum control: **two 3D control points and one 1D (scale) control
  point** to scale, position and orient a model (CAST/Univ. of Arkansas gmv.cast.uark.edu).
- Cultural Heritage Imaging calibrated scale bars are certified to **0.1 mm or better**, with the
  calibrated inter-target distance physically written on the bar — the model for our "certified
  target" concept.

---

## 3. Open-source building blocks that run in a browser

Everything below is client-side capable. This is the evidence that the capture + calibrate + measure
loop can be browser-only.

### Computer vision / calibration
| Tool | License | Role in our system | Source |
|---|---|---|---|
| **OpenCV.js** (Emscripten/WASM build of OpenCV) | Apache-2.0 | `findHomography`, `calibrateCamera`, `undistort`, `cornerSubPix`, ArUco module | docs.opencv.org; calibDB paper arXiv 1907.04100 explicitly ports OpenCV calibration to the web via OpenCV.js |
| **js-aruco2** (damianofalcioni) | pure JS | ArUco marker detection + camera pose, 100 % client-side, live webcam demos | github.com/damianofalcioni/js-aruco2 |
| **apriltag-js-standalone** (arenaxr) | WASM (emscripten) | AprilTag detection in browser via `cwrap`; also a 2025 write-up of an in-browser AprilTag detector on Android | github.com/arenaxr/apriltag-js-standalone; rossng.eu 2025-08-03 |
| **AR.js** | MIT | Marker-based web AR; marker generator for custom patterns | ar-js-org |
| **calibDB** (arXiv 1907.04100) | research | "on-the-fly camera calibration" served to web CV apps — a *calibration database keyed by device*, which is precisely the pattern we need for phone lens profiles | ar5iv.labs.arxiv.org/html/1907.04100 |

### Rectification / measurement precedent
- **smallpond.ca "Image rectification tool"** — an existing, working, browser-only tool: you load a
  photo containing a printed reference scale, drag four markers to the scale's corners, and it
  computes the homology to a known rectangle and rectifies the entire image. Its own documentation
  states the key caveat verbatim: the transformation "works best when everything in your photo is in
  the same plane as the reference scale… off-plane points in the image will likely still look
  distorted." <https://smallpond.ca/jim/scale/rectify.html>
  **This is a direct proof of concept for our core feature, and its caveat is our core UX problem.**
- **ImageJ / Fiji "Set Scale"** — the canonical scientific pattern: draw a line over a known distance,
  enter the real length, everything is then measured in real units. Desktop, but the interaction model
  is what field users already understand.
- **OpenSeadragon** + `OpenSeadragonScalebar` / annotation plugins — deep-zoom viewer with scale bar
  and canvas overlays; the right base for the archive/review viewer.
- **IIIF** — the cultural-heritage standard for image delivery + annotation; makes the corpus
  interoperable with museum/library infrastructure.

### 3D / point cloud (server-side or heavy client)
- **WebODM / OpenDroneMap** (MIT, browser GUI over a server engine), **Meshroom/AliceVision**,
  **COLMAP**, **OpenMVG/OpenMVS**, **OpenSfM**, **MicMac** — all open source, all *desktop or server*.
  No production WebAssembly SfM pipeline was found; SfM stays server-side.
- **Potree** (WebGL point-cloud renderer, TU Wien) and **three.js** — client-side viewers with
  point-to-point and area measurement tools. MassDOT extended Potree's measurement tools with GeoJSON
  features, showing the extension path.
- **SuperSplat** (PlayCanvas, MIT) — open-source Gaussian-splat viewer with good mobile performance,
  for the "visual recreation" deliverable.
- **Giro3D** (OSGeo) — JS framework for 2D/2.5D/3D geodata with measurement.

### Metadata / provenance
- **exifr** (MikeKovarik) — fast chunked EXIF/GPS/XMP/IPTC reader, browser + Node.
- **piexifjs** (hMatoba) — the notable one that can **write** EXIF client-side.
- **c2pa-js** / Content Credentials — C2PA JS SDK (WASM) reads and validates C2PA manifests in the
  browser; Digimarc ships a Chrome extension built on it. Spec: `spec.c2pa.org` v2.4. Camera-level
  signing already exists in Leica M11-P/SL3, Sony A1/A9 III/A7S III/A7 IV, Nikon Z6 III.
  **Caveat found and worth repeating in our docs:** C2PA "does not verify that the scene being
  photographed is itself authentic. A C2PA-signed photo of a printed image, a screen, or a staged
  scene carries valid credentials." (lumethic.com)
- **ProofMode** (Guardian Project + WITNESS + Okthanks, GPL-3.0) — 10+ year open-source verified-capture
  project: cryptographic signing, timestamping, and *never modifies the original media* — all proof
  metadata is stored alongside. That "sidecar, never touch the original" rule is exactly right for a
  raw-photo-must-stay-raw archive.
- **Truepic** — commercial verified-capture SDK used in construction documentation.

---

## 4. Browser API capability matrix — Android is the reference platform

**Platform decision: Android Chrome is the primary delivery target.** The feature set is designed
against Android's capabilities. iOS Safari is supported as a **reduced-capability secondary client**,
and its limitations are explicitly *not* allowed to constrain the Android design.

| Capability | **Android Chrome (primary)** | iOS Safari (secondary) | Implication |
|---|---|---|---|
| `getUserMedia` live camera | Yes, high resolution, `resizeMode: none` | Yes, but HTML Media Capture recording is documented as throttled to 480×360 in several cases; PWA quirks (WebKit bug 252465) | Android preview is usable for framing *and* analysis |
| **`ImageCapture.takePhoto()` (full-sensor still)** | **Yes (Chrome 59+)** — `getPhotoCapabilities()` gives max still dimensions; this is the **primary archival capture path** | **Not supported in any stable Safari, incl. Safari 26** (macOS/iPadOS/iOS) | Android captures full-res in-page; iOS falls back to `<input capture>` → native camera |
| **Optics control** (`zoom`, `torch`, `focusMode`, `focusDistance`, `exposureMode`, `whiteBalanceMode`) | **Yes** | Largely no | **Metrology-critical, not cosmetic:** locking focus + zoom keeps intrinsics constant, which is what makes a stored CAL-4 lens profile valid across a session. Autofocus silently changes effective focal length between frames. |
| Camera intrinsics (focal length) via `getCapabilities()` | No — spec exposes aspectRatio, frameRate, zoom, torch, focusDistance; **no focal length** | No | Intrinsics come from EXIF, a device profile DB, or scene geometry — never assumed. Locking optics is what makes a cached profile trustworthy. |
| **WebXR Device API** (hit-test, **depth sensing** via ARCore, anchors, light estimation) | **Yes** | **No native WebXR on iOS Safari** (visionOS Safari only, VR-only); iOS needs App Clip shims like Variant Launch | **Marker-free AR measurement, and — more importantly — *measured* off-plane depth.** This attacks the dominant error source in single-image metrology directly. |
| **Web Bluetooth** (Leica DISTO-class laser meters) | **Yes** (Chrome, Edge, Samsung Internet) | **No** | Android reaches CAL-5 with a laser meter; iOS needs manual entry |
| WebUSB / Web Serial (RTK GNSS, total station) | WebUSB yes on Android Chrome; Web Serial desktop | No | External survey control ingest is an Android/desktop capability |
| `DeviceOrientationEvent` + absolute heading | Yes (`deviceorientationabsolute`) | Yes, `webkitCompassHeading` + `webkitCompassAccuracy` (typically ±10°), needs a user-gesture permission | Level/plumb HUD and approximate bearing on both |
| Geolocation API | Yes | Yes | Metres-level; provenance metadata only (see §2) |
| OPFS / IndexedDB / Storage API | Yes; Chrome quota ≈60 % of free disk; `navigator.storage.persist()` | Yes, tighter and evictable quotas | Large offline field buffers are practical on Android |
| WASM + WebGPU | Yes | Yes (WASM), WebGPU shipping | Enough for homography, undistort, marker detection, tiled rectification |
| EXIF read/write in page | Yes (`exifr`, `piexifjs`) | Yes | Full metadata control client-side |
| C2PA manifest **verification** in page | Yes (`c2pa-js`, WASM) | Yes | Reading/validating is client-side; **signing** needs a protected key → server |

### What Android-first actually buys us

1. **Full-resolution archival capture without leaving the page** — no native-camera round trip, no
   user confusion about which app took the photo, and the capture stays inside our provenance chain
   from the first byte.
2. **Locked optics → valid lens profiles.** This is the single biggest accuracy lever available for
   free. A locked focus/zoom session means one CAL-4 calibration applies to every frame in it.
3. **Measured off-plane depth instead of estimated.** ARCore depth sensing turns the dominant silent
   error (§8.1) into an observed, recorded quantity.
4. **Marker-free measurement** via WebXR hit-test, for situations where placing a physical target is
   impossible (a bridge soffit, a cornice at height, a live roadway).
5. **Laser-meter integration** over Web Bluetooth, which makes the mandatory hold-out check a single
   button rather than a manual tape measurement.

### Verdict on "can we build this entirely in a browser?"

**The field client is entirely a browser app. A server is a deliberate part of the design — not a
workaround — and it does the heavy metrology.**

Because **capture is not a real-time measurement requirement**, the architecture splits cleanly:

- **Browser (Android PWA), offline-capable:** guided capture, full-resolution stills with locked
  optics, live grid/ruler/level overlay for *capture assurance*, optional in-field calibration and
  measurement as a sanity check, provenance sidecar, durable offline queue, AR measurement and depth
  capture on Android.
- **Server, post-processing:** the authoritative metrology. Sub-pixel fiducial detection, lens
  undistortion, bundle adjustment, SfM/MVS, cross-observation corroboration, C2PA signing, trusted
  timestamps, identity, archive, and export packages.

This is strictly better than doing everything live. Post-processing can run algorithms a phone would
never finish in real time, can use *all* the images of a subject together rather than one at a time,
and can be re-run later when the software improves — while the raw captures, being immutable and
signed, remain valid inputs forever.

See [05-server-and-provenance.md](05-server-and-provenance.md) for the post-processing pipeline and
the C2PA provenance chain.

---

## 5. Market scan — what exists on iPhone / Android

### A. Photo-annotation measurement (closest to the ask)
- **ImageMeter** (Dirk Farin; Android + iOS) — the strongest direct analogue: annotate photos with
  lengths, angles, areas; **connects to Bluetooth laser distance meters**; PDF/spreadsheet report
  export; PC sync; audio notes. imagemeter.com
- **My Measures**, **Photo Measure / Image Meter** clones — same idea, consumer-grade.

### B. AR ruler apps (fast, low accuracy)
- **Apple Measure** (ARKit) — user reports of a 48.5″ doorway reading 47″ (~3 % error).
- **AR Ruler / Grymala**, and many ARCore equivalents. Google's own **Measure** app was killed in 2021;
  ARCore remains. Vendors themselves state these are "not suited for applications where very exact
  ruler measurements are needed."

### C. Capture apps with survey-grade ambition
- **Pix4Dcatch** (iOS/Android) — photogrammetric capture with **external RTK receiver support**; the
  reference for "phone + real control = survey grade."
- **DroneDeploy Ground** — 360° walkthrough capture, BIM alignment, and an **X-Ray** feature that
  overlays a previously captured image on the live view with adjustable transparency.
  **This is exactly the re-shoot/monitoring feature Landmarks work needs and we should copy it.**
- **Polycam** (LiDAR; publishes "within 0.5 inch tolerance on standard interior captures", Pro iPhones
  only), **Scaniverse** (Niantic; LiDAR + 3D Gaussian splatting, free, iOS + Android),
  **KIRI Engine** (iPhone/Android/**web**), **3D Scanner App**, **EveryPoint**, **RealityScan**,
  **Canvas** (Occipital), **magicplan**.
- Comparative studies note that **software choice and scene type dominate results more than the phone's
  LiDAR** (3dmag.com, citing an iPhone 13 Pro building-documentation comparison).

### D. Field-camera / metadata-stamping apps — the "verifiable lineage" precedent
- **Theodolite** (iOS, since 2009) — compass + two-axis inclinometer + rangefinder + GPS + map, with
  **on-screen grid/crosshair overlays burned into the photo** and geo-overlay photo/movie modes. Its
  manual documents both a plain full-resolution photo mode and an overlay mode.
  **This is the closest existing product to the requested "camera with gridlines + verifiable
  location/creator/date/time."**
- **Solocator**, **GeoCam** — GPS field cameras that stamp coordinates, bearing, date/time into the
  image and EXIF.

### Market gap (our opening)
No shipping product combines **(a)** a metrologically honest, calibrated on-screen grid/ruler,
**(b)** a raw + overlay dual-artifact output, **(c)** verifiable capture provenance (C2PA/ProofMode
class), **(d)** heritage-standard compliance (SOI/HABS scale-in-frame, Historic England tolerance
language, USIBD LOA reporting), **(e)** browser delivery with no app install — which is what makes
crowd-sourcing possible at all.

---

## 6. Crowd-sourcing precedents and licensing

| Project | Model | Lesson |
|---|---|---|
| **Mapillary** (Meta) | Crowdsourced street-level imagery, images under **CC BY-SA 4.0**, computer-vision derived features, ArcGIS plugin | Proven volume model; note the **share-alike** obligation and platform-terms risk of a corporate owner |
| **KartaView** (ex-OpenStreetCam, Grab) | Free/open platform, open-source apps, now adding **crowdsourced LiDAR** (SotM US 2025) | Community concern about maintenance stagnation → don't depend on a single upstream |
| **Open Heritage 3D / CyArk** | Open access 3D heritage datasets with **DOIs** and per-dataset licensing | The archival model to emulate: DOI + explicit license + metadata per dataset |
| **Rekrei / Project Mosul** | Crowdsourced photos → photogrammetric reconstruction of destroyed heritage | Proves the crowd→reconstruction pipeline for exactly our use case |
| **Wiki Loves Monuments** | Largest photo competition in the world, monument lists drive coverage | **Gamified, list-driven coverage** is how you get contributors to shoot the boring buildings |
| **HeritageTogether** | Academic community co-production of heritage photogrammetry | Community training and co-ownership matter more than the software |

Quality-control literature (Citizen Science: Theory and Practice, "From Crowd to Collection")
identifies the **integration gap**: crowdsourced material rarely makes it into the authoritative
collection. Our answer is the tiered-evidence model in [03-feature-list.md](03-feature-list.md) —
every image carries a machine-checkable accuracy class so a curator can filter, not audit by hand.

---

## 7. Local context (Brooklyn Bridge / DUMBO)

- **Brooklyn Bridge** is already documented as **HAER NY-18** in the Library of Congress
  (loc.gov/pictures/item/ny1234); construction 1869–1883, NRHP #66000523. New capture should be
  **registered against the existing HAER frame**, not created in a vacuum — i.e. re-shoot the HAER
  viewpoints.
- **DUMBO Historic District** — LPC-designated 18 Dec 2007, ~95 contributing buildings, NRHP-listed
  2000 (LPC designation report `s-media.nyc.gov/agencies/lpc/lp/2279.pdf`). Belgian block roadways are
  themselves LPC-protected features (nyc.gov DDC), and a $108 M historic restoration completed
  Nov 2025 — i.e. **there is active, documented change to record**.
- NYC LPC permit applications require current and historic photographs; historic imagery comes from
  municipal archives / NYPL (nyc.gov/site/lpc/applications).
- Brooklyn Bridge Park FEIS Ch. 7 shows the mechanism: adverse-impact findings trigger **HABS
  documentation** obligations. That is a concrete, funded demand signal for this tool.

---

## 8. Key risks surfaced by the research

1. **Off-plane error is the dominant failure mode.** Every rectification tool found carries the same
   warning. A cornice 600 mm proud of a facade calibrated at the wall plane will read wrong, and the UI
   must show that, not hide it. **Android mitigation:** ARCore depth sensing measures the offset
   instead of asking the operator to guess it.
2. **Platform capability gap is real, and we resolve it by choosing Android.** iOS Safari has no
   WebXR, no `ImageCapture`, no Web Bluetooth, and throttled `getUserMedia`. Rather than reduce the
   product to the iOS intersection, Android Chrome is the reference platform and iOS is a
   reduced-capability client.
3. **Phone GNSS is not control.** ~165 cm best case. Location is provenance metadata; it is never scale.
4. **C2PA proves pipeline integrity, not scene truth.** A signed photo of a printed photo still
   validates. Provenance must be combined with cross-observation checks and a physical scale in frame.
5. **Browser storage is evictable.** Field data can vanish before upload — hence `persist()`, loud
   quota warnings, and resumable upload.
6. **Crowd-sourced share-alike licensing can poison downstream commercial deliverables** — decide the
   contributor licence up front (see plan §Governance).
7. **Represented ≠ Measured accuracy** (USIBD). Exports must not let a 15 mm measurement become an
   implied 15 mm CAD line.
8. **Autofocus quietly invalidates lens calibration.** Any cached intrinsic profile is only valid for a
   locked focus and zoom — which is precisely why the Android optics-locking capability matters.
