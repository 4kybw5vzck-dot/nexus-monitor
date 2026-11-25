# NEXUS Monitor – Backend-Image (FastAPI)
#
# - Abhängigkeiten exakt nach requirements.lock (reproduzierbar)
# - läuft ohne Root-Rechte (Benutzer nexus, UID 10001)
# - Konfiguration ausschließlich über Umgebungsvariablen (NEXUS_*)
# - führt beim Start die Datenbankmigrationen aus

ARG PYTHON_VERSION=3.12

# ---------- Build: Wheels für App und Abhängigkeiten ----------
FROM python:${PYTHON_VERSION}-slim AS build
WORKDIR /src
# Optional eigener Paketspiegel (z. B. interner PyPI-Proxy)
ARG PIP_INDEX_URL=
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
COPY requirements.lock pyproject.toml ./
RUN if [ -n "$PIP_INDEX_URL" ]; then export PIP_INDEX_URL; else unset PIP_INDEX_URL; fi \
 && pip wheel --wheel-dir /wheels -r requirements.lock
COPY app ./app
RUN pip wheel --no-deps --wheel-dir /wheels .

# ---------- Laufzeit ----------
FROM python:${PYTHON_VERSION}-slim
LABEL org.opencontainers.image.title="nexus-monitor-backend" \
      org.opencontainers.image.description="NEXUS Monitor REST-API"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
RUN groupadd --system --gid 10001 nexus \
 && useradd --system --uid 10001 --gid nexus --home-dir /app --shell /usr/sbin/nologin nexus
WORKDIR /app
COPY --from=build /wheels /tmp/wheels
RUN pip install --no-index --find-links /tmp/wheels /tmp/wheels/*.whl && rm -rf /tmp/wheels
COPY --chown=nexus:nexus alembic.ini ./
USER nexus
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1
# --proxy-headers: echte Client-Adresse vom nginx-Proxy übernehmen (Schutz gegen Passwort-Raten je Adresse).
# Das Backend ist nur im internen Docker-Netz erreichbar (kein veröffentlichter Port).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
