"""Datenmodell.

Stammdaten und Konfiguration liegen in normalen Tabellen. Messwerte stehen in
`measurements`; ist die TimescaleDB-Erweiterung vorhanden, wird diese Tabelle
von der Migration in eine Hypertable mit Kompression umgewandelt.

Abgeleitete Werte werden NICHT gespeichert, sondern bei der Abfrage berechnet:
Gerätestatus (schlechtester Sensorstatus), Sensoranzahl, letzter Kontakt,
Standort eines Alarms (über das Gerät), Sensoranzahl je Collector.

Hinweise zu Abweichungen vom Entwurf in docs/ARCHITEKTUR.md:
- Schwellwerte stehen direkt am Sensor (1:1, keine eigene Tabelle).
- Rollen sind ein fester Wertebereich (CHECK-Constraint) statt eigener Tabelle.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

STATUS_VALUES = ("ok", "warning", "critical", "unknown", "paused")
DEVICE_TYPES = (
    "windows-server", "linux-server", "switch", "router", "firewall",
    "hypervisor-vmware", "hypervisor-hyperv", "storage", "backup", "ups",
)
SENSOR_TYPES = (
    "ping", "snmp-traffic", "cpu-load", "memory-usage", "disk-usage",
    "windows-services", "linux-load", "interface-status", "http", "dns",
)
PROTOCOLS = ("SNMP v3", "SNMP v2c", "WMI", "SSH", "ICMP", "API")
ROLES = ("Administrator", "Operator", "Nur Lesen")
LINK_KINDS = ("lan", "uplink", "wan", "storage")
ALERT_SEVERITIES = ("critical", "warning", "info")
ALERT_STATES = ("active", "acknowledged", "resolved")
EVENT_LEVELS = ("critical", "warning", "info", "ok")
CHANNELS = ("E-Mail", "SMS", "Webhook", "Microsoft Teams")
PERIODS = ("Täglich", "Wöchentlich", "Monatlich")
FORMATS = ("PDF", "CSV", "HTML")


def _in(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    quoted = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return CheckConstraint(f"{column} IN ({quoted})", name=name)


TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(200), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    subnet: Mapped[str] = mapped_column(String(100), default="")
    contact: Mapped[str] = mapped_column(String(200), default="")
    collector_id: Mapped[str | None] = mapped_column(
        ForeignKey("collectors.id", ondelete="SET NULL", use_alter=True, name="fk_sites_collector", deferrable=True, initially="DEFERRED"),
        nullable=True,
    )


class Collector(Base):
    __tablename__ = "collectors"
    __table_args__ = (
        _in("role", ("central", "remote"), "ck_collectors_role"),
        _in("status", STATUS_VALUES, "ck_collectors_status"),
        UniqueConstraint("token_hash", name="uq_collectors_token_hash"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    site_id: Mapped[str | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String(16))
    version: Mapped[str] = mapped_column(String(50), default="")
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    last_heartbeat: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    cpu: Mapped[float] = mapped_column(Double, default=0)
    memory: Mapped[float] = mapped_column(Double, default=0)
    queue_length: Mapped[int] = mapped_column(Integer, default=0)
    # Anmeldung des Collectors an der Zentrale: nur der SHA-256-Hash des Tokens
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Demo-Collectors (aus dem Demo-Datensatz) melden sich nie
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class CredentialProfile(Base):
    """Zugangsprofil. Geräte verweisen nur auf das Profil, nie auf Zugangsdaten.

    `secret_ciphertext` enthält die mit NEXUS_SECRET_KEY verschlüsselten Zugangsdaten
    (Fernet, JSON). Die API gibt sie nie aus; nur ein angemeldeter Collector erhält
    sie entschlüsselt für die Geräte, die er abfragt.
    """

    __tablename__ = "credential_profiles"
    __table_args__ = (_in("protocol", PROTOCOLS, "ck_credential_profiles_protocol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    protocol: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    secret_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        _in("type", DEVICE_TYPES, "ck_devices_type"),
        _in("protocol", PROTOCOLS, "ck_devices_protocol"),
        Index("ix_devices_site", "site_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    ip: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(32))
    vendor: Mapped[str] = mapped_column(String(100), default="")
    model: Mapped[str] = mapped_column(String(200), default="")
    os: Mapped[str] = mapped_column(String(200), default="")
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="RESTRICT"))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(100)), default=list)
    # Zeitpunkt des letzten Systemstarts – daraus wird uptimeDays berechnet
    boot_time: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    # Monitoring-Konfiguration
    polling_interval_sec: Mapped[int] = mapped_column(Integer, default=60)
    protocol: Mapped[str] = mapped_column(String(16))
    credential_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential_profiles.id", ondelete="SET NULL"), nullable=True
    )
    notification_group: Mapped[str] = mapped_column(String(200), default="")
    maintenance_window: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Zuständiger Collector; leer = zentraler Collector
    collector_id: Mapped[str | None] = mapped_column(
        ForeignKey("collectors.id", ondelete="SET NULL", name="fk_devices_collector"), nullable=True
    )
    paused: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Demo-Geräte (RFC-5737-Adressen) werden nie abgefragt
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    credential_profile: Mapped[CredentialProfile | None] = relationship(lazy="joined")
    sensors: Mapped[list[Sensor]] = relationship(back_populates="device", cascade="all, delete-orphan")


class Sensor(Base):
    __tablename__ = "sensors"
    __table_args__ = (
        _in("type", SENSOR_TYPES, "ck_sensors_type"),
        _in("status", STATUS_VALUES, "ck_sensors_status"),
        Index("ix_sensors_device", "device_id"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32))
    unit: Mapped[str] = mapped_column(String(20), default="")
    interval_sec: Mapped[int] = mapped_column(Integer, default=60)
    # Schwellwerte (optional). inverted: Werte UNTER der Schwelle sind schlecht.
    warning_threshold: Mapped[float | None] = mapped_column(Double, nullable=True)
    critical_threshold: Mapped[float | None] = mapped_column(Double, nullable=True)
    inverted: Mapped[bool] = mapped_column(Boolean, default=False)
    # Prüfungsparameter je Sensortyp, z. B. {"interface": "GE0/0/1"} oder {"url": "https://…"}
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    paused: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Letzter Zustand (vom Collector geliefert)
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    value: Mapped[float] = mapped_column(Double, default=0)
    display_value: Mapped[str | None] = mapped_column(String(300), nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    last_check: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    # Seit wann der aktuelle Status gilt
    status_since: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    device: Mapped[Device] = relationship(back_populates="sensors")


class Measurement(Base):
    """Messwert. Primärschlüssel (sensor_id, time) – passt zu TimescaleDB-Hypertables."""

    __tablename__ = "measurements"

    sensor_id: Mapped[str] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), primary_key=True)
    time: Mapped[datetime] = mapped_column(TS, primary_key=True)
    value: Mapped[float] = mapped_column(Double)


class Link(Base):
    __tablename__ = "links"
    __table_args__ = (
        _in("kind", LINK_KINDS, "ck_links_kind"),
        _in("status", STATUS_VALUES, "ck_links_status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    from_device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    to_device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    bandwidth_mbps: Mapped[float] = mapped_column(Double)
    utilization: Mapped[float] = mapped_column(Double, default=0)
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    kind: Mapped[str] = mapped_column(String(16))


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        _in("severity", ALERT_SEVERITIES, "ck_alerts_severity"),
        _in("state", ALERT_STATES, "ck_alerts_state"),
        Index("ix_alerts_state_raised", "state", "raised_at"),
        Index("ix_alerts_sensor_state", "sensor_id", "state"),
    )

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    severity: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(16))
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    sensor_id: Mapped[str] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    raised_at: Mapped[datetime] = mapped_column(TS)
    resolved_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)

    device: Mapped[Device] = relationship(lazy="joined")


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        _in("level", EVENT_LEVELS, "ck_events_level"),
        Index("ix_events_at", "at"),
        Index("ix_events_device_at", "device_id", "at"),
    )

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    at: Mapped[datetime] = mapped_column(TS)
    level: Mapped[str] = mapped_column(String(16))
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=True)
    sensor_id: Mapped[str | None] = mapped_column(ForeignKey("sensors.id", ondelete="SET NULL"), nullable=True)
    message: Mapped[str] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (_in("role", ROLES, "ck_users_role"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    login: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(300), default="")
    role: Mapped[str] = mapped_column(String(20))
    # Ohne Passwort-Hash ist keine Anmeldung möglich (z. B. Demo-Benutzer)
    password_hash: Mapped[str | None] = mapped_column(String(300), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class AuthSession(Base):
    """Anmeldesitzung. Gespeichert wird nur der SHA-256-Hash des Tokens."""

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user", "user_id"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(TS)

    user: Mapped[User] = relationship(lazy="joined")


class NotificationRule(Base):
    __tablename__ = "notification_rules"
    __table_args__ = (_in("channel", CHANNELS, "ck_notification_rules_channel"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    trigger: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(32))
    target: Mapped[str] = mapped_column(String(300))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        _in("period", PERIODS, "ck_reports_period"),
        _in("format", FORMATS, "ck_reports_format"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    period: Mapped[str] = mapped_column(String(20))
    format: Mapped[str] = mapped_column(String(10))
    last_run: Mapped[datetime | None] = mapped_column(TS, nullable=True)
