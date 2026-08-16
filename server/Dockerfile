# Plumb backend — container image.
#
# Multi-stage so the runtime image carries no build toolchain. Runs as a
# non-root user, with a healthcheck the orchestrator can actually use.

# ---------------------------------------------------------------- builder
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

COPY requirements.txt .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install -r requirements.txt

# Optional extras. Build with --build-arg WITH_AZURE=1 for the Blob backend.
ARG WITH_AZURE=0
RUN if [ "$WITH_AZURE" = "1" ]; then \
      /opt/venv/bin/pip install azure-storage-blob==12.24.0 ; \
    fi

# ---------------------------------------------------------------- runtime
FROM python:3.12-slim AS runtime

# openssl + curl are used for RFC 3161 timestamping; ca-certificates for TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 plumb \
 && useradd --uid 10001 --gid plumb --create-home --shell /usr/sbin/nologin plumb

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PLUMB_DATA_DIR=/data \
    PLUMB_HOST=0.0.0.0 \
    PLUMB_PORT=8080

WORKDIR /app
COPY --chown=plumb:plumb plumb/ ./plumb/

# Data lives on a volume so raw captures survive container replacement.
RUN mkdir -p /data && chown -R plumb:plumb /data /app
VOLUME ["/data"]

USER plumb
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

# Single worker by default: the job queue is in-process and file-backed.
# Scale out by running multiple containers against shared storage plus an
# external broker — see server/README.md.
CMD ["uvicorn", "plumb.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
