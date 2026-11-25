#!/usr/bin/env bash
# =============================================================================
# NEXUS Monitor – Wiederherstellung (auch auf einem neuen Server)
#
# Aufruf:  ./scripts/restore.sh backups/nexus-<zeitstempel>.tar.gz
#
# Ablauf:
#   1. .env aus der Sicherung übernehmen (bestehende .env wird umbenannt)
#   2. Datenbank starten und Dump einspielen (falls in der Sicherung enthalten)
#   3. Alle Dienste starten
# =============================================================================
set -euo pipefail

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Aufruf: $0 <sicherung.tar.gz>" >&2
  exit 1
fi
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
echo "[restore] Sicherung: $(grep created "$WORK/BACKUP_INFO" 2>/dev/null || echo unbekannt)"

read -r -p "Bestehende Daten dieser Installation werden überschrieben. Fortfahren? [j/N] " ANSWER
[[ "$ANSWER" =~ ^[jJyY]$ ]] || { echo "Abgebrochen."; exit 1; }

if [[ -f "$WORK/env" ]]; then
  [[ -f .env ]] && mv .env ".env.vor-restore-$(date +%Y%m%d-%H%M%S)"
  cp "$WORK/env" .env
  chmod 600 .env
  echo "[restore] .env übernommen"
fi

set -a; # shellcheck disable=SC1091
source .env; set +a

if [[ -f "$WORK/database.dump" ]]; then
  echo "[restore] Starte Datenbank …"
  docker compose --profile backend up -d db
  for _ in $(seq 1 60); do
    docker compose exec -T db pg_isready -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" >/dev/null 2>&1 && break
    sleep 2
  done
  echo "[restore] Spiele Datenbank ein …"
  docker compose exec -T db psql -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" -c "SELECT timescaledb_pre_restore();" >/dev/null 2>&1 || true
  docker compose exec -T db pg_restore -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" --clean --if-exists --no-owner < "$WORK/database.dump"
  docker compose exec -T db psql -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" -c "SELECT timescaledb_post_restore();" >/dev/null 2>&1 || true
  docker compose --profile backend up -d
else
  docker compose up -d
fi

echo "[restore] Fertig. Status:"
docker compose ps
