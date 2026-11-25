# NEXUS Monitor

Eigenständige, vollständig lokal betreibbare Network-Monitoring-Plattform als langfristiger Ersatz für Paessler PRTG.

> **Stand: Phase 3 – Monitoring-Engine.**
> Oberfläche, REST-API (FastAPI), PostgreSQL/TimescaleDB, Anmeldung und Benutzerverwaltung sowie echte Messungen über einen Collector: Ping, SNMP v2c/v3, HTTP, DNS, SSH (Linux) und WMI über WinRM (Windows). Geräte, Sensoren, Zugangsprofile (verschlüsselt), Standorte und Remote-Collectoren werden in der Oberfläche verwaltet. Noch offen: echte Discovery (Netzwerkscan), Benachrichtigungen, Reports aus echten Daten, PRTG-Import. Die Demo-Daten sind fiktiv (IP-Adressen nach RFC 5737) und werden nie abgefragt.

Zwei Betriebsarten (Einstellung in `.env`):

| Betriebsart | Inhalt |
|---|---|
| **Mock** (Standard) | Nur Oberfläche, Beispieldaten im Browser, keine Anmeldung |
| **Backend** | Oberfläche + Backend + Datenbank + Collector, Anmeldung mit Rollen, echte Messungen (optional zusätzlich Demo-Datensatz) |

## Funktionsumfang der Oberfläche

| Bereich | Inhalt |
|---|---|
| **Dashboard** | Kennzahlen (Geräte, Sensoren, OK/Warnung/Kritisch, Verfügbarkeit), WAN-Traffic, CPU, RAM, Speicherbelegung, Standortstatus, aktuelle Alarme, letzte Ereignisse – Zeitraum 6 Std. / 24 Std. / 7 Tage |
| **Devices** | Sortier- und filterbare Geräteliste (Suche, Standort, Typ, Status); Detailseite mit Tabs *Übersicht, Sensoren, Historie, Konfiguration* |
| **Sensors** | Alle 115 Sensoren mit Statusfiltern; Detailansicht mit Verlauf (24 Std. / 7 / 30 Tage) und Schwellwerten |
| **Network Maps** | Topologie je Standort mit WAN-Strecken, Verbindungsstatus, Hervorhebung, Zoom und Detailpanel |
| **Sites** | Drei Standorte mit Status, Verfügbarkeit, Collector und Geräten |
| **Alerts** | Offen / Kritisch / Warnungen / Normalisiert / Alle, Einzel- und Sammelbestätigung |
| **Reports** | Verfügbarkeit, Top-Bandbreite, Speicherkapazität, Alarmhistorie, SLA Produktion – CSV-Export im Browser |
| **Discovery** | Simulierter Scan (ausdrücklich ohne echten Netzwerkzugriff) |
| **Collectors** | Zentrale Plattform und Remote-Collectoren je Standort |
| **Administration** | Benutzer & Rollen, Benachrichtigungsregeln, Systeminfo, Datensicherung |

Globale Suche (Gerätename, IP, Sensor) in der Kopfzeile. Filter und Tabs stehen in der URL und lassen sich als Link weitergeben.

Mock-Bestand: **24 Geräte, 115 Sensoren, 3 Standorte, 10 offene und 8 behobene Alarme**. Die Daten werden deterministisch erzeugt und sind in der gesamten Anwendung konsistent (Gerätestatus = schlechtester Sensorstatus, Alarme entstehen aus Sensorzuständen).

## Schnellstart (Entwicklung)

Voraussetzung: **Node.js 20 oder neuer** (Windows, Linux oder macOS).

```bash
cd frontend
npm ci
npm run dev
```

> **Hinweis:** Immer `npm ci` verwenden (installiert exakt die Versionen aus `package-lock.json`). `npm install` ohne Lock-Datei bricht mit npm 10 beim Auflösen der optionalen Peer-Abhängigkeiten von Vitest ab (`Cannot read properties of null (reading 'edgesOut')`). Zum Aktualisieren von Paketen npm 11 oder neuer nutzen, z. B. `npx npm@11 install`.

Danach im Browser `http://localhost:5173` öffnen.

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typprüfung und Produktions-Build nach `frontend/dist` |
| `npm run preview` | Produktions-Build lokal ansehen |
| `npm test` | Automatisierte Tests (Vitest) |
| `npm run typecheck` | Nur TypeScript-Prüfung |
| `npm run export:demo` | Demo-Datensatz für das Backend aus den Mock-Daten erzeugen |

Backend entwickeln und testen: [backend/README.md](backend/README.md).

Host und Port des Entwicklungsservers: Umgebungsvariablen `NEXUS_DEV_HOST` und `NEXUS_DEV_PORT`.

## Start mit Docker

Voraussetzung: Docker Engine mit Compose-Plugin (Linux) oder Docker Desktop (Windows/macOS).

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
docker compose up -d --build
```

Unter Windows geht es auch mit einem Schritt: in PowerShell im Projektordner `.\start-nexus.ps1` ausführen (legt `.env` an, baut, startet und öffnet den Browser).

**Mit Backend und Datenbank** – in `.env` setzen, dann wie oben starten:

```ini
COMPOSE_PROFILES=backend
NEXUS_DATA_SOURCE=http
POSTGRES_PASSWORD=<lang und zufällig>
NEXUS_ADMIN_PASSWORD=<Passwort für admin>     # leer = wird erzeugt und im Log angezeigt
NEXUS_SEED_DEMO=true                           # optional: Beispieldaten laden
```

Anmeldung mit `admin` und dem gesetzten bzw. erzeugten Passwort. Details: [docs/BETRIEB.md](docs/BETRIEB.md#betrieb-mit-backend-und-datenbank).

Oberfläche: `http://<server>:8080` (Port über `NEXUS_HTTP_PORT` in `.env`). Details zu Installation, Update, Sicherung und Umzug: [docs/BETRIEB.md](docs/BETRIEB.md).

## Projektstruktur

```
nexus-monitor/
├── docker-compose.yml        Alle Dienste; Phase-2/3-Dienste über Profile vorbereitet
├── .env.example              Dokumentierte Konfigurationsvorlage
├── scripts/
│   ├── backup.sh/.ps1        Sicherung (Konfiguration + Datenbank) in ein Archiv
│   └── restore.sh/.ps1       Wiederherstellung, auch auf neuem Server
├── docs/
│   ├── ARCHITEKTUR.md        Zielarchitektur, Datenmodell, Schnittstellen
│   └── BETRIEB.md            Installation, Update, Migration, Backup
├── backend/                  Python/FastAPI, Alembic-Migrationen, pytest (siehe backend/README.md)
├── collector/                Collector: Ping, SNMP, HTTP, DNS, SSH, WMI (siehe collector/README.md)
└── frontend/
    ├── Dockerfile            Mehrstufiger Build → unprivilegierter nginx
    ├── docker/               nginx-Vorlage (inkl. /api/-Proxy), Laufzeit-Konfiguration
    ├── public/config.js      Laufzeit-Konfiguration (im Container erzeugt)
    ├── scripts/              export-demo-data.ts – Demo-Datensatz für das Backend
    ├── tests/                Vitest-Tests (Statuslogik, Mock-Konsistenz, Router, HttpDataSource)
    └── src/
        ├── api/              Domänentypen, Datenquellen-Interface, MockDataSource, HttpDataSource
        ├── mock/             Stammdaten, Sensor-Vorlagen, Szenarien, Generator
        ├── app/              Router, Konfiguration, Anmeldesitzung
        ├── hooks/            useData – lädt Daten und reagiert auf Änderungen
        ├── components/
        │   ├── layout/       Seitenleiste, Kopfzeile, globale Suche
        │   ├── ui/           Karten, Badges, Tabs, Tabellen, Icons
        │   └── charts/       SVG-Diagramme (Zeitreihe, Ring, Tacho, Säulen, Sparkline)
        ├── pages/            Eine Datei je Navigationsbereich
        ├── styles/           Designsystem (CSS-Variablen, Dark Mode)
        └── utils/            Formatierung (de-DE), Statuslogik
```

## Wichtige Architekturentscheidungen

- **Trennung von Daten und Darstellung:** Seiten sprechen nur mit `MonitoringDataSource` (`src/api/dataSource.ts`). `MockDataSource` oder `HttpDataSource` wird in `src/api/index.ts` nach `NEXUS_DATA_SOURCE` gewählt – Seiten sind für beide identisch.
- **Backend ohne Ballast:** FastAPI, SQLAlchemy, Alembic, psycopg; Passwort-Hashing und Token aus der Python-Standardbibliothek. TimescaleDB wird genutzt, wenn vorhanden, ist aber für Tests und Entwicklung nicht nötig.
- **Minimale Abhängigkeiten:** Laufzeit nur `react` und `react-dom`. Diagramme, Icons und Router sind schlanke Eigenentwicklungen – keine CDN-Ressourcen, keine externen Schriften, vollständig offline lauffähig.
- **Erscheinungsbild:** Logo in `frontend/src/assets/firmenlogo.svg` (Farbe über `currentColor`), Favicon `frontend/public/favicon.svg`, Farben als CSS-Variablen am Anfang von `frontend/src/styles/global.css`, Schrift Ubuntu über `@fontsource/ubuntu`.
- **Ein Image für alle Umgebungen:** Einstellungen kommen beim Containerstart aus Umgebungsvariablen (`config.js`), nicht aus dem Build.

Ausführlich: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Entwicklungsregeln

Modular und dokumentiert · keine fest codierten Zugangsdaten, IPs oder Hostnamen · keine Cloud-Pflichtdienste · Tests für wichtige Funktionen · jede größere Änderung als Git-Commit · Architekturänderungen nur nach Rücksprache.
