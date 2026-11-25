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

