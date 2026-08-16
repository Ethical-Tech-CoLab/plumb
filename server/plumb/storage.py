"""
Storage — write-once raw captures plus a small JSON record store.

The raw image is the one artifact that can never be regenerated, so it is
written once and then treated as immutable: re-uploading the same capture id
with different bytes is refused rather than silently overwriting.

Two backends:
  local       filesystem, good for a laptop, a lab machine or a mounted volume
  azure_blob  Azure Blob Storage, optionally with an immutability policy

The interface is deliberately tiny so a third backend (S3, MinIO) is a small
addition rather than a refactor.
"""

from __future__ import annotations

import json
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import settings


class StorageError(RuntimeError):
    pass


class ImmutabilityError(StorageError):
    """Raised when something tries to change bytes that are already final."""


class LocalStorage:
    """Filesystem storage. Raw objects are chmod'd read-only after commit."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or settings.storage_root())
        self.raw = self.root / "raw"
        self.records = self.root / "records"
        self.derived = self.root / "derived"
        self.staging = self.root / "staging"
        for path in (self.raw, self.records, self.derived, self.staging):
            path.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # --- raw bytes -------------------------------------------------------

    def raw_path(self, capture_id: str) -> Path:
        # Shard by prefix so a directory never holds a million entries.
        return self.raw / capture_id[:2] / f"{capture_id}.bin"

    def staging_path(self, capture_id: str) -> Path:
        return self.staging / f"{capture_id}.part"

    def append_chunk(self, capture_id: str, offset: int, data: bytes) -> int:
        """Append a chunk at a known offset. Idempotent for repeated offsets."""
        path = self.staging_path(capture_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            current = path.stat().st_size if path.exists() else 0
            if offset > current:
                raise StorageError(
                    f"chunk offset {offset} leaves a gap; expected at most {current}"
                )
            if offset < current:
                # Client is retrying a chunk we already have. Accept and no-op.
                return current
            with open(path, "ab") as handle:
                handle.write(data)
            return path.stat().st_size

    def staged_size(self, capture_id: str) -> int:
        path = self.staging_path(capture_id)
        return path.stat().st_size if path.exists() else 0

    def commit_raw(self, capture_id: str) -> Path:
        """Move staged bytes to their final, read-only home."""
        staged = self.staging_path(capture_id)
        if not staged.exists():
            raise StorageError("no staged data to commit")
        final = self.raw_path(capture_id)
        final.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            if final.exists():
                raise ImmutabilityError(
                    f"raw object for {capture_id} already exists and is immutable"
                )
            shutil.move(str(staged), str(final))
            try:
                final.chmod(0o444)
            except OSError:
                # Read-only bit is best-effort; some filesystems refuse it.
                pass
        return final

    def open_raw(self, capture_id: str):
        return open(self.raw_path(capture_id), "rb")

    def raw_exists(self, capture_id: str) -> bool:
        return self.raw_path(capture_id).exists()

    def discard_staging(self, capture_id: str) -> None:
        path = self.staging_path(capture_id)
        if path.exists():
            path.unlink()

    # --- derived artifacts ----------------------------------------------

    def write_derived(self, capture_id: str, name: str, data: bytes) -> Path:
        path = self.derived / capture_id[:2] / capture_id / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    # --- records ---------------------------------------------------------

    def record_path(self, capture_id: str) -> Path:
        return self.records / capture_id[:2] / f"{capture_id}.json"

    def put_record(self, capture_id: str, record: dict[str, Any]) -> None:
        path = self.record_path(capture_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        record = dict(record)
        record["updated_at"] = datetime.now(timezone.utc).isoformat()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(record, indent=2), encoding="utf-8")
        tmp.replace(path)

    def get_record(self, capture_id: str) -> dict[str, Any] | None:
        path = self.record_path(capture_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def iter_records(self) -> Iterator[dict[str, Any]]:
        for path in sorted(self.records.rglob("*.json")):
            try:
                yield json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue

    def stats(self) -> dict[str, Any]:
        raw_files = list(self.raw.rglob("*.bin"))
        return {
            "captures": sum(1 for _ in self.records.rglob("*.json")),
            "raw_objects": len(raw_files),
            "raw_bytes": sum(f.stat().st_size for f in raw_files),
            "root": str(self.root),
        }


class AzureBlobStorage(LocalStorage):
    """
    Azure Blob backend.

    Staging still happens on local disk (chunked uploads need a scratch area);
    committing pushes the finished object to Blob Storage, where an immutability
    policy on the container provides real WORM semantics.

    Falls back to local-only with a clear error if the SDK is missing, rather
    than pretending an upload succeeded.
    """

    def __init__(self, root: Path | None = None) -> None:
        super().__init__(root)
        try:
            from azure.storage.blob import BlobServiceClient  # type: ignore
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise StorageError(
                "PLUMB_STORAGE=azure_blob requires the azure-storage-blob package"
            ) from exc
        if not settings.azure_connection_string:
            raise StorageError(
                "PLUMB_STORAGE=azure_blob requires AZURE_STORAGE_CONNECTION_STRING"
            )
        self._service = BlobServiceClient.from_connection_string(
            settings.azure_connection_string
        )
        self._container = self._service.get_container_client(
            settings.azure_raw_container
        )
        try:
            self._container.create_container()
        except Exception:  # pragma: no cover - already exists
            pass

    def commit_raw(self, capture_id: str) -> Path:
        local_path = super().commit_raw(capture_id)
        blob = self._container.get_blob_client(f"{capture_id[:2]}/{capture_id}.bin")
        with open(local_path, "rb") as handle:
            # overwrite=False preserves write-once semantics at the remote too.
            blob.upload_blob(handle, overwrite=False)
        return local_path


def build_storage() -> LocalStorage:
    if settings.storage_backend == "azure_blob":
        return AzureBlobStorage()
    return LocalStorage()


storage = build_storage()
