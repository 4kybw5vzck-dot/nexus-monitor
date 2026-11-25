"""Initiales Schema (Phase 2)

TimescaleDB ist optional: Ist die Erweiterung auf dem Server verfügbar, wird
`measurements` zur Hypertable mit Kompression. Ohne TimescaleDB (z. B. in
Tests mit normalem PostgreSQL) bleibt es eine normale Tabelle.

Revision ID: 0001
Revises: 
Erstellt: 2026-11-25 15:05:56.620758
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('credential_profiles',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('protocol', sa.String(length=16), nullable=False),
    sa.Column('secret_ciphertext', sa.LargeBinary(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("protocol IN ('SNMP v3', 'SNMP v2c', 'WMI', 'SSH', 'ICMP', 'API')", name='ck_credential_profiles_protocol'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('notification_rules',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('trigger', sa.Text(), nullable=False),
    sa.Column('channel', sa.String(length=32), nullable=False),
    sa.Column('target', sa.String(length=300), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.CheckConstraint("channel IN ('E-Mail', 'SMS', 'Webhook', 'Microsoft Teams')", name='ck_notification_rules_channel'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('reports',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('period', sa.String(length=20), nullable=False),
    sa.Column('format', sa.String(length=10), nullable=False),
    sa.Column('last_run', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("format IN ('PDF', 'CSV', 'HTML')", name='ck_reports_format'),
    sa.CheckConstraint("period IN ('Täglich', 'Wöchentlich', 'Monatlich')", name='ck_reports_period'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('sites',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('city', sa.String(length=200), nullable=False),
    sa.Column('address', sa.String(length=300), nullable=False),
    sa.Column('subnet', sa.String(length=100), nullable=False),
    sa.Column('contact', sa.String(length=200), nullable=False),
    sa.Column('collector_id', sa.String(length=64), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('login', sa.String(length=100), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('email', sa.String(length=300), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('password_hash', sa.String(length=300), nullable=True),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('Administrator', 'Operator', 'Nur Lesen')", name='ck_users_role'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('login')
    )
    op.create_table('auth_sessions',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('token_hash')
    )
    op.create_index('ix_auth_sessions_user', 'auth_sessions', ['user_id'], unique=False)
    op.create_table('collectors',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('site_id', sa.String(length=64), nullable=True),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('version', sa.String(length=50), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('last_heartbeat', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cpu', sa.Double(), nullable=False),
    sa.Column('memory', sa.Double(), nullable=False),
    sa.Column('queue_length', sa.Integer(), nullable=False),
    sa.CheckConstraint("role IN ('central', 'remote')", name='ck_collectors_role'),
    sa.CheckConstraint("status IN ('ok', 'warning', 'critical', 'unknown', 'paused')", name='ck_collectors_status'),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('devices',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('type', sa.String(length=32), nullable=False),
    sa.Column('vendor', sa.String(length=100), nullable=False),
    sa.Column('model', sa.String(length=200), nullable=False),
    sa.Column('os', sa.String(length=200), nullable=False),
    sa.Column('site_id', sa.String(length=64), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('tags', sa.ARRAY(sa.String(length=100)), nullable=False),
    sa.Column('boot_time', sa.DateTime(timezone=True), nullable=True),
    sa.Column('polling_interval_sec', sa.Integer(), nullable=False),
    sa.Column('protocol', sa.String(length=16), nullable=False),
    sa.Column('credential_profile_id', sa.Integer(), nullable=True),
    sa.Column('notification_group', sa.String(length=200), nullable=False),
    sa.Column('maintenance_window', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("protocol IN ('SNMP v3', 'SNMP v2c', 'WMI', 'SSH', 'ICMP', 'API')", name='ck_devices_protocol'),
    sa.CheckConstraint("type IN ('windows-server', 'linux-server', 'switch', 'router', 'firewall', 'hypervisor-vmware', 'hypervisor-hyperv', 'storage', 'backup', 'ups')", name='ck_devices_type'),
    sa.ForeignKeyConstraint(['credential_profile_id'], ['credential_profiles.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_devices_site', 'devices', ['site_id'], unique=False)
    op.create_table('links',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('from_device_id', sa.String(length=64), nullable=False),
    sa.Column('to_device_id', sa.String(length=64), nullable=False),
    sa.Column('bandwidth_mbps', sa.Double(), nullable=False),
    sa.Column('utilization', sa.Double(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.CheckConstraint("kind IN ('lan', 'uplink', 'wan', 'storage')", name='ck_links_kind'),
    sa.CheckConstraint("status IN ('ok', 'warning', 'critical', 'unknown', 'paused')", name='ck_links_status'),
    sa.ForeignKeyConstraint(['from_device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['to_device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('sensors',
    sa.Column('id', sa.String(length=80), nullable=False),
    sa.Column('device_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('type', sa.String(length=32), nullable=False),
    sa.Column('unit', sa.String(length=20), nullable=False),
    sa.Column('interval_sec', sa.Integer(), nullable=False),
    sa.Column('warning_threshold', sa.Double(), nullable=True),
    sa.Column('critical_threshold', sa.Double(), nullable=True),
    sa.Column('inverted', sa.Boolean(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('value', sa.Double(), nullable=False),
    sa.Column('display_value', sa.String(length=300), nullable=True),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('last_check', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('ok', 'warning', 'critical', 'unknown', 'paused')", name='ck_sensors_status'),
    sa.CheckConstraint("type IN ('ping', 'snmp-traffic', 'cpu-load', 'memory-usage', 'disk-usage', 'windows-services', 'linux-load', 'interface-status', 'http', 'dns')", name='ck_sensors_type'),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sensors_device', 'sensors', ['device_id'], unique=False)
    op.create_table('alerts',
    sa.Column('id', sa.String(length=120), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('state', sa.String(length=16), nullable=False),
    sa.Column('device_id', sa.String(length=64), nullable=False),
    sa.Column('sensor_id', sa.String(length=80), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('raised_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('acknowledged_by', sa.String(length=100), nullable=True),
    sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("severity IN ('critical', 'warning', 'info')", name='ck_alerts_severity'),
    sa.CheckConstraint("state IN ('active', 'acknowledged', 'resolved')", name='ck_alerts_state'),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sensor_id'], ['sensors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_alerts_state_raised', 'alerts', ['state', 'raised_at'], unique=False)
    op.create_table('events',
    sa.Column('id', sa.String(length=160), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('level', sa.String(length=16), nullable=False),
    sa.Column('device_id', sa.String(length=64), nullable=True),
    sa.Column('sensor_id', sa.String(length=80), nullable=True),
    sa.Column('message', sa.Text(), nullable=False),
    sa.CheckConstraint("level IN ('critical', 'warning', 'info', 'ok')", name='ck_events_level'),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sensor_id'], ['sensors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_events_at', 'events', ['at'], unique=False)
    op.create_index('ix_events_device_at', 'events', ['device_id', 'at'], unique=False)
    op.create_table('measurements',
    sa.Column('sensor_id', sa.String(length=80), nullable=False),
    sa.Column('time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('value', sa.Double(), nullable=False),
    sa.ForeignKeyConstraint(['sensor_id'], ['sensors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('sensor_id', 'time')
    )
    # Zirkulärer Verweis Standort -> Collector: erst anlegen, wenn beide Tabellen existieren
    op.create_foreign_key(
        'fk_sites_collector', 'sites', 'collectors', ['collector_id'], ['id'],
        ondelete='SET NULL', deferrable=True, initially='DEFERRED',
    )
    _enable_timescale()


def _enable_timescale() -> None:
    bind = op.get_bind()
    available = bind.execute(
        sa.text("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'")
    ).scalar()
    if not available:
        return
    op.execute('CREATE EXTENSION IF NOT EXISTS timescaledb')
    op.execute(
        "SELECT create_hypertable('measurements', 'time', "
        "chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE)"
    )
    # Kompression: Daten älter als 7 Tage werden je Sensor komprimiert (Faktor ~10–20)
    op.execute(
        "ALTER TABLE measurements SET (timescaledb.compress, "
        "timescaledb.compress_segmentby = 'sensor_id', timescaledb.compress_orderby = 'time DESC')"
    )
    op.execute("SELECT add_compression_policy('measurements', INTERVAL '7 days', if_not_exists => TRUE)")


def downgrade() -> None:
    op.drop_constraint('fk_sites_collector', 'sites', type_='foreignkey')
    op.drop_table('measurements')
    op.drop_index('ix_events_device_at', table_name='events')
    op.drop_index('ix_events_at', table_name='events')
    op.drop_table('events')
    op.drop_index('ix_alerts_state_raised', table_name='alerts')
    op.drop_table('alerts')
    op.drop_index('ix_sensors_device', table_name='sensors')
    op.drop_table('sensors')
    op.drop_table('links')
    op.drop_index('ix_devices_site', table_name='devices')
    op.drop_table('devices')
    op.drop_table('collectors')
    op.drop_index('ix_auth_sessions_user', table_name='auth_sessions')
    op.drop_table('auth_sessions')
    op.drop_table('users')
    op.drop_table('sites')
    op.drop_table('reports')
    op.drop_table('notification_rules')
    op.drop_table('credential_profiles')
