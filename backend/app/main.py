"""NEXUS Monitor – FastAPI-Anwendung.

Start (Container):  uvicorn app.main:app --host 0.0.0.0 --port 8000
Beim Start: Migrationen ausführen → Administratorkonto sicherstellen → optional Demo-Daten laden.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import text

from . import __version__
from .api import public, router
from .auth import router as auth_router
from .users import router as users_router
from .manage import router as manage_router
from .collector_api import StaleWatcher, ensure_central_collector
from .collector_api import router as collector_router
from .config import get_settings
from .db import get_engine, session_scope
from .seed import ensure_admin, seed_demo

log = logging.getLogger("nexus")

# Verhindert, dass mehrere Backend-Instanzen gleichzeitig migrieren
_MIGRATION_LOCK_ID = 7_400_201


def run_migrations() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    with get_engine().connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _MIGRATION_LOCK_ID})
        try:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")
            conn.commit()
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _MIGRATION_LOCK_ID})
            conn.commit()


def startup() -> None:
    settings = get_settings()
    if settings.run_migrations:
        log.info("Datenbankmigrationen werden ausgeführt …")
        run_migrations()
    with session_scope() as db:
        ensure_admin(db, settings)
        ensure_central_collector(db, settings)
        if settings.seed_demo and seed_demo(db):
            log.warning("Demo-Datensatz geladen (NEXUS_SEED_DEMO=true) – nicht für den Produktivbetrieb.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=get_settings().log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    startup()
    watcher = None
    if get_settings().stale_check_sec > 0:
        watcher = StaleWatcher(get_settings().stale_check_sec)
        watcher.start()
    log.info("NEXUS Monitor Backend %s bereit", __version__)
    yield
    if watcher:
        watcher.stop()


def create_app(run_startup: bool = True) -> FastAPI:
    app = FastAPI(
        title="NEXUS Monitor API",
        version=__version__,
        lifespan=lifespan if run_startup else None,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(public)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(manage_router)
    app.include_router(collector_router)
    app.include_router(router)
    return app


app = create_app()
