"""
Backend tests.

Focus is on the properties that actually matter for evidence handling:
idempotency, immutability, digest verification, honest reporting, and
conformance to the digital-3d photo-survey contract.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
from pathlib import Path

import pytest

# Point storage at a scratch dir before importing the app.
_TMP = tempfile.mkdtemp(prefix="plumb-test-")
os.environ["PLUMB_DATA_DIR"] = _TMP
os.environ["PLUMB_PUBLIC_BASE_URL"] = "https://plumb.example.org"

from fastapi.testclient import TestClient  # noqa: E402

from plumb.contracts import build_photo_survey, grant_grade, validate_document  # noqa: E402
from plumb.main import app  # noqa: E402

client = TestClient(app)

IMAGE = b"\xff\xd8\xff\xe0" + b"plumb-test-image-bytes" * 64 + b"\xff\xd9"
DIGEST = hashlib.sha256(IMAGE).hexdigest()


def _sidecar(**overrides):
    base = {
        "original": {"width_px": 4080, "height_px": 3072},
        "who": {"operator_name": "test-operator", "credential_level": "trained"},
        "when": {"device_clock": "2026-08-16T14:03:11Z"},
        "where": {
            "position": {"latitude": 40.7033, "longitude": -73.9881, "accuracy_m": 12.0},
            "orientation": {"compass_heading": 214.5},
            "subject_identifier": "urn:d3d:dumbo:building:55-water-st",
        },
        "calibration": {
            "tier": "CAL-3",
            "status": "VERIFIED",
            "rms_residual_mm": 0.8,
            "homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        },
        "measurements": [{"label": "window head", "value_mm": 1220.4, "expanded_mm_95pct": 4.1}],
    }
    base.update(overrides)
    return base


def _ingest(capture_id=None, data=IMAGE, digest=DIGEST, sidecar=None):
    capture_id = capture_id or uuid.uuid4().hex
    init = client.post(
        "/v1/captures",
        json={
            "capture_id": capture_id,
            "filename": "facade.jpg",
            "bytes_total": len(data),
            "sha256": digest,
            "sidecar": sidecar if sidecar is not None else _sidecar(),
        },
    )
    assert init.status_code == 201, init.text
    put = client.put(f"/v1/captures/{capture_id}/blob", content=data)
    assert put.status_code == 200, put.text
    done = client.post(f"/v1/captures/{capture_id}/complete")
    return capture_id, init.json(), put.json(), done


# ------------------------------------------------------------- basics

def test_health_and_ready():
    assert client.get("/healthz").json()["status"] == "ok"
    assert client.get("/readyz").status_code == 200


def test_meta_reports_capabilities_and_limits_honestly():
    meta = client.get("/v1/meta").json()
    assert meta["service"] == "plumb-backend"
    assert meta["capabilities"]["idempotent_ingest"] is True
    assert meta["capabilities"]["immutable_raw"] is True
    # No signer configured in tests, so it must report False rather than implying signing.
    assert meta["capabilities"]["c2pa_signing"] is False
    assert meta["c2pa_signing_configured"] is False
    assert any("not scene authenticity" in limit for limit in meta["limits"])


# ------------------------------------------------------------- ingest

def test_full_ingest_round_trip():
    capture_id, _, put, done = _ingest()
    assert put["complete"] is True
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["state"] == "ingested"
    assert body["integrity"]["verified"] is True
    assert body["integrity"]["server_sha256"] == DIGEST
    assert body["job_id"]

    # Unsigned must be reported as unsigned, never omitted.
    assert body["signing"]["signed"] is False
    assert body["signing"]["assurance"] == "unsigned"

    # Untrusted timestamp must be labelled as such.
    assert body["timestamp"]["trusted"] is False

    raw = client.get(f"/v1/captures/{capture_id}/raw")
    assert raw.status_code == 200
    assert raw.content == IMAGE


def test_ingest_is_idempotent_on_capture_id():
    capture_id = uuid.uuid4().hex
    _ingest(capture_id=capture_id)

    # Re-opening the same capture reports it is already complete.
    again = client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": DIGEST},
    )
    assert again.status_code == 201
    assert again.json()["already_complete"] is True

    # Completing twice returns the same outcome, not an error and not a duplicate.
    first = client.get(f"/v1/captures/{capture_id}").json()
    second = client.post(f"/v1/captures/{capture_id}/complete").json()
    assert second["state"] == "ingested"
    assert second["job_id"] == first["job_id"]


def test_resumable_upload_reports_offset():
    capture_id = uuid.uuid4().hex
    client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": DIGEST},
    )
    half = len(IMAGE) // 2
    client.put(f"/v1/captures/{capture_id}/blob", content=IMAGE[:half])

    resumed = client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": DIGEST},
    ).json()
    assert resumed["resume_offset"] == half
    assert resumed["already_complete"] is False

    client.put(
        f"/v1/captures/{capture_id}/blob",
        content=IMAGE[half:],
        headers={"Content-Range": f"bytes {half}-{len(IMAGE) - 1}/{len(IMAGE)}"},
    )
    assert client.post(f"/v1/captures/{capture_id}/complete").json()["state"] == "ingested"


def test_retried_chunk_at_old_offset_is_accepted_without_duplicating():
    capture_id = uuid.uuid4().hex
    client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": DIGEST},
    )
    half = len(IMAGE) // 2
    client.put(f"/v1/captures/{capture_id}/blob", content=IMAGE[:half])
    # Client didn't hear the ack and resends the same chunk.
    again = client.put(
        f"/v1/captures/{capture_id}/blob",
        content=IMAGE[:half],
        headers={"Content-Range": f"bytes 0-{half - 1}/{len(IMAGE)}"},
    )
    assert again.json()["received"] == half  # not doubled


def test_digest_mismatch_is_rejected():
    capture_id = uuid.uuid4().hex
    wrong = hashlib.sha256(b"different bytes entirely").hexdigest()
    client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": wrong},
    )
    client.put(f"/v1/captures/{capture_id}/blob", content=IMAGE)
    result = client.post(f"/v1/captures/{capture_id}/complete")
    assert result.status_code == 422
    assert client.get(f"/v1/captures/{capture_id}").json()["state"] == "rejected"


def test_incomplete_upload_cannot_complete():
    capture_id = uuid.uuid4().hex
    client.post(
        "/v1/captures",
        json={"capture_id": capture_id, "bytes_total": len(IMAGE), "sha256": DIGEST},
    )
    client.put(f"/v1/captures/{capture_id}/blob", content=IMAGE[:10])
    assert client.post(f"/v1/captures/{capture_id}/complete").status_code == 409


def test_oversized_capture_refused():
    resp = client.post(
        "/v1/captures",
        json={"bytes_total": 999_999_999_999, "sha256": DIGEST},
    )
    assert resp.status_code == 413


def test_chain_of_custody_is_recorded():
    capture_id, *_ = _ingest()
    record = client.get(f"/v1/captures/{capture_id}").json()
    events = [e["event"] for e in record["chain_of_custody"]]
    assert "raw_committed" in events
    assert "integrity_verified" in events
    assert "timestamped" in events


# ------------------------------------------------------------- jobs

def test_post_processing_job_declares_unimplemented_stages():
    _, _, _, done = _ingest()
    job = client.get(f"/v1/jobs/{done.json()['job_id']}").json()
    assert job["state"] == "queued"
    assert job["pipeline_version"].startswith("metrology-worker/")
    states = {s["stage"]: s["state"] for s in job["stages"]}
    # Honest about what is not built yet.
    assert states["fiducial_detect"] == "not_implemented"
    assert states["ingest_verify"] == "pending"


# ------------------------------------------ digital-3d contract export

def test_photo_survey_export_is_contract_shaped_and_valid():
    _ingest()
    doc = client.get("/v1/exports/photo-survey").json()

    assert doc["contract_version"] == "1"
    assert doc["module_id"] == "plumb-photo-survey"
    assert doc["frame_id"] == "nyc-harbor-enu"
    assert doc["observations"]

    verdict = client.get("/v1/exports/photo-survey/validate").json()
    assert verdict["valid"] is True, verdict["errors"]

    obs = doc["observations"][0]
    assert obs["license"] == "CC-BY-4.0"
    assert obs["usage"] == "derive_appearance"
    assert obs["position_source"] == "device_gps"
    assert obs["bearing_source"] == "device_compass"
    assert obs["category"] == "scale_reference"
    assert obs["quality"]["rectified"] is True
    assert obs["quality"]["pixels_long_edge"] == 4080
    assert obs["review"]["grants_confidence"] == "B"


def test_photographs_never_grant_grade_a():
    """The contract's hard rule. A verified Plumb capture still caps at B."""
    assert grant_grade({"sidecar": {"calibration": {"status": "VERIFIED"}}}) == "B"
    assert grant_grade({"sidecar": {"calibration": {"status": "UNVERIFIED"}}}) == "C"
    assert grant_grade({"sidecar": {"calibration": {"status": "FAILED"}}}) == "D"
    assert grant_grade({}) == "C"

    bad = {
        "contract_version": "1", "module_id": "m", "frame_id": "f",
        "observations": [{
            "observation_id": "x", "license": "CC-BY-4.0", "usage": "derive_appearance",
            "position_source": "unknown",
            "review": {"status": "accepted", "grants_confidence": "A"},
        }],
    }
    verdict = validate_document(bad)
    assert verdict["valid"] is False
    assert any("never grant confidence A" in e for e in verdict["errors"])


def test_missing_position_must_declare_unknown_source():
    """
    The contract's key relaxation: a photo may lack a position, but only when
    position_source says 'unknown', so a real gap stays distinguishable from
    a survey that quietly lost its GPS.
    """
    record = {
        "capture_id": "abc", "state": "ingested",
        "integrity": {"server_sha256": DIGEST},
        "sidecar": _sidecar(where={"subject_identifier": "urn:d3d:x"}),
    }
    doc = build_photo_survey([record])
    obs = doc["observations"][0]
    assert "position" not in obs
    assert obs["position_source"] == "unknown"
    assert validate_document(doc)["valid"] is True

    # Claiming a source while omitting the position must be refused.
    obs["position_source"] = "device_gps"
    verdict = validate_document(doc)
    assert verdict["valid"] is False
    assert any("must be 'unknown'" in e for e in verdict["errors"])


def test_uncalibrated_capture_claims_fewer_aspects():
    calibrated = {
        "capture_id": "a", "state": "ingested", "integrity": {"server_sha256": DIGEST},
        "sidecar": _sidecar(),
    }
    plain = {
        "capture_id": "b", "state": "ingested", "integrity": {"server_sha256": DIGEST},
        "sidecar": _sidecar(calibration=None),
    }
    doc = build_photo_survey([calibrated, plain])
    by_id = {o["observation_id"]: o for o in doc["observations"]}

    assert "masonry_coursing" in by_id["plumb:a"]["observes"][0]["aspect"]
    assert "masonry_coursing" not in by_id["plumb:b"]["observes"][0]["aspect"]
    assert by_id["plumb:b"]["category"] == "context"
    assert by_id["plumb:b"]["quality"]["rectified"] is False
