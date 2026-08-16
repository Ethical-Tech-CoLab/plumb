# Plumb backend

Ingest, trust and post-processing service for [Plumb](../README.md).

Publishes **`photo-survey` documents conforming to the CoLab
[`digital-3d-shared-contracts`](https://github.com/Ethical-Tech-CoLab/digital-3d-shared-contracts)**,
so the bridge and district twins consume Plumb captures with no bespoke adapter.

Design rationale: [docs/07-backend-and-twin-integration.md](../docs/07-backend-and-twin-integration.md).

---

## Quick start

### Run it directly

```bash
cd server
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn plumb.main:app --reload --port 8080
```

```bash
curl http://127.0.0.1:8080/v1/meta        # capabilities and honest limits
open http://127.0.0.1:8080/docs           # interactive OpenAPI
```

### Run it as a container

```bash
cd server/deploy/compose
cp .env.example .env          # edit ALLOWED_ORIGINS at minimum
docker compose up -d --build
curl http://localhost:8080/healthz
```

### Verify end to end

```bash
pip install pytest httpx
pytest tests -q               # 15 tests
python smoke_test.py http://127.0.0.1:8080
```

The smoke test performs a real interrupted-then-resumed upload, confirms the stored raw is
byte-identical, and prints the resulting contract document.

---

## Deployment targets

Same image everywhere.

| Target | How | Notes |
|---|---|---|
| **This machine** | `uvicorn plumb.main:app` | No container required |
| **Container, local** | `docker compose up -d --build` | Data on a named volume |
| **Another machine / LAN** | as above with `PLUMB_BIND=0.0.0.0` | **Set `PLUMB_REQUIRE_AUTH=true` first** |
| **Azure Container Apps** | `deploy/azure/deploy.sh rg-plumb eastus <image>` | Scale-to-zero, Azure Files for raw |
| **Azure App Service (containers)** | point at the same image | If you want always-on rather than scale-to-zero |
| **B3IQ infrastructure** | run the image, set origins + tokens | Plain HTTPS service; sits behind a gateway unchanged |

```bash
# Azure, one shot
export ALLOWED_ORIGINS="https://ethical-tech-colab.github.io"
./deploy/azure/deploy.sh rg-plumb eastus ghcr.io/ethical-tech-colab/plumb-backend:0.1.0
```

The script deploys **twice** on purpose: the service must know its own public URL to write correct
`image_url` values into contract exports.

---

## Configuration

Environment-variable names follow `pages-ai-proxy` conventions where they overlap.

| Var | Default | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | Exact, wildcard (`https://*.github.io`), or `*`. **Set this in production.** |
| `PLUMB_PUBLIC_BASE_URL` | — | Public URL of this service; used for `image_url` in exports |
| `PLUMB_REQUIRE_AUTH` | `false` | Turn on for anything beyond localhost |
| `PLUMB_API_TOKENS` | — | Comma list. `openssl rand -hex 32` |
| `PLUMB_DATA_DIR` | `./data` | Raw captures, records, jobs |
| `PLUMB_STORAGE` | `local` | `local` or `azure_blob` |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Required for `azure_blob` |
| `PLUMB_TSA_URL` | — | RFC 3161 authority. Unset ⇒ reported as untrusted |
| `PLUMB_C2PA_TOOL` / `_CERT` / `_KEY` | — | All three required to enable signing |
| `MAX_BODY_BYTES` | 64 MB | Per chunk |
| `MAX_CAPTURE_BYTES` | 512 MB | Per capture |
| `PLUMB_MODULE_ID` | `plumb-photo-survey` | digital-3d module identity |
| `PLUMB_FRAME_ID` | `nyc-harbor-enu` | Canonical shared frame |

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` · `/readyz` | Liveness; readiness actually probes storage writability |
| `GET` | `/v1/meta` | Capabilities, config, and explicit limits |
| `POST` | `/v1/captures` | Open or **resume** an upload. Idempotent on `capture_id` |
| `PUT` | `/v1/captures/{id}/blob` | Append a chunk (`Content-Range` supported) |
| `POST` | `/v1/captures/{id}/complete` | Verify digest, commit immutably, timestamp, sign, queue |
| `GET` | `/v1/captures/{id}` | Full record incl. chain of custody |
| `GET` | `/v1/captures/{id}/raw` | The untouched original |
| `GET` | `/v1/jobs/{id}` | Pipeline status, stage by stage |
| `GET` | `/v1/exports/photo-survey` | **digital-3d contract document** |
| `GET` | `/v1/exports/photo-survey/validate` | Structural self-check |

### Upload flow

```
POST /v1/captures            → { capture_id, resume_offset }
PUT  /v1/captures/{id}/blob  → repeat until complete (resumable)
POST /v1/captures/{id}/complete
       ├─ verify SHA-256 against the device's capture-time digest
       ├─ commit raw write-once
       ├─ RFC 3161 timestamp
       ├─ C2PA sign
       └─ enqueue post-processing → { job_id }
```

Retrying any step is safe. A phone that has been offline for a day resumes from its byte offset and
cannot create a duplicate or fork the provenance graph.

---

## Guarantees

- **Idempotent ingest.** Same `capture_id` ⇒ same record, same job.
- **Immutable raw.** A second commit of the same id is refused, not overwritten.
- **Digest mismatch is fatal.** The capture is marked `rejected` and kept for forensics.
- **No over-claiming.** Unsigned says `"assurance": "unsigned"`; an unconfigured TSA reports
  `"trusted": false`; unimplemented pipeline stages report `not_implemented`.
- **Photographs never grant confidence A** — enforced in the validator, per the contract.

## Not implemented yet

Declared in the job record so status is honest: `fiducial_detect`, `lens_undistort`,
`orientation_solve`, `rectify`, `measure`, `corroborate`.

Until those land, field measurements remain **PROVISIONAL** and the contract export carries appearance
evidence plus recorded (not re-solved) measurements.

## Scaling

The job queue is in-process and file-backed, so run **one replica per data directory**. To scale out,
swap `plumb/jobs.py` for a real broker (Azure Service Bus, Redis) and move storage to `azure_blob`.
The interfaces are deliberately small enough that this is an addition, not a refactor.

## Layout

```
plumb/
  config.py      env-driven settings
  storage.py     write-once raw + JSON records (local | azure_blob)
  trust.py       digests, RFC 3161 timestamps, C2PA signing
  contracts.py   digital-3d photo-survey mapping + validator
  jobs.py        versioned async pipeline records
  api.py         HTTP surface
  main.py        app factory, CORS
tests/           15 tests
deploy/compose/  docker compose + .env template
deploy/azure/    Bicep + one-shot deploy script
smoke_test.py    live end-to-end check
```
