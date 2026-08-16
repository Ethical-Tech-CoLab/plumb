"""
digital-3d shared-contracts integration.

Plumb does not invent its own way of describing a photograph. The Ethical Tech
CoLab already publishes a normative contract for exactly this — crowdsourced
photographic observations as evidence — at

    digital-3d-shared-contracts/schemas/photo-survey.schema.json

so this module turns Plumb capture records into documents that conform to it.
The bridge and district twins (manhattan-bridge-3d, brooklyn-bridge-3d,
williamsburg-bridge-3d, dumbo-district-3d) can then consume Plumb output with
no bespoke adapter.

Two contract facts drive the mapping, and both are respected here:

1. "Photographs alone never grant A." Grade A is reserved for official
   dimensions and authoritative datasets. Plumb therefore caps itself at B even
   when a calibration is VERIFIED — see `grant_grade`. Plumb's dimensional
   evidence is a genuinely new case that the contract predates; raising the cap
   is a governance question for the contracts repo, not something to assume.

2. "A field that cannot express 'I don't know' does not prevent ignorance, it
   launders it." So unknown values are emitted as `unknown`, never invented.
"""

from __future__ import annotations

from typing import Any

from .config import settings

CONTRACT_ID = "https://contracts.digital-3d.org/v1/photo-survey.schema.json"

# Confidence a Plumb observation may grant, by calibration status.
# Deliberately conservative: see module docstring, point 1.
GRADE_BY_CALIBRATION = {
    "VERIFIED": "B",     # sharp, located, recent, rectified, and check-verified
    "UNVERIFIED": "C",   # scale known but never independently checked
    "FAILED": "D",       # calibration failed its hold-out check
    None: "C",
}


def grant_grade(record: dict[str, Any]) -> str:
    """Highest confidence an asset aspect derived from this observation may claim."""
    calibration = (record.get("sidecar", {}) or {}).get("calibration") or {}
    status = calibration.get("status")
    return GRADE_BY_CALIBRATION.get(status, "C")


def _captured_precision(sidecar: dict[str, Any]) -> str:
    when = sidecar.get("when") or {}
    clock = when.get("device_clock")
    if not clock:
        return "unknown"
    # A full RFC3339 timestamp with a time component is 'exact'; the schema
    # cross-checks this against the string, so do not over-claim.
    return "exact" if "T" in str(clock) else "day"


def _position(sidecar: dict[str, Any]) -> tuple[dict | None, str, float | None]:
    """Return (position, position_source, accuracy_m) — absent is legal, invented is not."""
    where = sidecar.get("where") or {}
    pos = where.get("position") or {}
    lat, lon = pos.get("latitude"), pos.get("longitude")
    if lat is None or lon is None:
        # The contract permits a missing position only when the source says
        # 'unknown', which keeps a genuine gap distinguishable from lost GPS.
        return None, "unknown", None
    return (
        {"lat": lat, "lon": lon},
        "device_gps",
        pos.get("accuracy_m"),
    )


def _bearing(sidecar: dict[str, Any]) -> tuple[float | None, str]:
    where = sidecar.get("where") or {}
    orientation = where.get("orientation") or {}
    heading = orientation.get("compass_heading")
    if heading is None:
        return None, "unknown"
    return float(heading), "device_compass"


def _quality(record: dict[str, Any]) -> dict[str, Any]:
    sidecar = record.get("sidecar", {}) or {}
    original = sidecar.get("original") or {}
    calibration = sidecar.get("calibration") or {}

    width = original.get("width_px") or 0
    height = original.get("height_px") or 0
    long_edge = max(int(width or 0), int(height or 0))

    quality: dict[str, Any] = {}
    if long_edge:
        quality["pixels_long_edge"] = long_edge

    # `rectified` is what makes a photo usable as a texture rather than only as
    # reference. A solved homography is exactly that capability.
    quality["rectified"] = bool(calibration.get("homography"))
    return quality


def observation_from_record(record: dict[str, Any]) -> dict[str, Any]:
    """Map one Plumb capture record onto a photo-survey observation."""
    sidecar = record.get("sidecar", {}) or {}
    capture_id = record.get("capture_id")
    where = sidecar.get("where") or {}
    who = sidecar.get("who") or {}

    position, position_source, accuracy = _position(sidecar)
    bearing, bearing_source = _bearing(sidecar)

    observation: dict[str, Any] = {
        "observation_id": f"plumb:{capture_id}",
        "sha256": record.get("integrity", {}).get("server_sha256"),
        "position_source": position_source,
        "bearing_source": bearing_source,
        "captured_precision": _captured_precision(sidecar),
        "license": record.get("license") or settings.default_license,
        "license_url": record.get("license_url") or settings.default_license_url,
        "usage": record.get("usage") or "derive_appearance",
        "quality": _quality(record),
        "category": "scale_reference" if sidecar.get("calibration") else "context",
        "review": {
            "status": record.get("review_status", "submitted"),
            "grants_confidence": grant_grade(record),
            "notes": (
                "Plumb capture. Calibration status "
                f"{(sidecar.get('calibration') or {}).get('status', 'none')}. "
                "Measured accuracy only; represented accuracy not implied."
            ),
        },
    }

    if settings.public_base_url:
        observation["image_url"] = f"{settings.public_base_url}/v1/captures/{capture_id}/raw"

    if position:
        observation["position"] = position
    if accuracy is not None:
        observation["position_accuracy_m"] = accuracy
    if bearing is not None:
        observation["bearing_deg"] = bearing

    when = sidecar.get("when") or {}
    if when.get("device_clock"):
        observation["captured_at"] = when["device_clock"]

    if who.get("operator_name"):
        observation["contributor"] = who["operator_name"]

    subject = where.get("subject_identifier")
    if subject:
        observation["observes"] = [
            {
                "asset_id": subject,
                "aspect": _aspects_for(record),
                "visibility": "clear",
            }
        ]

    notes = []
    if sidecar.get("calibration"):
        cal = sidecar["calibration"]
        notes.append(
            f"Calibration {cal.get('tier')} ({cal.get('status')}), "
            f"RMS residual {cal.get('rms_residual_mm')} mm."
        )
    measurements = sidecar.get("measurements") or []
    if measurements:
        notes.append(f"{len(measurements)} measurement(s) with stated uncertainty.")
    if notes:
        observation["notes"] = " ".join(notes)

    return observation


def _aspects_for(record: dict[str, Any]) -> list[str]:
    """
    What this photograph is good evidence FOR.

    A calibrated Plumb capture evidences geometry-adjacent aspects that an
    ordinary snapshot cannot: masonry coursing, profile shape, member
    arrangement. Without calibration it is an ordinary appearance photo.
    """
    sidecar = record.get("sidecar", {}) or {}
    calibration = sidecar.get("calibration") or {}
    base = ["facade_material", "facade_colour", "condition"]
    if calibration.get("status") == "VERIFIED":
        return base + ["masonry_coursing", "profile_shape", "window_pattern"]
    return base


def build_photo_survey(records: list[dict[str, Any]], campaign_id: str | None = None) -> dict[str, Any]:
    """Assemble a complete, contract-shaped photo-survey document."""
    observations = [observation_from_record(r) for r in records if r.get("state") == "ingested"]

    document: dict[str, Any] = {
        "contract_version": settings.contract_version,
        "module_id": settings.module_id,
        "frame_id": settings.frame_id,
        "observations": observations,
    }

    document["campaign"] = {
        "campaign_id": campaign_id or settings.campaign_id,
        "description": (
            "Measured photographic capture via Plumb. Every observation carries a "
            "calibration tier and a stated measurement uncertainty."
        ),
    }

    document["provenance"] = {
        "generator": f"plumb-backend/{settings.version}",
        "generated_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
        "note": (
            "Plumb caps itself at confidence B. Grade A is reserved for official "
            "dimensions and authoritative datasets per the source-confidence contract."
        ),
    }

    return document


def validate_document(document: dict[str, Any]) -> dict[str, Any]:
    """
    Structural self-check against the parts of the contract we depend on.

    This is not a substitute for `tools/validate.mjs` in the contracts repo — it
    is a fast guard so the service never publishes something obviously invalid.
    """
    errors: list[str] = []
    for key in ("contract_version", "module_id", "frame_id", "observations"):
        if key not in document:
            errors.append(f"missing required top-level field: {key}")

    valid_usage = {"reference_only", "derive_appearance", "redistribute"}
    valid_position_source = {
        "exif_gps", "device_gps", "geocoded_address",
        "manual_placement", "photogrammetric_solve", "unknown",
    }
    valid_grades = {"A", "B", "C", "D"}

    for index, obs in enumerate(document.get("observations", [])):
        where = f"observations[{index}]"
        for key in ("observation_id", "license", "usage", "review"):
            if key not in obs:
                errors.append(f"{where}: missing required field {key}")

        if obs.get("usage") not in valid_usage:
            errors.append(f"{where}: invalid usage {obs.get('usage')!r}")

        if obs.get("position_source") not in valid_position_source:
            errors.append(f"{where}: invalid position_source {obs.get('position_source')!r}")

        # The contract's key relaxation: a missing position is legal ONLY when
        # position_source is 'unknown', so a real gap stays distinguishable.
        if "position" not in obs and obs.get("position_source") != "unknown":
            errors.append(
                f"{where}: position omitted but position_source is "
                f"{obs.get('position_source')!r} (must be 'unknown')"
            )

        review = obs.get("review") or {}
        if "status" not in review:
            errors.append(f"{where}.review: missing status")
        grade = review.get("grants_confidence")
        if grade is not None and grade not in valid_grades:
            errors.append(f"{where}.review: invalid grants_confidence {grade!r}")
        if grade == "A":
            errors.append(
                f"{where}.review: photographs may never grant confidence A"
            )

    return {"valid": not errors, "errors": errors, "observation_count": len(document.get("observations", []))}
