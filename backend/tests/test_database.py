from pathlib import Path

from alembic import command
from alembic.config import Config

from app import models as m
from app.db import get_engine, session_scope
from app.seed import ensure_admin, seed_demo
from app.config import get_settings


def test_migrations_match_models(app):
    """Modelle und Migrationen sind deckungsgleich (keine vergessene Migration)."""
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(m.__file__).parent / "migrations"))
    with get_engine().connect() as conn:
        cfg.attributes["connection"] = conn
        command.check(cfg)  # wirft eine Ausnahme bei Abweichungen


def test_seed_only_into_empty_database(app):
    with session_scope() as db:
        assert seed_demo(db) is False


def test_ensure_admin_is_idempotent(app):
    with session_scope() as db:
        before = db.query(m.User).count()
        ensure_admin(db, get_settings())
        assert db.query(m.User).count() == before


def test_measurements_loaded(app):
    with session_scope() as db:
        assert db.query(m.Measurement).count() > 90_000


def test_cli_set_password(client):
    import pytest

    from app.cli import set_password

    set_password("m.berger", "Neues-Demo-Passwort-1")  # Demo-Benutzer ohne Passwort wird anmeldefähig
    r = client.post("/api/auth/login", json={"login": "m.berger", "password": "Neues-Demo-Passwort-1"})
    assert r.status_code == 200
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    set_password("m.berger", "Noch-ein-Passwort-2")  # beendet bestehende Sitzungen
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    with pytest.raises(SystemExit):
        set_password("m.berger", "kurz")
    with pytest.raises(SystemExit):
        set_password("gibt-es-nicht", "Langes-Passwort-3")
