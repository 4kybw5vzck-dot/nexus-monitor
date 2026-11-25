# NEXUS Monitor – Architektur

## Zielbild

```
                    ┌──────────────────────── Zentrale ────────────────────────┐
  Browser ──HTTPS──▶│  frontend (nginx)  ──/api──▶  backend (FastAPI)          │
                    │                                   │                      │
                    │                       ┌───────────┴───────────┐          │
                    │                       ▼                       ▼          │
                    │              PostgreSQL (Stamm-   TimescaleDB (Messwerte, │
                    │              daten, Konfig)       Hypertables)           │
                    └───────────────────────▲──────────────────────────────────┘
                                            │ HTTPS (Push, gepuffert)
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
     collector Standort A          collector Standort B          collector Standort C
     SNMP · ICMP · WMI · SSH        …                             …
```

- **Zentrale Plattform:** Frontend, Backend, Datenbank. Läuft vollständig lokal, ohne Internet.
- **Remote-Collector je Standort:** misst lokal, puffert bei WAN-Ausfall und überträgt nachträglich. Der Collector baut die Verbindung zur Zentrale auf (keine eingehenden Ports am Standort nötig).
- **Datenbank:** Eine PostgreSQL-Instanz mit TimescaleDB-Erweiterung. Stammdaten in normalen Tabellen, Messwerte in Hypertables mit Kompression und Aufbewahrungsregeln.

## Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Frontend mit Mock-Daten, Containerstruktur vorbereitet | **umgesetzt** |
| 2 | Backend (FastAPI), Datenbankschema, Authentifizierung, `HttpDataSource` | vorbereitet |
| 3 | Monitoring-Engine: ICMP, SNMP, WMI, SSH, HTTP, DNS; Remote-Collector | geplant |
| 4 | Alarmierung, Reporting, erweiterte Netzwerkkarten | geplant |
| 5 | Import der PRTG-Konfiguration und relevanter Historie | geplant |
| 6 | Parallelbetrieb und Ablösung von PRTG | geplant |

## Frontend

### Schichten

| Schicht | Ordner | Verantwortung |
|---|---|---|
| Domäne | `src/api/types.ts` | Typen: Site, Device, Sensor, Alert, Link, Collector … |
| Schnittstelle | `src/api/dataSource.ts` | `MonitoringDataSource` – einziger Zugang der Seiten zu Daten |
| Implementierung | `src/api/mockDataSource.ts` | Phase 1: In-Memory-Daten; Phase 2: `HttpDataSource` |
| Mock-Erzeugung | `src/mock/*` | Stammdaten, Sensor-Vorlagen je Gerätetyp, Störungsszenarien, Verlaufsgenerator |
| Darstellung | `src/pages`, `src/components` | Seiten und wiederverwendbare Bausteine |

### Datenfluss

`useData(() => dataSource.getX())` lädt asynchron und abonniert Änderungen (`subscribe`). Bestätigt jemand einen Alarm, benachrichtigt die Datenquelle alle Abonnenten; Seitenleiste, Dashboard und Alarmliste aktualisieren sich automatisch. Mit dem Backend kann `subscribe` später über WebSocket/Server-Sent Events gespeist werden.

### Umstieg auf das Backend (Phase 2)

1. `src/api/httpDataSource.ts` anlegen, die `MonitoringDataSource` per `fetch(appConfig.apiBaseUrl + …)` umsetzt.
2. In `src/api/index.ts` bei `appConfig.dataSource === 'http'` diese Klasse erzeugen.
3. Im Container `NEXUS_DATA_SOURCE=http` setzen und in `frontend/docker/nginx.conf` den `/api/`-Proxy aktivieren.

Seiten und Komponenten bleiben unverändert.

### Bewusste Eigenentwicklungen

| Baustein | Grund |
|---|---|
| Hash-Router (`app/router.tsx`, ca. 100 Zeilen) | Funktioniert hinter jedem Webserver/Proxy ohne Rewrite-Regeln |
| SVG-Diagramme (`components/charts`) | Keine Abhängigkeit, volle Kontrolle über Darstellung, offline |
| Icon-Set (`components/ui/Icon.tsx`) | Keine Icon-Bibliothek nötig |

Sollte der Diagrammbedarf deutlich wachsen (z. B. Zoom in Zeitreihen über Monate, Heatmaps), ist der Wechsel auf eine Bibliothek wie ECharts oder Recharts möglich, ohne Seiten umzubauen: Die Seiten nutzen nur `TimeSeriesChart`, `DonutChart` usw. Ein solcher Wechsel wäre eine Architekturentscheidung und wird vorher abgestimmt.

## REST-API-Entwurf (Phase 2)

Die Endpunkte bilden das Interface `MonitoringDataSource` ab:

| Methode | Pfad | Entspricht |
|---|---|---|
| GET | `/api/summary` | `getSummary()` |
| GET | `/api/sites`, `/api/sites/{id}` | `getSites()`, `getSite()` |
| GET | `/api/devices`, `/api/devices/{id}` | `getDevices()`, `getDevice()` |
| GET | `/api/sensors?device_id=` | `getSensors()` |
| GET | `/api/sensors/{id}/history?hours=` | `getSensorHistory()` |
| GET | `/api/metrics/aggregate?metric=&hours=` | `getAggregateSeries()` |
| GET | `/api/availability?hours=` | `getAvailability()` |
| GET | `/api/alerts` | `getAlerts()` |
| POST | `/api/alerts/{id}/acknowledge` | `acknowledgeAlert()` |
| GET | `/api/events?limit=`, `/api/devices/{id}/events` | `getEvents()`, `getDeviceEvents()` |
| GET | `/api/links`, `/api/collectors`, `/api/users`, `/api/notification-rules`, `/api/reports` | … |
| POST | `/api/discovery` (asynchroner Job) | `runDiscovery()` |
| GET | `/api/health` | Healthcheck |

Zeitstempel: ISO 8601 in UTC. Feldnamen wie in `types.ts` (camelCase im JSON).

## Datenmodell (Entwurf Phase 2)

- `sites`, `devices`, `sensors`, `sensor_thresholds`, `links`, `collectors`, `users`, `roles`, `notification_rules`, `credential_profiles` (verschlüsselt), `alerts`, `events`
- `measurements(time, sensor_id, value)` als TimescaleDB-Hypertable mit Continuous Aggregates (5 Min., 1 Std., 1 Tag) für schnelle Diagramme über lange Zeiträume
- Migrationen mit Alembic, versioniert im Repository

## Sicherheit

- Keine Zugangsdaten im Code oder in Gerätedaten – Geräte verweisen nur auf **Zugangsprofile**.
- Geheimnisse ausschließlich über `.env` (nicht in Git).
- Container laufen ohne Root-Rechte (Frontend: `nginx-unprivileged`).
- Datenbank wird nicht nach außen veröffentlicht.
