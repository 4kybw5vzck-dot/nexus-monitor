"""Alembic-Umgebung. Die Verbindung kommt aus der Backend-Konfiguration (NEXUS_DB_*)."""

from alembic import context

from app.db import get_engine
from app.models import Base

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    from app.config import get_settings

    context.configure(
        url=get_settings().sqlalchemy_url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = context.config.attributes.get("connection")
    if connectable is not None:
        _run(connectable)
        return
    with get_engine().connect() as connection:
        _run(connection)


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
