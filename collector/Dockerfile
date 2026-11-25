# NEXUS Monitor – Collector-Image
#
# - läuft ohne Root (Benutzer nexus, UID 10001)
# - Ping ohne Root über ICMP-Datagram-Sockets: braucht im Container
#   sysctl net.ipv4.ping_group_range="0 2147483647" (in docker-compose.yml gesetzt)
# - Puffer für Messergebnisse unter /var/lib/nexus-collector (Volume)

ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS build
WORKDIR /src
ARG PIP_INDEX_URL=
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
COPY requirements.lock pyproject.toml ./
RUN if [ -n "$PIP_INDEX_URL" ]; then export PIP_INDEX_URL; else unset PIP_INDEX_URL; fi \
 && pip wheel --wheel-dir /wheels -r requirements.lock
COPY nexus_collector ./nexus_collector
RUN pip wheel --no-deps --wheel-dir /wheels .

FROM python:${PYTHON_VERSION}-slim
LABEL org.opencontainers.image.title="nexus-monitor-collector" \
      org.opencontainers.image.description="NEXUS Monitor Collector (Ping, SNMP, HTTP, DNS, SSH, WMI/WinRM)"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 \
    NEXUS_BUFFER_DIR=/var/lib/nexus-collector
RUN groupadd --system --gid 10001 nexus \
 && useradd --system --uid 10001 --gid nexus --home-dir /app --shell /usr/sbin/nologin nexus \
 && mkdir -p /var/lib/nexus-collector && chown nexus:nexus /var/lib/nexus-collector
COPY --from=build /wheels /tmp/wheels
RUN pip install --no-index --find-links /tmp/wheels /tmp/wheels/*.whl && rm -rf /tmp/wheels
USER nexus
WORKDIR /app
VOLUME ["/var/lib/nexus-collector"]
# Lebt der Prozess und ist der Puffer beschreibbar?
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import os,sys; sys.exit(0 if os.access('/var/lib/nexus-collector', os.W_OK) else 1)"
CMD ["python", "-m", "nexus_collector"]
