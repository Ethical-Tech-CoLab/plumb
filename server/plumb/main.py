"""
Plumb backend — application entry point.

Run locally:      uvicorn plumb.main:app --reload --port 8080
Run in Docker:    see server/Dockerfile
"""

from __future__ import annotations

import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import router
from .config import settings

DESCRIPTION = """
Ingest, trust and post-processing backend for **Plumb** — measured photography
for landmarks.

* **Ingest is idempotent** on `capture_id`, so a phone retrying after a day
  offline never duplicates or forks a provenance graph.
* **Raw captures are immutable** once committed.
* **Nothing over-claims.** If no timestamp authority or C2PA signer is
  configured, artifacts say so.
* **Exports conform to the `digital-3d` `photo-survey` contract**, so the CoLab
  bridge and district twins consume Plumb output with no bespoke adapter.
"""


def _origin_allowed(origin: str, patterns: list[str]) -> bool:
    """Exact, wildcard-subdomain, or '*' — same semantics as pages-ai-proxy."""
    for pattern in patterns:
        if pattern == "*" or pattern == origin:
            return True
        if "*" in pattern:
            regex = "^" + re.escape(pattern).replace(r"\*", "[^.]+") + "$"
            if re.match(regex, origin):
                return True
    return False


def create_app() -> FastAPI:
    app = FastAPI(
        title="Plumb backend",
        description=DESCRIPTION,
        version=settings.version,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    allow_all = "*" in settings.allowed_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_all else settings.allowed_origins,
        allow_origin_regex=None if allow_all else _wildcard_regex(settings.allowed_origins),
        allow_credentials=not allow_all,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "X-Plumb-Capture-Id"],
        max_age=3600,
    )

    app.include_router(router)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "detail": str(exc)[:300],
                "path": str(request.url.path),
            },
        )

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "service": settings.service_name,
            "version": settings.version,
            "docs": "/docs",
            "meta": "/v1/meta",
            "health": "/healthz",
        }

    return app


def _wildcard_regex(patterns: list[str]) -> str | None:
    """Build a single regex for any wildcard entries, for CORSMiddleware."""
    wildcards = [p for p in patterns if "*" in p]
    if not wildcards:
        return None
    parts = ["^" + re.escape(p).replace(r"\*", "[^.]+") + "$" for p in wildcards]
    return "|".join(parts)


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
