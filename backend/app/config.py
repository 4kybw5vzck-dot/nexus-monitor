"""Konfiguration – ausschließlich über Umgebungsvariablen (Präfix NEXUS_).

Es gibt keine fest eingetragenen Hosts oder Zugangsdaten. Die Datenbankverbindung
wird aus Einzelwerten gebaut, damit Passwörter mit Sonderzeichen (/, +, = aus
`openssl rand -base64`) nicht in einer URL maskiert werden müssen.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NEXUS_", extra="ignore")

    # --- Datenbank -----------------------------------------------------------
    # Entweder vollständige URL (NEXUS_DB_URL) …
    db_url: str | None = None
    # … oder Einzelwerte (empfohlen, so setzt es docker-compose)
    db_host: str = "db"
    db_port: int = 5432
    db_name: str = "nexus"
    db_user: str = "nexus"
    db_password: str = ""

    # --- Start ---------------------------------------------------------------
    run_migrations: bool = True
    # Demo-Datensatz in eine LEERE Datenbank laden (nicht für den Produktivbetrieb)
    seed_demo: bool = False

    # --- Anmeldung -----------------------------------------------------------
    # Erstes Administratorkonto. Ohne Passwort wird beim ersten Start ein
    # zufälliges erzeugt und einmalig ins Container-Log geschrieben.
    admin_login: str = "admin"
    admin_password: str = ""
    session_hours: int = Field(default=12, ge=1, le=24 * 30)

    # Für spätere Verschlüsselung von Zugangsprofilen (Phase 3)
    secret_key: str = ""

    log_level: str = "INFO"

    @property
    def sqlalchemy_url(self) -> URL:
        if self.db_url:
            url = make_url(self.db_url)
            if url.drivername in ("postgresql", "postgres"):
                url = url.set(drivername="postgresql+psycopg")
            return url
        return URL.create(
            "postgresql+psycopg",
            username=self.db_user,
            password=self.db_password or None,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
