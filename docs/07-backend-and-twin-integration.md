# 07 — Backend, Containers and Twin Integration

Answers the question *"build it as a DTSF Twin application if there is value in that, otherwise make
it a container"* — and the answer turned out to be **neither, exactly, and something better than
both.**

---

## 0. The decision

> **Plumb should not be another digital twin. It should be a contract-conformant *evidence provider*
> to the twins the CoLab already has.**

Reading the org's existing work changed the design:

| Repo | What it already does |
|---|---|
| `digital-3d-shared-contracts` | Publishes the normative schemas: `photo-survey`, `source-confidence` (A–D evidence grades), `georeference`, `module-manifest`. Also `PHOTO-SURVEY.md`, a full doctrine for crowdsourced photography as evidence |
| `manhattan-bridge-3d`, `brooklyn-bridge-3d`, `williamsburg-bridge-3d` | Source-governed bridge twins — "every part carries its provenance" |
| `dumbo-district-3d` | Walkable DUMBO twin built from authoritative NYC data |
| `pages-ai-proxy` | The serverless pattern for letting a static GitHub Pages app reach a server safely |
| `race-condition-mod` | The "DTSF twin backend + Pages frontend + self-hosted" deployment shape |

`digital-3d-shared-contracts` **already has a `photo-survey` schema whose one-line summary is
"crowdsourced photographic observations as evidence."** Plumb is precisely the capture client that
schema was waiting for. Building a parallel twin would have duplicated the viewer, the coordinate
frame, and the governance — and produced a second corpus nobody could join to the first.

So the backend is a **container that publishes `photo-survey` documents**. The bridge and district
twins consume Plumb output with no bespoke adapter, and Plumb never has to render anything.

### What this unlocks immediately

`PHOTO-SURVEY.md` names three open questions in the DUMBO twin that photographs can answer:

| Question | Currently inferred | Plumb supplies |
|---|---|---|
| `DOQ-007` | Facades describe the *kind* of building (PLUTO class + year), not that building | Observed facade material, colour, window pattern — grade `C` → `B` |
| `DOQ-006` | Paving widths are typical values by street class, not traced kerbs | Measured widths with stated uncertainty |
| props | Tree canopy is a plausible form for the genus, not that tree | Scale-referenced canopy dimensions |

That is the point of the whole campaign, in their words: **not prettier screenshots, but grade
promotion, from `C` inferred to `B` observed.**

---

## 1. The one place Plumb doesn't fit the contract — and what we did about it

`PHOTO-SURVEY.md` is explicit:

> **Photographs never grant grade `A`.** Grade A is reserved for official dimensions, archival
> drawings and authoritative datasets. A photograph is excellent evidence of *appearance* and poor
> evidence of *dimension*.

That rule is correct for ordinary photographs, and it is exactly the gap Plumb was built to close. A
Plumb capture is a *calibrated, hold-out-verified, uncertainty-quantified* observation: it is
dimensional evidence with a stated tolerance, which is a case the contract predates.

**We did not quietly widen the rule.** The service caps itself at `B`, and a unit test asserts that a
document granting `A` is refused:

```python
GRADE_BY_CALIBRATION = {
    "VERIFIED":   "B",   # sharp, located, rectified, and check-verified
    "UNVERIFIED": "C",   # scale known but never independently checked
    "FAILED":     "D",   # failed its hold-out check
}
```

Raising that cap is a **governance question for `digital-3d-shared-contracts`**, not something a
downstream producer should assume. The proposal to make there, with evidence:

> A photographic observation carrying a verified calibration (`CAL-4`/`CAL-5`), a passed hold-out
> check, and a stated expanded uncertainty meeting a named USIBD LOA band may grant grade `A` **for
> dimensional aspects only** — never for colour or material, which remain capped at `B`.

Until that is accepted, Plumb under-claims. That is the right direction to be wrong in.

We also honour the contract's hard-won relaxations. `PHOTO-SURVEY.md` records that a strict field
"does not prevent ignorance, it launders it" — so a missing position is emitted as absent **with
`position_source: "unknown"`**, never as an invented coordinate, and the validator refuses a document
that omits a position while claiming a real source.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Plumb PWA  (GitHub Pages — static, no secrets)                  │
│  capture · calibrate · assurance overlay · Wi-Fi-only queue       │
└───────────────────────────┬──────────────────────────────────────┘
                            │  CORS-safe HTTPS, resumable chunks
                            │  (origin allow-list, same semantics
                            │   as pages-ai-proxy)
┌───────────────────────────▼──────────────────────────────────────┐
│  plumb-backend  (this container)                                  │
│                                                                   │
│   ingest ──▶ verify digest ──▶ immutable raw ──▶ timestamp ──▶    │
│   C2PA sign ──▶ queue post-processing ──▶ publish contract        │
│                                                                   │
│   /v1/captures            idempotent, resumable                   │
│   /v1/jobs                async pipeline status                   │
│   /v1/exports/photo-survey    digital-3d contract document        │
└───────────────────────────┬──────────────────────────────────────┘
                            │  photo-survey document
┌───────────────────────────▼──────────────────────────────────────┐
│  digital-3d twin stack                                            │
│  manhattan-bridge-3d · brooklyn-bridge-3d · williamsburg-bridge-3d│
│  dumbo-district-3d   — consume observations, promote confidence   │
└──────────────────────────────────────────────────────────────────┘
```

### Why FastAPI/Python

The pipeline's future is OpenCV, COLMAP and bundle adjustment, all of which are Python-native. The org
already ships FastAPI (`Exodus`), so this is a familiar shape rather than a new one. The container is
`python:3.12-slim`, non-root, with a real healthcheck.

---

## 3. Relationship to `pages-ai-proxy`

`pages-ai-proxy` solves *"GitHub Pages is static — it can't hold a secret or proxy around CORS"* for
**OpenAI-compatible chat traffic**. Plumb's backend is not chat traffic — it moves large binary
uploads — so it is a sibling service rather than something to route through that proxy.

What it deliberately borrows, so operators find the same knobs:

| Convention | Applied in Plumb |
|---|---|
| `ALLOWED_ORIGINS` with exact / wildcard / `*` semantics | Same parser, same behaviour |
| `MAX_BODY_BYTES` request guard | Per-chunk guard, plus `MAX_CAPTURE_BYTES` |
| Server-side secrets, never in the browser | C2PA keys, API tokens, storage keys |
| One core, several run targets | Local, container, Azure Container Apps |

If B3IQ later fronts everything with a single gateway, Plumb sits behind it unchanged — it is a plain
HTTPS service with an origin allow-list.

---

## 4. Deployment paths

All four run the same image. Nothing is cloud-only.

| Target | Command | Use |
|---|---|---|
| **This machine** | `uvicorn plumb.main:app --port 8080` | Development; no container needed |
| **Container, local** | `docker compose up -d --build` | The normal self-hosted path |
| **Another machine on the LAN** | same, with `PLUMB_BIND=0.0.0.0` + `PLUMB_REQUIRE_AUTH=true` | A lab box or workshop server |
| **Azure Container Apps** | `deploy/azure/deploy.sh rg-plumb eastus <image>` | Scale-to-zero, no VM to patch |
| **B3IQ infrastructure** | run the image; set `ALLOWED_ORIGINS` + tokens | Owned-GPU host alongside other CoLab services |

The Azure template provisions Log Analytics, a Container Apps environment, a storage account with a
file share for raw captures (so they outlive any container), liveness/readiness probes, and
scale-to-zero. `deploy.sh` does a **two-pass** deploy because the service needs to know its own public
URL to write correct `image_url` values into contract exports — easy to forget by hand.

Azure App Service for Containers is an equally valid target if an always-on plan is preferred; the
image is unmodified, only the hosting differs.

---

## 5. What is built, and what is honestly not

Implemented and tested (15 unit tests + a live smoke test, all passing):

- Idempotent, resumable chunked ingest keyed by `capture_id`
- SHA-256 verification against the client's capture-time digest; **mismatch is rejected**, not repaired
- Write-once raw storage; a second commit of the same id is refused
- RFC 3161 timestamp hook, C2PA signing hook via `c2patool`
- Async job records with a versioned pipeline
- `photo-survey` contract export plus a structural validator
- CORS allow-list, bearer-token auth, health/readiness probes

**Declared but not implemented** — the pipeline reports these as `not_implemented` rather than
silently returning nothing: fiducial detection, lens undistortion, orientation solve, rectification,
measurement re-solve, corroboration.

Equally honest about the rest:

- No signer configured ⇒ artifacts say `"assurance": "unsigned"`.
- No TSA configured ⇒ `"trusted": false` with the server clock recorded as a server clock.
- The container build was **not** verified on this machine (no Docker available); the application it
  runs was verified by launching it exactly as the image's `CMD` does.

---

## 6. Next steps

1. Build and push the image; verify `docker compose up` on a machine with Docker.
2. Open a governance issue on `digital-3d-shared-contracts` proposing the dimensional-evidence grade
   (§1), with the Monte-Carlo uncertainty validation as supporting evidence.
3. Agree the asset URN scheme with `dumbo-district-3d` so `observes[].asset_id` joins cleanly.
4. Stand up C2PA signing with a real certificate and confirm a signed capture validates in `c2patool`
   and in-browser via `c2pa-js`.
5. Implement `fiducial_detect` and `orientation_solve` — the first two stages that turn a provisional
   field number into an authoritative one.
