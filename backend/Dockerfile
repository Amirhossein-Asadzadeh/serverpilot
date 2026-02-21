# ─── ServerPilot Backend Dockerfile ──────────────────────────────────────────
#
# Multi-stage build for minimal production image.
# Builder stage installs dependencies, final stage copies only what's needed.

FROM python:3.11-slim AS builder

WORKDIR /srv

# Install build dependencies
# build-essential provides gcc + libc6-dev (stdlib.h, etc.) needed to compile
# psutil and other C-extension packages from source (required on ARM/aarch64)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies into a virtual environment
COPY requirements.txt .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip --quiet && \
    /opt/venv/bin/pip install -r requirements.txt --quiet

# ─── Final stage ─────────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /srv

# Install runtime library for PostgreSQL client
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application code as a package named 'backend'
COPY . /srv/backend/

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash serverpilot && \
    chown -R serverpilot:serverpilot /srv
USER serverpilot

EXPOSE 8000

# Run as a package so relative imports (from .config import ...) work correctly
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
