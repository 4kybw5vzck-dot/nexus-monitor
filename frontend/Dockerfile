# NEXUS Monitor – Frontend-Image
#
# Zwei Varianten (Auswahl über NEXUS_FRONTEND_TARGET in .env):
#
#   prebuilt (Standard) – nutzt das fertig gebaute Frontend aus ./prebuilt.
#                         Beim Bauen wird KEIN npm und kein Internet für Pakete
#                         benötigt (nur das nginx-Basisimage). Ideal für
#                         Server ohne Internet oder hinter Firmen-Proxys.
#
#   source              – baut das Frontend im Container aus dem Quellcode
#                         (benötigt Zugriff auf die npm-Registry).
#
# Einstellungen kommen zur Laufzeit über Umgebungsvariablen (docker/40-runtime-config.sh).

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

# ---------- Build aus dem Quellcode (nur für Target "source") ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
# Optional eigene Registry (z. B. interner Nexus/Artifactory-Spiegel)
ARG NPM_REGISTRY=
COPY package.json package-lock.json* ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build

# ---------- Gemeinsame Laufzeitbasis ----------
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS base
LABEL org.opencontainers.image.title="nexus-monitor-frontend" \
      org.opencontainers.image.description="NEXUS Monitor Web-Oberfläche"
# Vorlage – envsubst des nginx-Images erzeugt daraus /etc/nginx/conf.d/default.conf
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --chmod=755 docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
# Backend-Adresse für den /api/-Proxy (Dienstname aus docker-compose) und
# DNS-Server von Docker (löst Dienstnamen zur Laufzeit auf)
ENV NEXUS_BACKEND_URL=http://backend:8000 \
    NEXUS_DNS_RESOLVER=127.0.0.11
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

# ---------- Target: aus Quellcode gebaut ----------
FROM base AS source
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

# ---------- Target: fertiges Paket (Standard, letzte Stufe) ----------
FROM base AS prebuilt
COPY --chown=101:101 prebuilt/ /usr/share/nginx/html/
