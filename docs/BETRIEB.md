# NEXUS Monitor – Installation und Betrieb

## Voraussetzungen

| Komponente | Anforderung |
|---|---|
| Betriebssystem | Linux (z. B. Debian 12, Ubuntu 24.04, RHEL/Rocky 9) oder Windows Server 2022/2025 bzw. Windows 11 mit Docker-Laufzeit |
| Docker | Docker Engine ≥ 24 mit Compose-Plugin ≥ 2.20 (Linux) oder Docker Desktop (Windows; Linux-Container über WSL 2) |
| Hardware nur Oberfläche (Mock) | 1 vCPU, 512 MB RAM, 1 GB Speicher |
| Hardware mit Backend (Richtwert) | 4 vCPU, 8 GB RAM, 100 GB SSD für ca. 5.000 Sensoren bei 60-s-Intervall |
| Netzwerk | Ein freier TCP-Port für die Weboberfläche (Standard 8080). Kein Internetzugang erforderlich, sobald die Images vorhanden sind |

Die Skripte unter `scripts/` sind Bash-Skripte. Unter Windows laufen sie in WSL oder Git Bash.

## Installation

1. **Docker installieren** (Docker Engine bzw. Docker Desktop).
2. **Projektpaket bereitstellen** – per `git clone` oder Archiv entpacken.
3. **Konfiguration eintragen:**
   ```bash
   cp .env.example .env
   # .env bearbeiten: Port, Instanzname; für den Betrieb mit Backend siehe unten
   ```
4. **Starten:**
   ```bash
   docker compose up -d --build
   docker compose ps          # Spalte STATUS muss "healthy" zeigen
   ```
5. **Anmelden** – im Mock-Modus ohne Anmeldung; mit Backend siehe nächsten Abschnitt.

## Betrieb mit Backend und Datenbank

In `.env`:

```ini
COMPOSE_PROFILES=backend          # Backend und Datenbank mitstarten
NEXUS_DATA_SOURCE=http            # Oberfläche liest aus dem Backend, mit Anmeldung
POSTGRES_PASSWORD=<lang und zufällig>
NEXUS_ADMIN_PASSWORD=<Passwort für das erste Administratorkonto>   # optional
NEXUS_SEED_DEMO=true              # optional: Beispieldaten zum Ausprobieren
```

Passwort erzeugen, z. B. `openssl rand -base64 32` (Linux) oder in PowerShell
`[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))`. Sonderzeichen wie `/ + =` sind erlaubt.

Dann `docker compose up -d --build` bzw. unter Windows `.\start-nexus.ps1`. Beim ersten Start:

1. Die Datenbank wird angelegt, das Backend führt die Migrationen aus (Alembic, versioniert).
2. Kann sich noch niemand als Administrator anmelden, wird das Konto `NEXUS_ADMIN_LOGIN` (Standard `admin`) angelegt. Ist `NEXUS_ADMIN_PASSWORD` leer, erzeugt das Backend ein Passwort und schreibt es **einmalig** ins Log:
   ```bash
   docker compose logs backend | grep "Erzeugtes Passwort"      # Windows: findstr statt grep
   ```
   `start-nexus.ps1` zeigt es automatisch an. `NEXUS_ADMIN_PASSWORD` wirkt nur beim ersten Anlegen – spätere Änderungen in `.env` ändern das Passwort nicht.
3. Mit `NEXUS_SEED_DEMO=true` wird der Beispieldatensatz (24 Geräte, 115 Sensoren, 30 Tage Verlauf) in die **leere** Datenbank geladen. Die Verlaufsdaten enden zum Ladezeitpunkt und altern danach – echte Messwerte liefert ab Phase 3 die Monitoring-Engine. Für einen frischen Demo-Stand: Datenbank-Volume löschen (`docker compose down -v`, **löscht alle Daten**).

Die Demo-Benutzer (m.berger, j.keller …) haben kein Passwort und können sich nicht anmelden.

### Passwort setzen oder zurücksetzen

```bash
docker compose exec backend python -m app.cli set-password admin
```

Das Passwort wird verdeckt abgefragt (mindestens 10 Zeichen), bestehende Sitzungen des Benutzers werden beendet. So lässt sich auch ein Demo-Benutzer anmeldefähig machen.

### Rollen

| Rolle | Rechte |
|---|---|
| Administrator | alles |
| Operator | lesen, Alarme bestätigen, Discovery starten |
| Nur Lesen | lesen |

Anmeldesitzungen gelten `NEXUS_SESSION_HOURS` Stunden (Standard 12). Nach 5 Fehlversuchen je Benutzername oder Client-Adresse wird die Anmeldung für 5 Minuten gesperrt.

### API

Das Backend ist nur über den Proxy der Oberfläche erreichbar (`http://<server>:8080/api/…`), es veröffentlicht keinen eigenen Port. Die interaktive API-Dokumentation liegt unter `/api/docs`.

### Installation ohne Internet (Offline-Server)

Auf einem Rechner mit Internetzugang:

```bash
docker compose build
docker compose --profile backend build
docker save nexus-monitor/frontend:latest nexus-monitor/backend:latest timescale/timescaledb:latest-pg17 | gzip > nexus-images.tar.gz
```

Archiv und Projektordner auf den Zielserver kopieren, dann:

```bash
docker load < nexus-images.tar.gz       # Windows: docker load -i nexus-images.tar.gz
docker compose up -d                    # ohne --build
```

## Frontend-Paket: fertig gebaut oder aus dem Quellcode

Standardmäßig (`NEXUS_FRONTEND_TARGET=prebuilt`) verwendet das Image das bereits gebaute Frontend aus `frontend/prebuilt`. Beim `docker compose build` wird dann kein npm ausgeführt und es werden keine Pakete geladen – das funktioniert auch hinter Firmen-Proxys mit SSL-Inspektion und auf Servern ohne Internet (nur das nginx-Basisimage wird benötigt).

Nach Änderungen am Quellcode wird das Paket auf einem Entwicklungsrechner neu erzeugt und mit eingecheckt:

```bash
cd frontend
npm ci
npm run build:prebuilt
```

> **Hinweis:** Immer `npm ci` verwenden (installiert exakt die Versionen aus `package-lock.json`). `npm install` ohne Lock-Datei bricht mit npm 10 beim Auflösen der optionalen Peer-Abhängigkeiten von Vitest ab (`Cannot read properties of null (reading 'edgesOut')`). Zum Aktualisieren von Paketen npm 11 oder neuer nutzen, z. B. `npx npm@11 install`.

Alternativ baut `NEXUS_FRONTEND_TARGET=source` direkt im Container (Zugriff auf die npm-Registry nötig; interner Spiegel über `NPM_REGISTRY`). Der Container installiert per `npm ci` aus `package-lock.json` – damit funktioniert auch das npm 10 im Node-22-Image.

## Konfiguration

Alle Einstellungen stehen in `.env` (Vorlage mit Erklärungen: `.env.example`). Nach Änderungen:

```bash
docker compose up -d
```

Das Frontend-Image enthält keine umgebungsspezifischen Werte. Beim Start schreibt der Container `config.js` aus den Variablen `NEXUS_DATA_SOURCE`, `NEXUS_API_BASE_URL` und `NEXUS_INSTANCE_NAME`. Die Weiterleitung `/api/` zeigt auf `NEXUS_BACKEND_URL` (Standard `http://backend:8000`); der Name wird erst bei der Anfrage aufgelöst, daher startet die Oberfläche auch ohne Backend (dann antwortet `/api/` mit 502).

### Hinter einem Reverse-Proxy (empfohlen für HTTPS)

`NEXUS_HTTP_BIND=127.0.0.1` setzen und den vorhandenen Proxy (nginx, Traefik, IIS ARR, …) auf `http://127.0.0.1:${NEXUS_HTTP_PORT}` zeigen lassen.

## Healthchecks

| Dienst | Prüfung |
|---|---|
| frontend | `GET /healthz` → `ok` |
| db | `pg_isready` |
| backend | `GET /api/health` (prüft auch die Datenbank, meldet ob TimescaleDB aktiv ist) |

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
   Das Skript übernimmt `.env`, startet die Datenbank, hält das Backend an, legt die Datenbank neu an, spielt den Dump ein (mit TimescaleDB: `timescaledb_pre_restore()` / `timescaledb_post_restore()`) und startet alle Dienste.
   Ziel- und Quellserver sollten dieselbe TimescaleDB-Version verwenden (`TIMESCALEDB_VERSION` in `.env`).
4. Remote-Collectoren (ab Phase 3) auf die neue Adresse umstellen (`NEXUS_CORE_URL`).

## Update

```bash
./scripts/backup.sh                  # immer zuerst sichern
git pull                             # bzw. neues Projektpaket entpacken
docker compose build --pull
docker compose up -d
docker compose ps
```

Das Backend führt Datenbankmigrationen (Alembic) beim Start automatisch und versioniert aus. Rollback: vorheriges Paket bzw. `NEXUS_VERSION` zurücksetzen und die Sicherung von vor dem Update wiederherstellen.

## Persistente Daten

| Daten | Ort |
|---|---|
| Konfiguration | `.env` im Projektordner |
| Datenbank | Docker-Volume `<COMPOSE_PROJECT_NAME>_db-data` |
| Collector-Puffer (Phase 3) | Volume `collector-buffer` am Standort |
| Sicherungen | `NEXUS_BACKUP_DIR` (Standard `./backups`) |

Das Frontend speichert keine Daten.
