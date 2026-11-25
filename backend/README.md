# Backend (Phase 2 – noch nicht umgesetzt)

Geplant: Python 3.12+ mit FastAPI, SQLAlchemy 2, Alembic, PostgreSQL/TimescaleDB.

Vorgaben für die Umsetzung:

- REST-Endpunkte gemäß `docs/ARCHITEKTUR.md` (bilden `MonitoringDataSource` des Frontends ab)
- Konfiguration ausschließlich über Umgebungsvariablen (`NEXUS_DB_URL`, `NEXUS_SECRET_KEY`, …)
- Healthcheck `GET /api/health`
- Container ohne Root-Rechte, Dienstdefinition in `docker-compose.yml` ist vorbereitet (auskommentiert)
- Migrationen versioniert mit Alembic, automatische Ausführung beim Start
- Tests mit pytest
