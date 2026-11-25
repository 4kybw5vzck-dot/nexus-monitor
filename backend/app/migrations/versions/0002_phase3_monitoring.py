"""Phase 3: Monitoring – Collector-Anmeldung, Geräte/Sensoren verwalten

- collectors: token_hash (Anmeldung), is_demo, last_error
- devices: collector_id, paused, is_demo
- sensors: settings (JSONB), paused, status_since, created_at
- credential_profiles: description
- Bestehende Geräte und Collectors stammen aus dem Demo-Datensatz und werden
  als Demo markiert (werden nie abgefragt).

Revision ID: 0002
Revises: 0001
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_alerts_sensor_state", "alerts", ["sensor_id", "state"], unique=False)

    op.add_column("collectors", sa.Column("token_hash", sa.String(length=64), nullable=True))
    op.add_column("collectors", sa.Column("is_demo", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("collectors", sa.Column("last_error", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_collectors_token_hash", "collectors", ["token_hash"])

    op.add_column("credential_profiles", sa.Column("description", sa.Text(), server_default="", nullable=False))

    op.add_column("devices", sa.Column("collector_id", sa.String(length=64), nullable=True))
    op.add_column("devices", sa.Column("paused", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("devices", sa.Column("is_demo", sa.Boolean(), server_default="false", nullable=False))
    op.create_foreign_key("fk_devices_collector", "devices", "collectors", ["collector_id"], ["id"], ondelete="SET NULL")

    op.add_column("sensors", sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))
    op.add_column("sensors", sa.Column("paused", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("sensors", sa.Column("status_since", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sensors", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))

    # Datenmigration: Bis hierhin gibt es nur Demo-Daten
    op.execute("UPDATE devices SET is_demo = true")
    op.execute("UPDATE collectors SET is_demo = true")
    op.execute("UPDATE sensors SET status_since = last_check")


def downgrade() -> None:
    op.drop_column("sensors", "created_at")
    op.drop_column("sensors", "status_since")
    op.drop_column("sensors", "paused")
    op.drop_column("sensors", "settings")
    op.drop_constraint("fk_devices_collector", "devices", type_="foreignkey")
    op.drop_column("devices", "is_demo")
    op.drop_column("devices", "paused")
    op.drop_column("devices", "collector_id")
    op.drop_column("credential_profiles", "description")
    op.drop_constraint("uq_collectors_token_hash", "collectors", type_="unique")
    op.drop_column("collectors", "last_error")
    op.drop_column("collectors", "is_demo")
    op.drop_column("collectors", "token_hash")
    op.drop_index("ix_alerts_sensor_state", table_name="alerts")
