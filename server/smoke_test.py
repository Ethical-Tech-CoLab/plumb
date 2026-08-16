"""
Live smoke test against a running Plumb backend.

    python smoke_test.py http://127.0.0.1:8099

Exercises the path a field client actually takes, including a resumed upload,
and prints the digital-3d contract document that results.
"""

from __future__ import annotations

import hashlib
import json
import sys
import uuid

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8099"

IMAGE = b"\xff\xd8\xff\xe0" + (b"plumb-live-capture-bytes" * 400) + b"\xff\xd9"
DIGEST = hashlib.sha256(IMAGE).hexdigest()
CAPTURE_ID = uuid.uuid4().hex

SIDECAR = {
    "original": {"width_px": 4080, "height_px": 3072},
    "who": {"operator_name": "field-test", "credential_level": "trained"},
    "when": {"device_clock": "2026-08-16T14:22:05Z"},
    "where": {
        "position": {"latitude": 40.7033, "longitude": -73.9881, "accuracy_m": 9.0},
        "orientation": {"compass_heading": 212.0},
        "subject_identifier": "urn:d3d:dumbo:building:55-water-st",
    },
    "calibration": {
        "tier": "CAL-3",
        "status": "VERIFIED",
        "rms_residual_mm": 0.8,
        "homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    },
    "measurements": [
        {"label": "window head", "value_mm": 1220.4, "expanded_mm_95pct": 4.1}
    ],
    "capture_attestation": {"present": False, "reason": "PWA client"},
}


def main() -> int:
    ok = True
    with httpx.Client(base_url=BASE, timeout=30.0) as client:
        meta = client.get("/v1/meta").json()
        print(f"meta       : {meta['service']} v{meta['version']} storage={meta['storage_backend']}")
        print(f"             c2pa={meta['capabilities']['c2pa_signing']} tsa={meta['capabilities']['trusted_timestamp']}")

        init = client.post("/v1/captures", json={
            "capture_id": CAPTURE_ID,
            "filename": "facade.jpg",
            "bytes_total": len(IMAGE),
            "sha256": DIGEST,
            "sidecar": SIDECAR,
        }).json()
        print(f"init       : state={init['state']} resume_offset={init['resume_offset']}")

        # Upload in two chunks, simulating an interrupted transfer.
        half = len(IMAGE) // 2
        first = client.put(f"/v1/captures/{CAPTURE_ID}/blob", content=IMAGE[:half]).json()
        print(f"chunk 1/2  : received={first['received']}/{first['expected']}")

        resumed = client.post("/v1/captures", json={
            "capture_id": CAPTURE_ID, "bytes_total": len(IMAGE), "sha256": DIGEST,
        }).json()
        print(f"resume     : offset={resumed['resume_offset']} (expected {half})")
        ok &= resumed["resume_offset"] == half

        second = client.put(
            f"/v1/captures/{CAPTURE_ID}/blob",
            content=IMAGE[half:],
            headers={"Content-Range": f"bytes {half}-{len(IMAGE) - 1}/{len(IMAGE)}"},
        ).json()
        print(f"chunk 2/2  : received={second['received']} complete={second['complete']}")

        done = client.post(f"/v1/captures/{CAPTURE_ID}/complete").json()
        print(f"complete   : state={done['state']} integrity={done['integrity']['verified']}")
        print(f"             signing={done['signing']['assurance']} timestamp_trusted={done['timestamp']['trusted']}")
        ok &= done["state"] == "ingested" and done["integrity"]["verified"]

        raw = client.get(f"/v1/captures/{CAPTURE_ID}/raw")
        byte_perfect = raw.content == IMAGE
        print(f"raw        : {len(raw.content)} bytes, byte-identical={byte_perfect}")
        ok &= byte_perfect

        job = client.get(f"/v1/jobs/{done['job_id']}").json()
        pending = sum(1 for s in job["stages"] if s["state"] == "pending")
        todo = sum(1 for s in job["stages"] if s["state"] == "not_implemented")
        print(f"job        : {job['state']} pipeline={job['pipeline_version']} pending={pending} not_implemented={todo}")

        doc = client.get("/v1/exports/photo-survey").json()
        verdict = client.get("/v1/exports/photo-survey/validate").json()
        print(f"contract   : v{doc['contract_version']} module={doc['module_id']} frame={doc['frame_id']}")
        print(f"             observations={len(doc['observations'])} valid={verdict['valid']} errors={verdict['errors']}")
        ok &= verdict["valid"]

        obs = doc["observations"][0]
        print("\n--- photo-survey observation ---")
        print(json.dumps(obs, indent=2)[:1400])

    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
