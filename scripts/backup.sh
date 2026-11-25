#!/usr/bin/env bash
# =============================================================================
# NEXUS Monitor – Datensicherung
#
# Sichert in EIN Archiv:
#   - .env (Konfiguration)
#   - Datenbank (pg_dump im Custom-Format, inkl. TimescaleDB), falls der
#     Datenbankdienst läuft (ab Phase 2)
#   - Versionsinformationen
#
# Aufruf:   ./scripts/backup.sh
# Ergebnis: $NEXUS_BACKUP_DIR/nexus-<zeitstempel>.tar.gz
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi

BACKUP_DIR="${NEXUS_BACKUP_DIR:-./backups}"
KEEP="${NEXUS_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"
echo "[backup] Starte Sicherung $STAMP"

# 1) Konfiguration
if [[ -f .env ]]; then
  cp .env "$WORK/env"
  chmod 600 "$WORK/env"
fi
cp docker-compose.yml "$WORK/docker-compose.yml"

# 2) Datenbank (nur wenn der Dienst läuft)
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  echo "[backup] Sichere Datenbank ${POSTGRES_DB:-nexus} …"
  docker compose exec -T db pg_dump -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" -Fc > "$WORK/database.dump"
else
  echo "[backup] Datenbankdienst läuft nicht – nur Konfiguration wird gesichert (in Phase 1 normal)."
fi

# 3) Metadaten
{
  echo "created=$STAMP"
  echo "nexus_version=${NEXUS_VERSION:-latest}"
  echo "host=$(hostname)"
} > "$WORK/BACKUP_INFO"

ARCHIVE="$BACKUP_DIR/nexus-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
chmod 600 "$ARCHIVE"
echo "[backup] Fertig: $ARCHIVE"

# 4) Alte Sicherungen entfernen
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/nexus-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
for f in "${OLD[@]}"; do
  rm -f -- "$f" && echo "[backup] Alte Sicherung entfernt: $f"
done
