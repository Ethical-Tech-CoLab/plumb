"""
Plumb backend — configuration.

Environment-variable names follow the conventions already used by the
Ethical Tech CoLab `pages-ai-proxy` (ALLOWED_ORIGINS, MAX_BODY_BYTES, ...) so
that operators moving between CoLab services find the same knobs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _csv(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Runtime configuration. Everything has a working local default."""

    # --- service identity -------------------------------------------------
    service_name: str = os.environ.get("PLUMB_SERVICE_NAME", "plumb-backend")
    version: str = os.environ.get("PLUMB_VERSION", "0.1.0")
    environment: str = os.environ.get("PLUMB_ENV", "local")

    # --- HTTP -------------------------------------------------------------
    host: str = os.environ.get("PLUMB_HOST", "0.0.0.0")
    port: int = _int("PLUMB_PORT", 8080)
    # Same semantics as pages-ai-proxy: exact, wildcard subdomain, or "*".
    allowed_origins: list[str] = field(
        default_factory=lambda: _csv("ALLOWED_ORIGINS", "*")
    )
    max_body_bytes: int = _int("MAX_BODY_BYTES", 64 * 1024 * 1024)  # 64 MB per chunk
    max_capture_bytes: int = _int("MAX_CAPTURE_BYTES", 512 * 1024 * 1024)

    # --- storage ----------------------------------------------------------
    # "local" writes to disk; "azure_blob" uses AZURE_STORAGE_CONNECTION_STRING.
    storage_backend: str = os.environ.get("PLUMB_STORAGE", "local")
    data_dir: Path = Path(os.environ.get("PLUMB_DATA_DIR", "./data")).resolve()
    azure_connection_string: str | None = os.environ.get(
        "AZURE_STORAGE_CONNECTION_STRING"
    )
    azure_raw_container: str = os.environ.get("AZURE_RAW_CONTAINER", "plumb-raw")

    # --- trust ------------------------------------------------------------
    # RFC 3161 Time Stamp Authority. FreeTSA works for development.
    tsa_url: str | None = os.environ.get("PLUMB_TSA_URL")
    # Path to `c2patool` (or a signer shim). When unset, signing is skipped and
    # every artifact says so honestly rather than implying it was signed.
    c2pa_tool: str | None = os.environ.get("PLUMB_C2PA_TOOL")
    c2pa_cert: str | None = os.environ.get("PLUMB_C2PA_CERT")
    c2pa_key: str | None = os.environ.get("PLUMB_C2PA_KEY")

    # --- auth -------------------------------------------------------------
    # Comma list of accepted bearer tokens for write operations. Empty = open,
    # which is fine for a laptop and must never be used on a public host.
    api_tokens: list[str] = field(default_factory=lambda: _csv("PLUMB_API_TOKENS"))
    require_auth: bool = _bool("PLUMB_REQUIRE_AUTH", False)

    # --- digital-3d contract integration ---------------------------------
    contract_version: str = os.environ.get("PLUMB_CONTRACT_VERSION", "1")
    module_id: str = os.environ.get("PLUMB_MODULE_ID", "plumb-photo-survey")
    frame_id: str = os.environ.get("PLUMB_FRAME_ID", "nyc-harbor-enu")
    campaign_id: str = os.environ.get("PLUMB_CAMPAIGN_ID", "plumb-field-capture")
    default_license: str = os.environ.get("PLUMB_DEFAULT_LICENSE", "CC-BY-4.0")
    default_license_url: str = os.environ.get(
        "PLUMB_DEFAULT_LICENSE_URL", "https://creativecommons.org/licenses/by/4.0/"
    )
    public_base_url: str = os.environ.get("PLUMB_PUBLIC_BASE_URL", "").rstrip("/")

    def storage_root(self) -> Path:
        return self.data_dir

    def describe(self) -> dict:
        """Non-secret configuration summary, safe to expose on /v1/meta."""
        return {
            "service": self.service_name,
            "version": self.version,
            "environment": self.environment,
            "storage_backend": self.storage_backend,
            "allowed_origins": self.allowed_origins,
            "max_capture_bytes": self.max_capture_bytes,
            "auth_required": self.require_auth,
            "timestamp_authority_configured": bool(self.tsa_url),
            "c2pa_signing_configured": bool(
                self.c2pa_tool and self.c2pa_cert and self.c2pa_key
            ),
            "contract": {
                "contract_version": self.contract_version,
                "module_id": self.module_id,
                "frame_id": self.frame_id,
                "campaign_id": self.campaign_id,
            },
        }


settings = Settings()
