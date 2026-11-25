"""Datenbankverbindung (SQLAlchemy 2, synchron mit psycopg 3)."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        _engine = create_engine(get_settings().sqlalchemy_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Nur für Tests: Verbindung nach geänderter Konfiguration neu aufbauen."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def session_scope() -> Session:
    get_engine()
    assert _session_factory is not None
    return _session_factory()


def get_db() -> Iterator[Session]:
    """FastAPI-Abhängigkeit: eine Sitzung je Anfrage."""
    db = session_scope()
    try:
        yield db
    finally:
        db.close()
