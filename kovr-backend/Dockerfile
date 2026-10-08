FROM python:3.12-slim

WORKDIR /app

# System dependencies: git (repo cloning), curl (gitleaks download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Gitleaks binary (matches local dev version, v8.30.1)
RUN curl -sSL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
    -o /tmp/gitleaks.tar.gz \
    && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
    && rm /tmp/gitleaks.tar.gz \
    && chmod +x /usr/local/bin/gitleaks

# Create non-root user early so we can own /app
RUN useradd --create-home appuser && chown appuser:appuser /app

# Install uv (fast Python package manager)
RUN pip install uv

# Copy dependency files first (Docker layer caching)
COPY --chown=appuser:appuser pyproject.toml .
COPY --chown=appuser:appuser uv.lock* .

# Switch to non-root user before installing deps (so .venv is owned by appuser)
USER appuser

# Install dependencies (production only)
RUN uv sync --frozen --no-dev

# Copy application code (single app/ package)
COPY --chown=appuser:appuser app/ app/

# Writable directory for cloned repos at runtime
RUN mkdir -p /app/cloned_repos

# Expose port
EXPOSE 8000

# Health check — matches KOVR's actual endpoint (/api/health, not /health)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Run uvicorn directly from venv (avoids uv re-syncing at runtime)
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]