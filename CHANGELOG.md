# Änderungsprotokoll

## 0.1.0 – Phase 1

- Monitoring-Oberfläche (React/TypeScript, Dark Mode) mit Dashboard, Devices, Sensors, Network Maps, Sites, Alerts, Reports, Discovery, Collectors und Administration
- Deterministische Mock-Datenquelle: 24 Geräte, 115 Sensoren, 3 Standorte, aktive und behobene Alarme
- Datenquellen-Interface als Vorbereitung für das FastAPI-Backend
- Docker-Image für das Frontend (nginx ohne Root, Healthcheck, Laufzeit-Konfiguration)
- docker-compose mit vorbereiteter TimescaleDB, `.env.example`, Sicherungs- und Wiederherstellungsskripte
- Tests für Statuslogik, Router und Konsistenz der Mock-Daten

## 0.1.1

- Docker-Build ohne npm: Standard-Target `prebuilt` nutzt das fertig gebaute Frontend aus `frontend/prebuilt` (funktioniert hinter Firmen-Proxys und offline). Bau aus dem Quellcode weiter über `NEXUS_FRONTEND_TARGET=source`, optional mit internem npm-Spiegel (`NPM_REGISTRY`).
- Router funktioniert auch ohne History-API.
- Startskript `start-nexus.ps1` für Windows.

## 0.1.2

- `package-lock.json` eingecheckt: Installation erstmals mit echten Paketen geprüft (React 19.3, Vite 7.3, Vitest 4.1, TypeScript 5.9). Typprüfung, 17 Tests und Produktions-Build erfolgreich.
- Ursache des fehlgeschlagenen Docker-Builds (`NEXUS_FRONTEND_TARGET=source`) gefunden: npm 10 stürzt ohne Lock-Datei beim Auflösen der Peer-Abhängigkeiten von Vitest ab. Mit Lock-Datei nutzt der Container `npm ci`, das funktioniert.
- `frontend/prebuilt` jetzt mit Vite gebaut (vorher esbuild); relative Asset-Pfade (`base: './'`) für Betrieb hinter Reverse-Proxy mit Unterpfad.
- Doku: `npm ci` statt `npm install`.

## 0.2.0 – Phase 2: Backend und Datenbank

- **Backend** (`backend/`): FastAPI, SQLAlchemy 2, psycopg 3, Alembic. Alle Endpunkte aus `docs/ARCHITEKTUR.md`, Konfiguration nur über `NEXUS_*`, Image ohne Root, Healthcheck `/api/health`.
- **Datenbank:** Schema mit Migration `0001`; Messwerte in `measurements`, mit TimescaleDB als Hypertable mit Kompression (ohne TimescaleDB normale Tabelle). Migrationen laufen beim Start automatisch.
- **Anmeldung:** lokale Benutzer, scrypt-Passwörter, Sitzungs-Token (nur Hash gespeichert), Rollen Administrator / Operator / Nur Lesen, Sperre nach 5 Fehlversuchen. Erstes Administratorkonto beim Start (Passwort aus `.env` oder erzeugt). Passwort setzen: `python -m app.cli set-password <login>`.
- **Demo-Datensatz:** `npm run export:demo` exportiert die Mock-Daten mit 30 Tagen Verlauf; `NEXUS_SEED_DEMO=true` lädt sie in eine leere Datenbank.
- **Frontend:** `HttpDataSource`, Anmeldeseite, Abmelden, Benutzer in der Kopfzeile; Bestätigen und Discovery nur für Operator/Administrator; Fehlermeldungen bei Bestätigen und Discovery. Mock-Modus unverändert.
- **nginx:** `/api/`-Proxy zum Backend (`NEXUS_BACKEND_URL`), startet auch ohne Backend.
- **Compose:** Dienst `backend`, Aktivierung über `COMPOSE_PROFILES=backend` in `.env`; `start-nexus.ps1` wartet auf das Backend und zeigt ein erzeugtes Admin-Passwort an.
- **Wiederherstellung:** `restore.sh` hält das Backend an, legt die Datenbank neu an und aktiviert TimescaleDB vor `timescaledb_pre_restore()`.
- Tests: Backend 38 (pytest gegen PostgreSQL), Frontend 25 (Vitest).

## 0.2.1

- **Benutzerverwaltung in der Oberfläche** (Administration → Benutzer & Rollen, nur Administratoren): anlegen, bearbeiten, deaktivieren, löschen, Passwort setzen. Schutz gegen Aussperren (eigenes Konto nicht deaktivierbar/herabstufbar/löschbar).
- **Eigenes Passwort ändern** über den Anmeldenamen oben rechts; andere Sitzungen werden beendet.
- API: `POST/PATCH/DELETE /api/users`, `POST /api/users/{id}/password`, `POST /api/auth/password`; Benutzerliste zeigt `hasPassword`.
- **PowerShell-Skripte** `scripts/backup.ps1` und `scripts/restore.ps1` (Windows PowerShell 5.1 und 7), gleiches Archivformat wie die Bash-Skripte. Der Dump wird per `docker compose cp` übertragen (keine Umleitung von Binärdaten).
- Validierungsfehler der API nennen das betroffene Feld.

## 0.3.0 – Phase 3: Monitoring-Engine

- **Collector** (`collector/`, eigenes Image): Ping (ohne Root), SNMP v2c/v3 (Huawei, Cisco, HOST-RESOURCES, UCD; Interface-Status, Traffic aus 64-Bit-Zählern), HTTP(S) mit Suchbegriff, DNS, Linux über SSH (Load, CPU, RAM, Dateisystem), Windows über WMI/WinRM (CPU, RAM, Laufwerk, Dienste). Lokaler Puffer (SQLite) bei Verbindungsabbruch, Nachsenden ohne Lücken.
- **Zentrale:** Collector-Schnittstelle (`/api/collector/config`, `/api/collector/results`) mit Token; Sensorstatus aus Schwellwerten, Alarme eröffnen/nachführen/beheben, Ereignisse; Sensoren ohne Messwerte → „unbekannt“, Collector ohne Lebenszeichen → Warnung/Kritisch.
- **Verwaltung in der Oberfläche:** Zugangsprofile (verschlüsselt mit `NEXUS_SECRET_KEY`, nie angezeigt), Geräte (mit Standard-Sensoren je Protokoll), Sensoren (typabhängige Einstellungen, Schwellwerte, Intervall), Pausieren, Standorte, Remote-Collectoren mit einmalig angezeigtem Token.
- **Demo-Daten** sind markiert und werden nie abgefragt (Migration 0002).
- Verfügbarkeit: Anteil ausgefallener Ping-Messungen je Intervall (zählt auch einzelne Ausfälle bei dichten Messungen).
- Compose: Dienst `collector` (Profil `backend`), `collector/docker-compose.remote.yml` für Standorte; `start-nexus.ps1` erzeugt fehlende `NEXUS_SECRET_KEY`/`NEXUS_COLLECTOR_TOKEN`.
- Tests: Backend 49, Collector 30 (gegen echte SNMP-, SSH-, DNS-, HTTP-Dienste; WinRM nachgebildet), Frontend 25; Ende-zu-Ende mit Backend, Collector und Browser geprüft.

## 0.3.1

- **Erscheinungsbild J.Schneider Elektrotechnik:** Firmenlogo (SVG von www.j-schneider.de) statt Schriftzug „NEXUS Monitor“ in der Seitenleiste und auf der Anmeldeseite, Favicon aus der Bildmarke, Hausfarben (Navy `#041C33`/`#062747`, Blau `#143C89`), Schrift Ubuntu.
- Logo und Schrift sind mitgebaut (`frontend/src/assets/firmenlogo.svg`, Paket `@fontsource/ubuntu`) – kein Abruf aus dem Internet.

