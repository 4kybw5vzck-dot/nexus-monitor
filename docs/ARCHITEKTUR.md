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
| 2 | Backend (FastAPI), Datenbankschema, Authentifizierung, `HttpDataSource` | **umgesetzt** (Messwerte vorerst Demo-Datensatz) |
| 3 | Monitoring-Engine: ICMP, SNMP, WMI (WinRM), SSH, HTTP, DNS; Remote-Collector | **umgesetzt** (echte Discovery folgt) |
| 4 | Alarmierung, Reporting, erweiterte Netzwerkkarten | geplant |
| 5 | Import der PRTG-Konfiguration und relevanter Historie | geplant |
| 6 | Parallelbetrieb und Ablösung von PRTG | geplant |

## Frontend

### Schichten

| Schicht | Ordner | Verantwortung |
|---|---|---|
| Domäne | `src/api/types.ts` | Typen: Site, Device, Sensor, Alert, Link, Collector … |
| Schnittstelle | `src/api/dataSource.ts` | `MonitoringDataSource` – einziger Zugang der Seiten zu Daten |
| Implementierung | `src/api/mockDataSource.ts`, `src/api/httpDataSource.ts` | Mock: In-Memory-Daten · HTTP: FastAPI-Backend mit Anmeldung |
| Mock-Erzeugung | `src/mock/*` | Stammdaten, Sensor-Vorlagen je Gerätetyp, Störungsszenarien, Verlaufsgenerator |
| Darstellung | `src/pages`, `src/components` | Seiten und wiederverwendbare Bausteine |

### Datenfluss

`useData(() => dataSource.getX())` lädt asynchron und abonniert Änderungen (`subscribe`). Bestätigt jemand einen Alarm, benachrichtigt die Datenquelle alle Abonnenten; Seitenleiste, Dashboard und Alarmliste aktualisieren sich automatisch. Mit dem Backend kann `subscribe` später über WebSocket/Server-Sent Events gespeist werden.

### Datenquelle wählen

`NEXUS_DATA_SOURCE` (Laufzeit-Konfiguration `config.js`) entscheidet in `src/api/index.ts`:

- `mock` – `MockDataSource`, keine Anmeldung, fester Demo-Benutzer.
- `http` – `HttpDataSource` gegen `appConfig.apiBaseUrl` (Standard `/api`, nginx leitet an das Backend weiter). Ohne gültige Sitzung zeigt `App.tsx` die Anmeldeseite; eine 401-Antwort beendet die Sitzung (`src/app/session.ts`, gespeichert in `sessionStorage`). Schaltflächen zum Bestätigen und für Discovery erscheinen nur für Operator und Administrator.

Seiten und Komponenten sind für beide Datenquellen identisch.

### Bewusste Eigenentwicklungen

| Baustein | Grund |
|---|---|
| Hash-Router (`app/router.tsx`, ca. 100 Zeilen) | Funktioniert hinter jedem Webserver/Proxy ohne Rewrite-Regeln |
| SVG-Diagramme (`components/charts`) | Keine Abhängigkeit, volle Kontrolle über Darstellung, offline |
| Icon-Set (`components/ui/Icon.tsx`) | Keine Icon-Bibliothek nötig |

Sollte der Diagrammbedarf deutlich wachsen (z. B. Zoom in Zeitreihen über Monate, Heatmaps), ist der Wechsel auf eine Bibliothek wie ECharts oder Recharts möglich, ohne Seiten umzubauen: Die Seiten nutzen nur `TimeSeriesChart`, `DonutChart` usw. Ein solcher Wechsel wäre eine Architekturentscheidung und wird vorher abgestimmt.

## Backend (Phase 2)

| Baustein | Datei | Aufgabe |
|---|---|---|
| Konfiguration | `backend/app/config.py` | Nur Umgebungsvariablen `NEXUS_*`; DB-Verbindung aus Einzelwerten (Passwörter mit Sonderzeichen ohne URL-Maskierung) |
| Datenmodell | `backend/app/models.py` | SQLAlchemy 2 |
| Migrationen | `backend/app/migrations/` | Alembic, beim Start automatisch (Advisory-Lock gegen parallele Ausführung) |
| Abfragen | `backend/app/services.py` | Ableitungen und Zeitreihen in SQL |
| Endpunkte | `backend/app/api.py`, `backend/app/auth.py` | REST-API, Anmeldung, Rollen |
| Erststart | `backend/app/seed/` | Administratorkonto, optional Demo-Datensatz |
| Verwaltung | `backend/app/cli.py` | `set-password` |

Synchrones SQLAlchemy mit psycopg 3: einfacher als async und für die zu erwartende Last ausreichend (FastAPI führt synchrone Endpunkte in einem Thread-Pool aus).

### REST-API

Die Endpunkte bilden das Interface `MonitoringDataSource` ab:

| Methode | Pfad | Entspricht | Rolle |
|---|---|---|---|
| GET | `/api/summary` | `getSummary()` | angemeldet |
| GET | `/api/sites`, `/api/sites/{id}` | `getSites()`, `getSite()` | angemeldet |
| GET | `/api/devices`, `/api/devices/{id}` | `getDevices()`, `getDevice()` | angemeldet |
| GET | `/api/sensors?device_id=`, `/api/sensors/{id}` | `getSensors()`, `getSensor()` | angemeldet |
| GET | `/api/sensors/{id}/history?hours=` | `getSensorHistory()` | angemeldet |
| GET | `/api/metrics/aggregate?metric=&hours=` | `getAggregateSeries()` | angemeldet |
| GET | `/api/availability?hours=` | `getAvailability()` | angemeldet |
| GET | `/api/alerts` | `getAlerts()` | angemeldet |
| POST | `/api/alerts/{id}/acknowledge` | `acknowledgeAlert()` – Benutzer aus der Anmeldung | Operator, Administrator |
| GET | `/api/events?limit=`, `/api/devices/{id}/events` | `getEvents()`, `getDeviceEvents()` | angemeldet |
| GET | `/api/links`, `/api/collectors`, `/api/users`, `/api/notification-rules`, `/api/reports` | … | angemeldet |
| POST | `/api/discovery` | `runDiscovery()` – **simuliert**, kein Netzwerkzugriff | Operator, Administrator |
| POST | `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/me` | Anmeldung | – |
| GET | `/api/health` | Healthcheck | – |
| POST/PATCH/DELETE | `/api/devices`, `/api/devices/{id}/sensors`, `/api/sensors/{id}` | Geräte und Sensoren verwalten | Operator, Administrator |
| GET/POST/PATCH/DELETE | `/api/credential-profiles`, `/api/sites`, `/api/collectors` (+ `/token`) | Zugangsprofile, Standorte, Collectors | Lesen angemeldet, Ändern Administrator |
| POST/PATCH/DELETE | `/api/users`, `/api/users/{id}/password`; POST `/api/auth/password` | Benutzer, Passwörter | Administrator bzw. selbst |
| GET | `/api/catalog` | Sensortypen, Standardwerte, Felder der Zugangsprofile | angemeldet |
| GET/POST | `/api/collector/config`, `/api/collector/results` | Collector-Schnittstelle | Collector-Token |

Zeitstempel: ISO 8601 in UTC mit `Z`. Feldnamen wie in `types.ts` (camelCase im JSON). Fehler: `{"detail": "<deutsche Meldung>"}`. OpenAPI-Beschreibung unter `/api/docs`.

`hours` ist auf 1–2160 (90 Tage) begrenzt. Auflösung wie im Frontend: bis 24 h 5 Minuten, bis 7 Tage 30 Minuten, darüber 2 Stunden (`date_bin`, Standard-PostgreSQL – funktioniert mit und ohne TimescaleDB).

### Abgeleitete Werte (nicht gespeichert)

- Gerätestatus = schlechtester Sensorstatus (`critical > warning > unknown > ok > paused`), Sensoranzahl, letzter Kontakt (jüngster Sensor-Check), Laufzeit aus `boot_time`.
- Standort eines Alarms über das Gerät.
- Sensoranzahl je Collector: zentral = alle, remote = Sensoren am Standort.
- Verfügbarkeit: Anteil der Intervalle, deren Ping-Mittelwert unter der kritischen Schwelle liegt.
- WAN-Traffic ein/aus: Summe der Sensoren „Traffic WAN“, vorläufig im Verhältnis 68/32 aufgeteilt wie im Mock – bis die Monitoring-Engine getrennte Kanäle liefert (Phase 3).

## Collector (Phase 3)

Ein Python-Paket (`collector/`), ein Image für zentralen und Remote-Collector. Details: `collector/README.md`.

| Schritt | Schnittstelle |
|---|---|
| Anmeldung | Header `X-Collector-Token`; in der Zentrale nur SHA-256-Hash (`collectors.token_hash`). Zentraler Collector: `NEXUS_COLLECTOR_TOKEN`, Remote-Collector: Token aus der Oberfläche |
| Konfiguration | `GET /api/collector/config` – eigene Geräte (Gerät ohne Collector → zentraler Collector `col-central`), nicht pausiert, keine Demo-Geräte; Zugangsdaten entschlüsselt |
| Ergebnisse | `POST /api/collector/results` – bis 5000 je Anfrage, idempotent (`measurements` PK sensor_id+time), dazu Status des Collectors (Version, CPU, RAM, Puffer, letzter Fehler) |

Auswertung in der Zentrale (`backend/app/collector_api.py`): neuester Wert wird Sensorstatus (Schwellwerte), ältere gepufferte Werte landen nur im Verlauf. Statuswechsel nach Warnung/Kritisch eröffnet einen Alarm (einer je Sensor, Schwere wird nachgeführt), Rückkehr zu OK behebt ihn; Ereignisse für jeden Wechsel. Ping-Ausfälle werden als Messpunkt über der kritischen Schwelle gespeichert, damit die Verfügbarkeit stimmt. Ein Hintergrundjob setzt Sensoren ohne Messwert seit 3 × Intervall + 2 Min. auf „unbekannt“ und Collectors ohne Lebenszeichen auf Warnung (3 Min.) bzw. Kritisch (10 Min.).

**Verfügbarkeit:** je Intervall der Anteil ausgefallener Ping-Messungen, gemittelt über alle Intervalle.

**Entscheidung WMI über WinRM:** gleiche WMI/CIM-Klassen, aber über WS-Management (pywinrm, NTLM) statt DCOM. DCOM aus einem Linux-Container bräuchte impacket, das Virenscanner oft als Angriffswerkzeug melden. Klassisches DCOM kann später als eigene Prüfung ergänzt werden.

## Datenmodell

Tabellen: `sites`, `collectors`, `devices`, `sensors`, `measurements`, `links`, `alerts`, `events`, `users`, `auth_sessions`, `credential_profiles`, `notification_rules`, `reports`.

- **Messwerte:** `measurements(sensor_id, time, value)`, Primärschlüssel `(sensor_id, time)`. Ist TimescaleDB verfügbar, macht die Migration daraus eine Hypertable (Chunks je Tag) mit Kompression ab 7 Tagen (segmentiert nach Sensor). Ohne TimescaleDB bleibt es eine normale Tabelle.
- **Schwellwerte** stehen direkt am Sensor (`warning_threshold`, `critical_threshold`, `inverted`) – 1:1, daher keine eigene Tabelle.
- **Rollen** sind ein fester Wertebereich (CHECK-Constraint): Administrator, Operator, Nur Lesen.
- **Zugangsprofile:** Geräte verweisen auf `credential_profiles`. `secret_ciphertext` enthält die Zugangsdaten als JSON, verschlüsselt mit Fernet (Schlüssel per HKDF aus `NEXUS_SECRET_KEY`). Die API gibt nur nicht geheime Felder (Benutzer, Port) aus; Klartext erhält nur ein angemeldeter Collector.
- **Phase 3 (Migration 0002):** `devices.collector_id/paused/is_demo`, `sensors.settings` (JSONB, Prüfparameter)/`paused`/`status_since`, `collectors.token_hash/is_demo/last_error`, `credential_profiles.description`.
- Wertebereiche (Gerätetyp, Sensortyp, Status …) sind per CHECK-Constraint abgesichert.

Geplant, sobald die Datenmenge es erfordert: Continuous Aggregates (5 Min. / 1 Std. / 1 Tag) und Aufbewahrungsregeln je Auflösung.

### Demo-Datensatz

`frontend/scripts/export-demo-data.ts` (`npm run export:demo`) exportiert den Mock-Bestand samt 30 Tagen Verlauf nach `backend/app/seed/demo_data.json.gz` (≈ 110 KiB). So zeigen Mock- und HTTP-Modus dieselben Daten; die Backend-Tests prüfen das gegen die Kennzahlen des Mocks.

## Sicherheit

- Keine Zugangsdaten im Code oder in Gerätedaten – Geräte verweisen nur auf **Zugangsprofile**.
- Geheimnisse ausschließlich über `.env` (nicht in Git).
- Container laufen ohne Root-Rechte (Frontend: `nginx-unprivileged`, Backend: Benutzer `nexus`, UID 10001).
- Datenbank und Backend werden nicht nach außen veröffentlicht; Zugriff nur über den Proxy der Oberfläche.
- Passwörter: scrypt mit Salz je Passwort (Python-Standardbibliothek). Sitzungen: zufälliges 256-Bit-Token, in der Datenbank nur als SHA-256-Hash; Abmelden und Passwortänderung beenden Sitzungen serverseitig.
- Schutz gegen Passwort-Raten: Sperre nach 5 Fehlversuchen je Benutzername bzw. Client-Adresse für 5 Minuten (im Speicher des Backends).
- Gleiche Fehlermeldung für unbekannte Benutzer und falsche Passwörter.
