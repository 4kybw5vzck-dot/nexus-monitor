# NEXUS Monitor – Backend

Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL (TimescaleDB optional)

REST-API für die Oberfläche (Endpunkte: `docs/ARCHITEKTUR.md`), Anmeldung mit lokalen Benutzern, Datenbankmigrationen beim Start. Betrieb mit Docker: `docs/BETRIEB.md`.

## Aufbau

```
backend/
├── Dockerfile            Image ohne Root, Abhängigkeiten aus requirements.lock
├── pyproject.toml        Abhängigkeiten (Bereiche) und Testkonfiguration
├── requirements.lock     Gepinnte Laufzeit-Abhängigkeiten für das Image
├── alembic.ini           Nur für die Kommandozeile (neue Migrationen erzeugen)
├── app/
│   ├── main.py           FastAPI-App, Start: Migration → Admin → Demo-Daten
│   ├── config.py         Umgebungsvariablen NEXUS_*
│   ├── db.py             Verbindung (psycopg 3)
│   ├── models.py         Datenmodell
│   ├── schemas.py        JSON-Modelle (camelCase wie frontend/src/api/types.ts)
│   ├── services.py       Abfragen, Zeitreihen, Ableitungen
│   ├── api.py            Monitoring-Endpunkte
│   ├── auth.py           Anmeldung, Sitzungen, Rollen
│   ├── security.py       scrypt, Token
│   ├── cli.py            python -m app.cli set-password <login>
│   ├── migrations/       Alembic-Migrationen
│   └── seed/             Administratorkonto, Demo-Datensatz (demo_data.json.gz)
└── tests/                pytest gegen echte PostgreSQL
```

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `NEXUS_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD` | `db` / `5432` / `nexus` / `nexus` / – | Datenbankverbindung |
| `NEXUS_DB_URL` | – | Alternativ vollständige URL (`postgresql://…`) |
| `NEXUS_RUN_MIGRATIONS` | `true` | Migrationen beim Start ausführen |
| `NEXUS_ADMIN_LOGIN` / `NEXUS_ADMIN_PASSWORD` | `admin` / – | Erstes Administratorkonto; ohne Passwort wird eines erzeugt und geloggt |
| `NEXUS_SESSION_HOURS` | `12` | Gültigkeit einer Anmeldung |
| `NEXUS_SEED_DEMO` | `false` | Demo-Datensatz in leere Datenbank laden |
| `NEXUS_SECRET_KEY` | – | Für die Verschlüsselung von Zugangsprofilen (Phase 3) |
| `NEXUS_LOG_LEVEL` | `INFO` | Protokollierung |

## Entwicklung

Voraussetzung: Python ≥ 3.10 und eine PostgreSQL-Datenbank (≥ 14) für Tests – z. B. per Docker:

```bash
docker run -d --name nexus-testdb -e POSTGRES_USER=nexus -e POSTGRES_PASSWORD=nexus \
  -e POSTGRES_DB=nexus_test -p 127.0.0.1:55432:5432 timescale/timescaledb:latest-pg17
```

```bash
cd backend
python -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Tests (die angegebene Datenbank wird GELEERT)
NEXUS_TEST_DB_URL=postgresql://nexus:nexus@localhost:55432/nexus_test pytest

# Entwicklungsserver mit Demo-Daten
NEXUS_DB_URL=postgresql://nexus:nexus@localhost:55432/nexus_test NEXUS_SEED_DEMO=true \
  NEXUS_ADMIN_PASSWORD=admin-passwort uvicorn app.main:app --reload
```

Unter Windows PowerShell Umgebungsvariablen mit `$env:NEXUS_TEST_DB_URL = "…"` setzen.

### Neue Migration

Nach Änderungen an `app/models.py`:

```bash
NEXUS_DB_URL=… alembic revision --autogenerate -m "kurze beschreibung"
```

Die erzeugte Datei unter `app/migrations/versions/` prüfen und mit einchecken. Der Test `test_migrations_match_models` schlägt fehl, solange Modell und Migrationen nicht übereinstimmen.

### Abhängigkeiten aktualisieren

Bereiche in `pyproject.toml` anpassen, dann die Lock-Datei neu erzeugen (Python 3.12, leere Umgebung):

```bash
python -m venv /tmp/lock && /tmp/lock/bin/pip install . \
  && /tmp/lock/bin/pip freeze --exclude nexus-monitor-backend > requirements.lock
```

Die beiden Kommentarzeilen am Anfang von `requirements.lock` danach wieder ergänzen.

### Demo-Datensatz neu erzeugen

Nach Änderungen an den Mock-Daten im Frontend:

```bash
cd frontend && npm run export:demo
```
