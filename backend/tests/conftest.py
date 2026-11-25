"""Testumgebung: echte PostgreSQL-Datenbank (KEIN Mocking der Datenbank).

Die Verbindung kommt aus NEXUS_TEST_DB_URL, z. B.
    NEXUS_TEST_DB_URL=postgresql://nexus:nexus@localhost:5432/nexus_test pytest
Die Datenbank wird bei jedem Testlauf geleert – niemals eine produktive Datenbank angeben!
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

TEST_DB_URL = os.environ.get("NEXUS_TEST_DB_URL")
if not TEST_DB_URL:
    pytest.exit("NEXUS_TEST_DB_URL ist nicht gesetzt (Test-Datenbank, wird geleert).", returncode=2)

ADMIN_PASSWORD = "Admin-Test-Passwort-1"
OPERATOR_PASSWORD = "Operator-Test-Passwort-1"
READER_PASSWORD = "Reader-Test-Passwort-1"
SECRET_KEY = "test-geheimschluessel-0123456789"
COLLECTOR_TOKEN = "test-collector-token-0123456789"
COLLECTOR = {"X-Collector-Token": COLLECTOR_TOKEN}


def _reset_database() -> None:
    url = TEST_DB_URL.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


@pytest.fixture(scope="session")
def app():
    _reset_database()
    os.environ.update(
        NEXUS_DB_URL=TEST_DB_URL,
        NEXUS_SEED_DEMO="true",
        NEXUS_ADMIN_LOGIN="admin",
        NEXUS_ADMIN_PASSWORD=ADMIN_PASSWORD,
        NEXUS_RUN_MIGRATIONS="true",
        NEXUS_SECRET_KEY=SECRET_KEY,
        NEXUS_COLLECTOR_TOKEN=COLLECTOR_TOKEN,
        NEXUS_STALE_CHECK_SEC="0",
    )
    from app.config import get_settings
    from app.db import reset_engine

    get_settings.cache_clear()
    reset_engine()

    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:  # führt den Start aus: Migration, Admin, Demo-Daten
        _create_test_users()
        yield application, client
    reset_engine()


def _create_test_users() -> None:
    from app import models as m
    from app.db import session_scope
    from app.security import hash_password

    with session_scope() as db:
        db.add(m.User(id="usr-op", login="operator", name="Test Operator", email="", role="Operator",
                      password_hash=hash_password(OPERATOR_PASSWORD)))
        db.add(m.User(id="usr-ro", login="leser", name="Test Leser", email="", role="Nur Lesen",
                      password_hash=hash_password(READER_PASSWORD)))
        db.commit()


@pytest.fixture(scope="session")
def client(app) -> TestClient:
    return app[1]


@pytest.fixture(autouse=True)
def _reset_login_limits():
    from app.auth import reset_failures

    reset_failures()
    yield
    reset_failures()


def login(client: TestClient, user: str, password: str) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"login": user, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def admin(client) -> dict[str, str]:
    return login(client, "admin", ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def operator(client) -> dict[str, str]:
    return login(client, "operator", OPERATOR_PASSWORD)


@pytest.fixture(scope="session")
def reader(client) -> dict[str, str]:
    return login(client, "leser", READER_PASSWORD)
