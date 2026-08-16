"""
Job queue — asynchronous post-processing.

Capture is not a real-time measurement requirement, which is what lets the
expensive work happen here instead of on a phone. This is an in-process queue
with a file-backed record so a restart does not lose the fact that work is
outstanding. Swapping it for a real broker (Azure Service Bus, Redis, Celery)
means replacing this one module.

Pipeline stages are versioned and recorded on every job, because a measurement
without the version of the code that produced it is not reproducible.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import settings

PIPELINE_VERSION = f"metrology-worker/{settings.version}"

# The full pipeline, from docs/05-server-and-provenance.md. Stages marked
# implemented=False are declared so the API can report honestly what it does
# and does not yet do, rather than silently returning nothing.
PIPELINE_STAGES: list[dict[str, Any]] = [
    {"stage": "ingest_verify", "implemented": True,
     "description": "Digest verification, timestamp, immutable commit."},
    {"stage": "fiducial_detect", "implemented": False,
     "description": "Sub-pixel ArUco/AprilTag detection with RANSAC across the session."},
    {"stage": "lens_undistort", "implemented": False,
     "description": "Apply device lens profile; refused unless optics were locked."},
    {"stage": "orientation_solve", "implemented": False,
     "description": "Planar homography or scale-bar-constrained bundle adjustment."},
    {"stage": "rectify", "implemented": False,
     "description": "Fronto-parallel orthophoto at a stated GSD."},
    {"stage": "measure", "implemented": False,
     "description": "Re-solve measurements with Monte-Carlo uncertainty."},
    {"stage": "corroborate", "implemented": False,
     "description": "Cross-observation agreement across contributors and dates."},
    {"stage": "publish_contract", "implemented": True,
     "description": "Emit a digital-3d photo-survey document."},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobQueue:
    """Minimal durable-ish queue. Thread-safe; single process."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or settings.storage_root()) / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def _write(self, job: dict[str, Any]) -> None:
        path = self._path(job["job_id"])
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(job, indent=2), encoding="utf-8")
        tmp.replace(path)

    def enqueue(self, capture_id: str, kind: str = "post_process") -> dict[str, Any]:
        job = {
            "job_id": uuid.uuid4().hex,
            "capture_id": capture_id,
            "kind": kind,
            "state": "queued",
            "pipeline_version": PIPELINE_VERSION,
            "created_at": _now(),
            "stages": [
                {
                    "stage": s["stage"],
                    "state": "pending" if s["implemented"] else "not_implemented",
                    "description": s["description"],
                }
                for s in PIPELINE_STAGES
            ],
            "note": (
                "Post-processing runs asynchronously. Field measurements remain "
                "PROVISIONAL until this job publishes authoritative values."
            ),
        }
        with self._lock:
            self._write(job)
        return job

    def get(self, job_id: str) -> dict[str, Any] | None:
        path = self._path(job_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        jobs = []
        for path in sorted(self.root.glob("*.json"), reverse=True)[:limit]:
            try:
                jobs.append(json.loads(path.read_text(encoding="utf-8")))
            except json.JSONDecodeError:
                continue
        return jobs

    def mark(self, job_id: str, state: str, detail: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            job = self.get(job_id)
            if not job:
                return None
            job["state"] = state
            job["updated_at"] = _now()
            if detail:
                job.setdefault("events", []).append({"at": _now(), "detail": detail})
            self._write(job)
            return job

    def stats(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for path in self.root.glob("*.json"):
            try:
                state = json.loads(path.read_text(encoding="utf-8")).get("state", "unknown")
            except json.JSONDecodeError:
                state = "unreadable"
            counts[state] = counts.get(state, 0) + 1
        return {
            "pipeline_version": PIPELINE_VERSION,
            "by_state": counts,
            "stages_implemented": sum(1 for s in PIPELINE_STAGES if s["implemented"]),
            "stages_total": len(PIPELINE_STAGES),
        }


job_queue = JobQueue()
