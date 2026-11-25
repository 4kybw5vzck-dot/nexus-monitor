#!/bin/sh
# Erzeugt beim Containerstart /usr/share/nginx/html/config.js aus Umgebungsvariablen.
# So läuft dasselbe Image ohne Neubau auf jedem Server.
set -eu

TARGET=/usr/share/nginx/html/config.js

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$TARGET" <<EOF
// Automatisch erzeugt beim Containerstart – nicht von Hand bearbeiten.
window.__NEXUS_CONFIG__ = {
  dataSource: "$(json_escape "${NEXUS_DATA_SOURCE:-mock}")",
  apiBaseUrl: "$(json_escape "${NEXUS_API_BASE_URL:-/api}")",
  instanceName: "$(json_escape "${NEXUS_INSTANCE_NAME:-NEXUS Monitor}")"
};
EOF

echo "[nexus] Laufzeit-Konfiguration geschrieben (Datenquelle: ${NEXUS_DATA_SOURCE:-mock})"
