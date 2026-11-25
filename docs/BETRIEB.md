# NEXUS Monitor – Installation und Betrieb

## Voraussetzungen

| Komponente | Anforderung |
|---|---|
| Betriebssystem | Linux (z. B. Debian 12, Ubuntu 24.04, RHEL/Rocky 9) oder Windows Server 2022/2025 bzw. Windows 11 mit Docker-Laufzeit |
| Docker | Docker Engine ≥ 24 mit Compose-Plugin ≥ 2.20 (Linux) oder Docker Desktop (Windows; Linux-Container über WSL 2) |
| Hardware Phase 1 | 1 vCPU, 512 MB RAM, 1 GB Speicher |
| Hardware ab Phase 2 (Richtwert) | 4 vCPU, 8 GB RAM, 100 GB SSD für ca. 5.000 Sensoren bei 60-s-Intervall |
| Netzwerk | Ein freier TCP-Port für die Weboberfläche (Standard 8080). Kein Internetzugang erforderlich, sobald die Images vorhanden sind |

Die Skripte unter `scripts/` sind Bash-Skripte. Unter Windows laufen sie in WSL oder Git Bash.

## Installation

1. **Docker installieren** (Docker Engine bzw. Docker Desktop).
2. **Projektpaket bereitstellen** – per `git clone` oder Archiv entpacken.
3. **Konfiguration eintragen:**
   ```bash
   cp .env.example .env
   # .env bearbeiten: Port, Instanzname; ab Phase 2 POSTGRES_PASSWORD und NEXUS_SECRET_KEY
   ```
4. **Starten:**
   ```bash
   docker compose up -d --build
   docker compose ps          # Spalte STATUS muss "healthy" zeigen
   ```
5. **Administratorkonto einrichten** – ab Phase 2 über `docker compose exec backend nexus-admin create-admin` (in Phase 1 gibt es noch keine Anmeldung).

### Installation ohne Internet (Offline-Server)

Auf einem Rechner mit Internetzugang:

```bash
docker compose build
docker save nexus-monitor/frontend:latest timescale/timescaledb:latest-pg17 | gzip > nexus-images.tar.gz
```

Archiv und Projektordner auf den Zielserver kopieren, dann:

```bash
docker load < nexus-images.tar.gz       # Windows: docker load -i nexus-images.tar.gz
docker compose up -d                    # ohne --build
```

## Konfiguration

Alle Einstellungen stehen in `.env` (Vorlage mit Erklärungen: `.env.example`). Nach Änderungen:

```bash
docker compose up -d
```

Das Frontend-Image enthält keine umgebungsspezifischen Werte. Beim Start schreibt der Container `config.js` aus den Variablen `NEXUS_DATA_SOURCE`, `NEXUS_API_BASE_URL` und `NEXUS_INSTANCE_NAME`.

### Hinter einem Reverse-Proxy (empfohlen für HTTPS)

`NEXUS_HTTP_BIND=127.0.0.1` setzen und den vorhandenen Proxy (nginx, Traefik, IIS ARR, …) auf `http://127.0.0.1:${NEXUS_HTTP_PORT}` zeigen lassen.

## Healthchecks

| Dienst | Prüfung |
|---|---|
| frontend | `GET /healthz` → `ok` |
| db | `pg_isready` |
| backend (Phase 2) | `GET /api/health` |

Zustand anzeigen: `docker compose ps` oder `docker inspect --format '{{.State.Health.Status}}' <container>`.

## Datensicherung

```bash
./scripts/backup.sh
```

Erzeugt `backups/nexus-<zeitstempel>.tar.gz` mit:

- `.env` (enthält Geheimnisse → Archiv geschützt aufbewahren)
- `docker-compose.yml`
- Datenbank-Dump (`pg_dump -Fc`), sofern der Datenbankdienst läuft

Aufbewahrung über `NEXUS_BACKUP_KEEP`. Für tägliche Sicherung z. B. per cron:

```
15 2 * * *  cd /opt/nexus-monitor && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Unter Windows entsprechend über die Aufgabenplanung mit `wsl` oder Git Bash.

## Wiederherstellung und Umzug auf einen anderen Server

1. Auf dem neuen Server Docker installieren und das Projektpaket bereitstellen (gleiche oder neuere Version).
2. Sicherungsarchiv kopieren.
3. Wiederherstellen:
   ```bash
   ./scripts/restore.sh backups/nexus-<zeitstempel>.tar.gz
   ```
   Das Skript übernimmt `.env`, startet die Datenbank, spielt den Dump ein (inklusive TimescaleDB-Vor-/Nachbereitung) und startet alle Dienste.
4. Remote-Collectoren (ab Phase 3) auf die neue Adresse umstellen (`NEXUS_CORE_URL`).

## Update

```bash
./scripts/backup.sh                  # immer zuerst sichern
git pull                             # bzw. neues Projektpaket entpacken
docker compose build --pull
docker compose up -d
docker compose ps
```

Ab Phase 2 führt das Backend Datenbankmigrationen (Alembic) beim Start automatisch und versioniert aus. Rollback: vorheriges Paket bzw. `NEXUS_VERSION` zurücksetzen und die Sicherung von vor dem Update wiederherstellen.

## Persistente Daten

| Daten | Ort |
|---|---|
| Konfiguration | `.env` im Projektordner |
| Datenbank (Phase 2) | Docker-Volume `<COMPOSE_PROJECT_NAME>_db-data` |
| Collector-Puffer (Phase 3) | Volume `collector-buffer` am Standort |
| Sicherungen | `NEXUS_BACKUP_DIR` (Standard `./backups`) |

Das Frontend speichert keine Daten.
