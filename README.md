# NEXUS Monitor

Eigenständige, vollständig lokal betreibbare Network-Monitoring-Plattform als langfristiger Ersatz für Paessler PRTG.

> **Stand: Phase 1 – Frontend mit Mock-Daten.**
> Alle Geräte, Standorte, Personen und Messwerte sind fiktiv. IP-Adressen stammen ausschließlich aus den Dokumentationsbereichen nach RFC 5737. Es gibt keine Verbindung zu PRTG, keine SNMP-Abfragen, keine Netzwerkscans und keine Cloud-Anbindung.

## Funktionsumfang Phase 1

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
npm install
npm run dev
```

Danach im Browser `http://localhost:5173` öffnen.

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typprüfung und Produktions-Build nach `frontend/dist` |
| `npm run preview` | Produktions-Build lokal ansehen |
| `npm test` | Automatisierte Tests (Vitest) |
| `npm run typecheck` | Nur TypeScript-Prüfung |

Host und Port des Entwicklungsservers: Umgebungsvariablen `NEXUS_DEV_HOST` und `NEXUS_DEV_PORT`.

## Start mit Docker

Voraussetzung: Docker Engine mit Compose-Plugin (Linux) oder Docker Desktop (Windows/macOS).

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
docker compose up -d --build
```

Unter Windows geht es auch mit einem Schritt: in PowerShell im Projektordner `.\start-nexus.ps1` ausführen (legt `.env` an, baut, startet und öffnet den Browser).

Oberfläche: `http://<server>:8080` (Port über `NEXUS_HTTP_PORT` in `.env`). Details zu Installation, Update, Sicherung und Umzug: [docs/BETRIEB.md](docs/BETRIEB.md).

## Projektstruktur

```
nexus-monitor/
├── docker-compose.yml        Alle Dienste; Phase-2/3-Dienste über Profile vorbereitet
├── .env.example              Dokumentierte Konfigurationsvorlage
├── scripts/
│   ├── backup.sh             Sicherung (Konfiguration + Datenbank) in ein Archiv
│   └── restore.sh            Wiederherstellung, auch auf neuem Server
├── docs/
│   ├── ARCHITEKTUR.md        Zielarchitektur, Datenmodell, Schnittstellen
│   └── BETRIEB.md            Installation, Update, Migration, Backup
├── backend/                  Phase 2: Python/FastAPI (Platzhalter)
├── collector/                Phase 3: Remote-Collector (Platzhalter)
└── frontend/
    ├── Dockerfile            Mehrstufiger Build → unprivilegierter nginx
    ├── docker/               nginx-Konfiguration, Laufzeit-Konfiguration
    ├── public/config.js      Laufzeit-Konfiguration (im Container erzeugt)
    ├── tests/                Vitest-Tests (Statuslogik, Mock-Konsistenz, Router)
    └── src/
        ├── api/              Domänentypen, Datenquellen-Interface, MockDataSource
        ├── mock/             Stammdaten, Sensor-Vorlagen, Szenarien, Generator
        ├── app/              Router, Konfiguration, Sitzung
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

- **Trennung von Daten und Darstellung:** Seiten sprechen nur mit `MonitoringDataSource` (`src/api/dataSource.ts`). Für das Backend wird eine `HttpDataSource` ergänzt und in `src/api/index.ts` ausgewählt – Seiten bleiben unverändert.
- **Minimale Abhängigkeiten:** Laufzeit nur `react` und `react-dom`. Diagramme, Icons und Router sind schlanke Eigenentwicklungen – keine CDN-Ressourcen, keine externen Schriften, vollständig offline lauffähig.
- **Ein Image für alle Umgebungen:** Einstellungen kommen beim Containerstart aus Umgebungsvariablen (`config.js`), nicht aus dem Build.

Ausführlich: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Entwicklungsregeln

Modular und dokumentiert · keine fest codierten Zugangsdaten, IPs oder Hostnamen · keine Cloud-Pflichtdienste · Tests für wichtige Funktionen · jede größere Änderung als Git-Commit · Architekturänderungen nur nach Rücksprache.
