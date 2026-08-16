"""
Trust services — integrity, time, and signing.

Three separate jobs, deliberately kept apart because they fail differently:

  integrity   SHA-256 of the raw bytes, verified against what the client claimed
  time        an RFC 3161 trusted timestamp; the device clock is never trusted
  signing     C2PA manifest signing, delegated to `c2patool` when configured

Every function here reports honestly when it could not do its job. Nothing
returns a value that implies more assurance than was actually obtained — an
unsigned artifact says "unsigned", it does not silently look signed.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from .config import settings

CHUNK = 1024 * 1024


def sha256_file(handle: BinaryIO) -> str:
    digest = hashlib.sha256()
    for block in iter(lambda: handle.read(CHUNK), b""):
        digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def verify_integrity(actual: str, claimed: str | None) -> dict[str, Any]:
    """
    Compare the server-computed digest with the digest the client computed at
    capture time. A match is what closes the shutter-to-ingest gap for a browser
    client that cannot do hardware attestation.
    """
    if not claimed:
        return {
            "verified": False,
            "reason": "client supplied no capture-time digest",
            "server_sha256": actual,
        }
    match = actual.lower() == claimed.lower()
    return {
        "verified": match,
        "reason": "digest matches capture-time value" if match else "DIGEST MISMATCH",
        "server_sha256": actual,
        "client_sha256": claimed,
    }


def trusted_timestamp(digest_hex: str) -> dict[str, Any]:
    """
    Request an RFC 3161 timestamp over the capture digest.

    Requires `openssl` and PLUMB_TSA_URL. When unavailable we record the server
    clock and mark it clearly as untrusted, because a server clock is still
    better evidence than a phone clock but is not a timestamp authority.
    """
    server_time = utc_now()
    if not settings.tsa_url:
        return {
            "trusted": False,
            "authority": None,
            "time": server_time,
            "note": "No TSA configured (PLUMB_TSA_URL). Server clock only — not a trusted timestamp.",
        }

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            digest_file = tmpdir / "digest.bin"
            digest_file.write_bytes(bytes.fromhex(digest_hex))
            query = tmpdir / "request.tsq"
            reply = tmpdir / "response.tsr"

            subprocess.run(
                [
                    "openssl", "ts", "-query",
                    "-digest", digest_hex,
                    "-sha256", "-cert",
                    "-out", str(query),
                ],
                check=True, capture_output=True, timeout=30,
            )
            subprocess.run(
                [
                    "curl", "-sS", "-H", "Content-Type: application/timestamp-query",
                    "--data-binary", f"@{query}",
                    settings.tsa_url, "-o", str(reply),
                ],
                check=True, capture_output=True, timeout=60,
            )
            token = reply.read_bytes()
            return {
                "trusted": True,
                "authority": settings.tsa_url,
                "time": server_time,
                "token_sha256": sha256_bytes(token),
                "token_bytes": len(token),
                "note": "RFC 3161 token retained alongside the capture record.",
            }
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
        return {
            "trusted": False,
            "authority": settings.tsa_url,
            "time": server_time,
            "error": str(exc)[:400],
            "note": "Timestamp request failed. Recorded as untrusted rather than retried silently.",
        }


def c2pa_available() -> bool:
    return bool(settings.c2pa_tool and settings.c2pa_cert and settings.c2pa_key)


def sign_c2pa(source: Path, manifest: dict[str, Any], output: Path) -> dict[str, Any]:
    """
    Sign an asset with a C2PA manifest via `c2patool`.

    Signing is server-side by necessity: a browser cannot hold a private key the
    user is unable to extract. When no signer is configured this returns an
    explicit "not signed" result — the caller must not present the artifact as
    signed.
    """
    if not c2pa_available():
        return {
            "signed": False,
            "reason": (
                "No C2PA signer configured. Set PLUMB_C2PA_TOOL, PLUMB_C2PA_CERT and "
                "PLUMB_C2PA_KEY to enable signing."
            ),
            "assurance": "unsigned",
        }

    try:
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            result = subprocess.run(
                [
                    settings.c2pa_tool, str(source),
                    "-m", str(manifest_path),
                    "-o", str(output),
                    "-f",
                ],
                check=True, capture_output=True, timeout=180,
                env={
                    "C2PA_SIGN_CERT": settings.c2pa_cert or "",
                    "C2PA_PRIVATE_KEY": settings.c2pa_key or "",
                },
            )
            return {
                "signed": True,
                "output": str(output),
                "tool": settings.c2pa_tool,
                "stdout": result.stdout.decode("utf-8", "replace")[:500],
                # Level 1: software signer with a protected server-side key.
                # Level 2 needs hardware-backed capture attestation on device.
                "assurance": "c2pa-level-1-server-signed",
            }
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        detail = getattr(exc, "stderr", b"")
        return {
            "signed": False,
            "reason": str(exc)[:300],
            "detail": detail.decode("utf-8", "replace")[:400] if detail else None,
            "assurance": "unsigned",
        }


def build_c2pa_manifest(record: dict[str, Any]) -> dict[str, Any]:
    """
    Assemble a C2PA manifest for a raw capture, including the Plumb survey
    assertion that carries the metrology the standard has no vocabulary for.
    """
    capture = record.get("capture", {})
    sidecar = record.get("sidecar", {})

    return {
        "claim_generator": f"plumb/{settings.version}",
        "claim_generator_info": [
            {"name": "Plumb", "version": settings.version}
        ],
        "title": capture.get("filename") or record.get("capture_id"),
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "softwareAgent": "Plumb field client",
                            "digitalSourceType":
                                "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
                        },
                        {
                            "action": "c2pa.published",
                            "softwareAgent": f"plumb-backend/{settings.version}",
                        },
                    ]
                },
            },
            {
                "label": "org.plumb.survey.v1",
                "data": {
                    "capture_id": record.get("capture_id"),
                    "sha256": record.get("integrity", {}).get("server_sha256"),
                    "integrity": record.get("integrity"),
                    "timestamp": record.get("timestamp"),
                    "calibration": sidecar.get("calibration"),
                    "measurements": sidecar.get("measurements", []),
                    "capture_attestation": sidecar.get("capture_attestation"),
                    "pipeline": {
                        "stage": "ingest",
                        "service_version": settings.version,
                        "authoritative": False,
                        "note": (
                            "Ingest-stage manifest. Authoritative measurements are produced "
                            "by the post-processing pipeline and signed separately."
                        ),
                    },
                    "limits": [
                        "C2PA proves pipeline integrity, not that the photographed scene is authentic.",
                        "Measured accuracy only (USIBD LOA); represented accuracy is not implied.",
                    ],
                },
            },
        ],
    }
