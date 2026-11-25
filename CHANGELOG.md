# Änderungsprotokoll

## 0.1.0 – Phase 1

- Monitoring-Oberfläche (React/TypeScript, Dark Mode) mit Dashboard, Devices, Sensors, Network Maps, Sites, Alerts, Reports, Discovery, Collectors und Administration
- Deterministische Mock-Datenquelle: 24 Geräte, 115 Sensoren, 3 Standorte, aktive und behobene Alarme
- Datenquellen-Interface als Vorbereitung für das FastAPI-Backend
- Docker-Image für das Frontend (nginx ohne Root, Healthcheck, Laufzeit-Konfiguration)
- docker-compose mit vorbereiteter TimescaleDB, `.env.example`, Sicherungs- und Wiederherstellungsskripte
- Tests für Statuslogik, Router und Konsistenz der Mock-Daten
