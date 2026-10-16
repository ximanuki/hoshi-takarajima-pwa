# AI総務さん — API + web UI. CPU only, no PyTorch.
# The pinned embedding model is downloaded and the index is built at *build*
# time, so the running container needs no network access except (optionally)
# to the Claude API.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KAI_HOME=/app \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /app

# 1) dependencies (cached layer; hashes pinned in requirements.lock)
COPY requirements.lock ./
RUN pip install --require-hashes -r requirements.lock

# 2) application code
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-deps .

# 3) embedding model + index (rebuilt only when data/ changes)
RUN kai download-model
COPY data ./data
RUN kai ingest

# Unprivileged runtime user. No chown: the app only reads /app (a recursive chown
# would duplicate the 470 MB model layer).
RUN useradd --create-home --uid 10001 kai
USER kai

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["kai", "serve", "--host", "0.0.0.0", "--port", "8000"]
