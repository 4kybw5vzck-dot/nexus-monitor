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
