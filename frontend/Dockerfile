# NEXUS Monitor – Frontend-Image
# Stufe 1: Build mit Node.js, Stufe 2: Auslieferung mit unprivilegiertem nginx.
# Das fertige Image ist umgebungsunabhängig; Einstellungen kommen zur Laufzeit
# über Umgebungsvariablen (siehe docker/40-runtime-config.sh).

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine
LABEL org.opencontainers.image.title="nexus-monitor-frontend" \
      org.opencontainers.image.description="NEXUS Monitor Web-Oberfläche"
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --chmod=755 docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
