"""
Plumb backend — HTTP API.

Design constraints that shape every endpoint:

  * Capture is not real-time metrology. Ingest is cheap and fast; the expensive
    work is queued. Nothing the field client does blocks on analysis.
  * Ingest is idempotent on capture_id. A phone retrying after a day offline
    must never fork the provenance graph or create duplicates.
  * The raw object is immutable once committed.
  * Nothing claims more assurance than it obtained.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .config import settings
from .contracts import build_photo_survey, validate_document
from .jobs import job_queue
from .storage import ImmutabilityError, StorageError, storage
from .trust import (
    build_c2pa_manifest,
    c2pa_available,
    sha256_file,
    sign_c2pa,
    trusted_timestamp,
    utc_now,
    verify_integrity,
)

router = APIRouter()


# ----------------------------------------------------------------- auth

async def require_token(authorization: str | None = Header(default=None)) -> None:
    """Bearer-token gate for write operations. Open by default for local use."""
    if not settings.require_auth:
        return
    if not settings.api_tokens:
        raise HTTPException(
            status_code=500,
            detail="PLUMB_REQUIRE_AUTH is on but no PLUMB_API_TOKENS are configured.",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required.")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.api_tokens:
        raise HTTPException(status_code=403, detail="Token not recognised.")


# ----------------------------------------------------------------- models

class CaptureInit(BaseModel):
    capture_id: str | None = Field(
        default=None, description="Client-generated UUID. Makes ingest idempotent."
    )
    filename: str | None = None
    bytes_total: int = Field(gt=0, description="Total size of the raw object.")
    sha256: str | None = Field(
        default=None, description="Digest computed on device at capture time."
    )
    content_type: str = "image/jpeg"
    sidecar: dict[str, Any] = Field(
        default_factory=dict, description="Plumb provenance sidecar."
    )
    license: str | None = None
    license_url: str | None = None
    usage: str | None = None


class CaptureCompleteResult(BaseModel):
    capture_id: str
    state: str
    integrity: dict[str, Any]
    timestamp: dict[str, Any]
    signing: dict[str, Any]
    job_id: str | None


# ----------------------------------------------------------------- meta

@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
async def readyz() -> JSONResponse:
    """Ready only when storage is actually writable — not merely when the process is up."""
    try:
        probe = storage.staging / ".readyz"
        probe.write_text(utc_now(), encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        return JSONResponse(status_code=503, content={"status": "not-ready", "error": str(exc)})
    return JSONResponse({"status": "ready"})


@router.get("/v1/meta")
async def meta() -> dict[str, Any]:
    return {
        **settings.describe(),
        "storage": storage.stats(),
        "jobs": job_queue.stats(),
        "capabilities": {
            "resumable_upload": True,
            "idempotent_ingest": True,
            "immutable_raw": True,
            "c2pa_signing": c2pa_available(),
            "trusted_timestamp": bool(settings.tsa_url),
            "photo_survey_export": True,
        },
        "limits": [
            "C2PA proves pipeline integrity, not scene authenticity.",
            "Photographs never grant source-confidence grade A.",
            "Measured accuracy only; represented accuracy is not implied.",
        ],
    }


# ----------------------------------------------------------------- captures

@router.post("/v1/captures", status_code=201, dependencies=[Depends(require_token)])
async def create_capture(payload: CaptureInit) -> dict[str, Any]:
    """
    Open (or resume) an upload session.

    Idempotent: posting the same capture_id twice returns the existing record and
    the byte offset to resume from, rather than starting a second copy.
    """
    if payload.bytes_total > settings.max_capture_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Capture exceeds MAX_CAPTURE_BYTES ({settings.max_capture_bytes}).",
        )

    capture_id = payload.capture_id or uuid.uuid4().hex
    existing = storage.get_record(capture_id)

    if existing:
        if existing.get("state") == "ingested":
            return {
                "capture_id": capture_id,
                "state": "ingested",
                "resume_offset": existing.get("bytes_total", 0),
                "already_complete": True,
            }
        return {
            "capture_id": capture_id,
            "state": existing.get("state", "uploading"),
            "resume_offset": storage.staged_size(capture_id),
            "already_complete": False,
        }

    record = {
        "capture_id": capture_id,
        "state": "uploading",
        "created_at": utc_now(),
        "capture": {
            "filename": payload.filename,
            "content_type": payload.content_type,
        },
        "bytes_total": payload.bytes_total,
        "client_sha256": payload.sha256,
        "sidecar": payload.sidecar,
        "license": payload.license or settings.default_license,
        "license_url": payload.license_url or settings.default_license_url,
        "usage": payload.usage or "derive_appearance",
        "review_status": "submitted",
    }
    storage.put_record(capture_id, record)
    return {
        "capture_id": capture_id,
        "state": "uploading",
        "resume_offset": 0,
        "already_complete": False,
    }


@router.put("/v1/captures/{capture_id}/blob", dependencies=[Depends(require_token)])
async def upload_chunk(
    capture_id: str,
    request: Request,
    content_range: str | None = Header(default=None, alias="Content-Range"),
) -> dict[str, Any]:
    """
    Append a chunk. `Content-Range: bytes <start>-<end>/<total>` gives the offset;
    without it the chunk is appended at the current end.
    """
    record = storage.get_record(capture_id)
    if not record:
        raise HTTPException(status_code=404, detail="Unknown capture_id. POST /v1/captures first.")
    if record.get("state") == "ingested":
        return {"capture_id": capture_id, "state": "ingested", "received": record.get("bytes_total", 0)}

    body = await request.body()
    if len(body) > settings.max_body_bytes:
        raise HTTPException(status_code=413, detail="Chunk exceeds MAX_BODY_BYTES.")

    offset = storage.staged_size(capture_id)
    if content_range:
        try:
            span = content_range.split(" ", 1)[1].split("/", 1)[0]
            offset = int(span.split("-", 1)[0])
        except (IndexError, ValueError):
            raise HTTPException(status_code=400, detail="Malformed Content-Range header.")

    try:
        received = storage.append_chunk(capture_id, offset, body)
    except StorageError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {
        "capture_id": capture_id,
        "received": received,
        "expected": record.get("bytes_total"),
        "complete": received >= int(record.get("bytes_total") or 0),
    }


@router.post(
    "/v1/captures/{capture_id}/complete",
    response_model=CaptureCompleteResult,
    dependencies=[Depends(require_token)],
)
async def complete_capture(capture_id: str) -> CaptureCompleteResult:
    """
    Finalise a capture: verify the digest, commit the raw object immutably,
    obtain a trusted timestamp, sign, and queue post-processing.
    """
    record = storage.get_record(capture_id)
    if not record:
        raise HTTPException(status_code=404, detail="Unknown capture_id.")

    if record.get("state") == "ingested":
        # Idempotent: a retried completion returns the original outcome.
        return CaptureCompleteResult(
            capture_id=capture_id,
            state="ingested",
            integrity=record.get("integrity", {}),
            timestamp=record.get("timestamp", {}),
            signing=record.get("signing", {}),
            job_id=record.get("job_id"),
        )

    staged = storage.staged_size(capture_id)
    expected = int(record.get("bytes_total") or 0)
    if staged != expected:
        raise HTTPException(
            status_code=409,
            detail=f"Incomplete upload: have {staged} bytes, expected {expected}.",
        )

    try:
        raw_path = storage.commit_raw(capture_id)
    except ImmutabilityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with open(raw_path, "rb") as handle:
        digest = sha256_file(handle)

    integrity = verify_integrity(digest, record.get("client_sha256"))
    if not integrity["verified"] and record.get("client_sha256"):
        # Bytes changed in transit. Keep the object for forensics, refuse to ingest.
        record["state"] = "rejected"
        record["integrity"] = integrity
        storage.put_record(capture_id, record)
        raise HTTPException(status_code=422, detail="Digest mismatch; capture rejected.")

    stamp = trusted_timestamp(digest)
    record["integrity"] = integrity
    record["timestamp"] = stamp

    manifest = build_c2pa_manifest(record)
    signed_path = storage.derived / capture_id[:2] / capture_id / "signed.jpg"
    signed_path.parent.mkdir(parents=True, exist_ok=True)
    signing = sign_c2pa(raw_path, manifest, signed_path)

    record["signing"] = signing
    record["c2pa_manifest"] = manifest
    record["state"] = "ingested"
    record["ingested_at"] = utc_now()
    record.setdefault("chain_of_custody", []).extend(
        [
            {"at": utc_now(), "event": "raw_committed", "detail": str(raw_path.name)},
            {"at": utc_now(), "event": "integrity_verified", "detail": integrity["reason"]},
            {"at": utc_now(), "event": "timestamped", "detail": stamp.get("note", "")},
            {
                "at": utc_now(),
                "event": "signed" if signing.get("signed") else "signing_skipped",
                "detail": signing.get("assurance", "unsigned"),
            },
        ]
    )

    job = job_queue.enqueue(capture_id, "post_process")
    record["job_id"] = job["job_id"]
    storage.put_record(capture_id, record)

    return CaptureCompleteResult(
        capture_id=capture_id,
        state="ingested",
        integrity=integrity,
        timestamp=stamp,
        signing=signing,
        job_id=job["job_id"],
    )


@router.get("/v1/captures/{capture_id}")
async def get_capture(capture_id: str) -> dict[str, Any]:
    record = storage.get_record(capture_id)
    if not record:
        raise HTTPException(status_code=404, detail="Unknown capture_id.")
    return record


@router.get("/v1/captures")
async def list_captures(limit: int = 100, state: str | None = None) -> dict[str, Any]:
    items = []
    for record in storage.iter_records():
        if state and record.get("state") != state:
            continue
        items.append(
            {
                "capture_id": record.get("capture_id"),
                "state": record.get("state"),
                "created_at": record.get("created_at"),
                "bytes_total": record.get("bytes_total"),
                "signed": bool((record.get("signing") or {}).get("signed")),
            }
        )
        if len(items) >= limit:
            break
    return {"count": len(items), "captures": items}


@router.get("/v1/captures/{capture_id}/raw")
async def get_raw(capture_id: str) -> FileResponse:
    if not storage.raw_exists(capture_id):
        raise HTTPException(status_code=404, detail="No raw object for this capture.")
    record = storage.get_record(capture_id) or {}
    return FileResponse(
        storage.raw_path(capture_id),
        media_type=(record.get("capture") or {}).get("content_type", "application/octet-stream"),
        filename=(record.get("capture") or {}).get("filename") or f"{capture_id}.bin",
    )


# ----------------------------------------------------------------- jobs

@router.get("/v1/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = job_queue.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job_id.")
    return job


@router.get("/v1/jobs")
async def list_jobs(limit: int = 50) -> dict[str, Any]:
    return {"jobs": job_queue.list(limit)}


# ------------------------------------------------------- contract export

@router.get("/v1/exports/photo-survey")
async def export_photo_survey(campaign: str | None = None) -> dict[str, Any]:
    """
    Emit a digital-3d `photo-survey` document for the ingested corpus.

    This is the integration point with the CoLab twin stack: bridge and district
    modules consume this directly, with no Plumb-specific adapter.
    """
    records = [r for r in storage.iter_records() if r.get("state") == "ingested"]
    return build_photo_survey(records, campaign_id=campaign)


@router.get("/v1/exports/photo-survey/validate")
async def validate_photo_survey(campaign: str | None = None) -> dict[str, Any]:
    records = [r for r in storage.iter_records() if r.get("state") == "ingested"]
    document = build_photo_survey(records, campaign_id=campaign)
    return validate_document(document)
