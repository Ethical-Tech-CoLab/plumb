# Plumb

**Measured photography for landmarks.** A browser-based system for producing *measured, verifiable*
photographs of historic buildings and bridges — with a calibrated on-screen grid and ruler, a raw
photograph that stays raw, and cryptographically verifiable provenance.

> **plumb** *(adj.)* — exactly vertical; true.
> **to plumb** *(v.)* — to measure the depth of; to examine closely.
> **plumb** *(adv.)* — precisely.
>
> The plumb line is the oldest measuring instrument in building. This is the same idea, with a camera.

An [Ethical Tech CoLab](https://github.com/ethical-tech-colab) project.

## 📱 Try it now

**<https://ethical-tech-colab.github.io/plumb/>**

Open it on your phone — no install, no account. Served over HTTPS, which the camera and
orientation sensors require. On Android Chrome you get the full feature set; add it to your home
screen to run it fullscreen.

New to this? Read **[HOW-TO-PLUMB.md](HOW-TO-PLUMB.md)** first — it's a 15-minute illustrated guide
written for someone who has never done this before.

---

## What problem this solves

Architectural and preservation work needs photographs that are **evidence**, not illustrations: images
you can measure from, whose location, creator, date and lineage can be verified, and which meet the
documentation standards landmark work is actually held to.

The Secretary of the Interior's Standards for Architectural and Engineering Documentation
(HABS/HAER/HALS) already **require a scale in the photograph**:

> "Level I photographs shall include duplicate photographs that include a scale. Level II and III
> photographs shall include, at a minimum, at least one photograph with a scale, usually of the
> principal facade."

So the ruler in the frame is not a feature idea — it's the deliverable requirement. Plumb makes it
routine, and makes the resulting measurement honest about its own uncertainty.

## The three decisions that shape the design

1. **Android Chrome is the primary platform.** Full-resolution in-page capture, lockable optics,
   WebXR depth sensing and Bluetooth laser meters are Android capabilities, and Plumb is designed to
   use them. iOS Safari is a supported, honestly-labelled reduced-capability client — it doesn't get a
   veto over the feature set.
2. **Capture is not real-time metrology.** The field client produces a provenance-complete bundle;
   authoritative measurement happens in **server-side post-processing**, which can use every image of a
   subject together — and can be re-run years later on the same immutable bytes to produce a *better*
   answer.
3. **C2PA is the provenance backbone.** Raw captures are signed at ingest; every derivative names its
   parents as C2PA ingredients, giving verifiable lineage from any deliverable back to the original
   exposure.

## Documents

| Document | Contents |
|---|---|
| [01 — Research findings](docs/01-research-findings.md) | Standards (SOI/HABS, Historic England, USIBD LOA, ASPRS, CIPA), accuracy reality check, open-source building blocks, Android-vs-iOS capability matrix, market scan, crowd-sourcing precedents, Brooklyn Bridge / DUMBO context |
| [02 — Calibration methodology](docs/02-calibration-methodology.md) | **How to calibrate the grid.** Five calibration tiers, homography maths, the optics-lock precondition, uncertainty budget, hold-out verification, the off-plane problem, physical kit |
| [03 — Feature list](docs/03-feature-list.md) | ~95 features across capture, overlay, calibration, measurement, provenance, server pipeline, corpus, 3D, field ops and governance |
| [04 — Implementation plan](docs/04-implementation-plan.md) | Architecture, stack, data model, 6-phase roadmap with exit criteria, 18-item risk register |
| [05 — Server & provenance](docs/05-server-and-provenance.md) | Server architecture, the post-processing pipeline stage by stage, and the C2PA provenance chain with custom survey assertions |
| [06 — Trust anchor & licensing](docs/06-trust-anchor-and-licensing.md) | On-device keystore signing, why a blockchain can't be the C2PA trust anchor (but is a good archival anchor), and CC BY vs CC BY-SA |
| [07 — Backend & twin integration](docs/07-backend-and-twin-integration.md) | Why Plumb is an **evidence provider to the existing CoLab twins**, not a new twin; container and Azure deployment |
| [HOW-TO-PLUMB](HOW-TO-PLUMB.md) | **Novice field guide** — illustrated, start to finish |

## Decisions on record

| Question | Decision |
|---|---|
| Contributor licence | **CC BY 4.0** (photos) + **CC0** (measurement data) + **Apache-2.0** (code), with contributor vetting and a click-through CLA. Share-alike rejected — it would block the architects and engineers the corpus exists to serve |
| C2PA trust anchor | **X.509 from a C2PA Trust List CA** + **RFC 3161 TSA**. A blockchain key cannot sign a conformant C2PA claim |
| Blockchain role | **Optional archival anchor** — daily Merkle root to Base, < $1/yr, institution-independent existence proof. Additive, droppable, explicitly *not* the trust anchor |
| On-device keystore signing | **Deferred.** It's the only route to C2PA Assurance Level 2 (Pixel 10 precedent), but unreachable from a PWA. A nullable `capture_attestation` block is reserved from v1 |

## Prototype

A working, dependency-free browser prototype of the client:

```bash
cd prototype
python -m http.server 8777
# open http://127.0.0.1:8777/

node --test test/geometry.test.mjs   # 26 tests
```

End to end: camera capture with optics locking → toggleable metric grid and ruler → 4-point homography
calibration → mandatory hold-out check → measurement with a validated uncertainty budget and USIBD LOA
band → raw + overlay + provenance sidecar export. Plus WebXR AR measurement and plane-deviation
scaffolding for Android, and **Wi-Fi-only upload gating** by default. See
[prototype/README.md](prototype/README.md).

## Backend

A containerised ingest/trust service that publishes into the CoLab twin stack:

```bash
cd server
docker compose -f deploy/compose/docker-compose.yml up -d --build
curl http://localhost:8080/v1/meta

pytest tests -q                              # 15 tests
python smoke_test.py http://localhost:8080   # live end-to-end
```

It emits **`photo-survey` documents conforming to
[`digital-3d-shared-contracts`](https://github.com/Ethical-Tech-CoLab/digital-3d-shared-contracts)**,
so `dumbo-district-3d` and the bridge twins consume Plumb captures directly — turning inferred facade
data (`C`) into observed evidence (`B`). Runs on a laptop, a LAN box, B3IQ infrastructure, or Azure
Container Apps from the same image. See [server/README.md](server/README.md).

## Research method

All research was gathered with the **Tavily API**, called directly over REST: **119 queries across 10
thematic batches, plus 14 targeted page extractions.** Raw responses and query sets are preserved in
[research/](research/) so every claim is traceable and every batch is re-runnable.

```powershell
$env:TAVILY_API_KEY = "..."
.\research\tavily.ps1 -QueryFile .\research\q1_opensource.txt -OutFile .\research\raw\r1_opensource.json
```

## What Plumb is not

- Not a replacement for a total station, terrestrial laser scan, or a licensed survey.
- Not a claim that a phone photograph is survey-grade — achievable accuracy is stated honestly
  (roughly USIBD LOA20–LOA10 for marker-calibrated single images; better with external control).
- Not a system that trusts GNSS as scale, or a device clock as a legal timestamp.
- Not a system that lets an uncalibrated grid imply a measurement. `CAL-0` measurement is *disabled*,
  not merely warned about.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contribution is open but **gated** — measured evidence is only
as good as the people producing it, so contributors are vetted and submissions are curated before
publication.

## Licence

- **Code** — [Apache-2.0](LICENSE)
- **Documentation, photographs and derived imagery** — [CC BY 4.0](LICENSE-CONTENT)
- **Measurement data and metadata** — [CC0 1.0](LICENSE-DATA)

Rationale in [docs/06-trust-anchor-and-licensing.md](docs/06-trust-anchor-and-licensing.md) §3.
