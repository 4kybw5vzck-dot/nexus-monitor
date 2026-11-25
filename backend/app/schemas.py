"""API-Modelle. Feldnamen im JSON in camelCase – exakt wie frontend/src/api/types.ts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer
from pydantic.alias_generators import to_camel

Status = Literal["ok", "warning", "critical", "unknown", "paused"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    @field_serializer("*", when_used="json", check_fields=False)
    def _iso_utc(self, value):  # noqa: ANN001
        # Zeitstempel einheitlich als ISO 8601 in UTC mit "Z" (wie im Frontend-Mock)
        return _utc_iso(value) if isinstance(value, datetime) else value


def _utc_iso(value: datetime) -> str:
    """ISO 8601 in UTC, Millisekunden, Suffix Z. Zeitstempel ohne Zone gelten als UTC."""
    v = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return v.strftime("%Y-%m-%dT%H:%M:%S.") + f"{v.microsecond // 1000:03d}Z"


class Site(ApiModel):
    id: str
    name: str
    city: str
    address: str
    subnet: str
    collector_id: str | None
    contact: str


class DeviceConfig(ApiModel):
    polling_interval_sec: int
    protocol: str
    credential_profile: str
    credential_profile_id: int | None = None
    notification_group: str
    maintenance_window: str | None
    # Zuständiger Collector (leer = zentraler Collector)
    collector_id: str | None = None


class Device(ApiModel):
    id: str
    name: str
    ip: str
    type: str
    vendor: str
    model: str
    os: str
    site_id: str
    status: Status
    sensor_count: int
    last_contact: datetime
    uptime_days: int
    tags: list[str]
    description: str
    config: DeviceConfig
    paused: bool = False
    is_demo: bool = False


class Thresholds(ApiModel):
    warning: float
    critical: float
    inverted: bool = False


class Sensor(ApiModel):
    id: str
    device_id: str
    name: str
    type: str
    status: Status
    value: float
    unit: str
    display_value: str | None = None
    last_check: datetime | None
    interval_sec: int
    thresholds: Thresholds | None = None
    message: str
    settings: dict = {}
    paused: bool = False
    status_since: datetime | None = None


class MetricPoint(BaseModel):
    t: datetime
    v: float

    @field_serializer("t", when_used="json")
    def _t(self, value: datetime) -> str:
        return _utc_iso(value)


class Availability(ApiModel):
    device_id: str
    site_id: str
    availability: float


class Alert(ApiModel):
    id: str
    severity: str
    state: str
    device_id: str
    sensor_id: str
    site_id: str
    title: str
    description: str
    raised_at: datetime
    resolved_at: datetime | None = None
    acknowledged_by: str | None = None
    acknowledged_at: datetime | None = None


class EventLogEntry(ApiModel):
    id: str
    at: datetime
    level: str
    device_id: str | None = None
    sensor_id: str | None = None
    message: str


class Link(ApiModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    bandwidth: float
    utilization: float
    status: Status
    kind: str


class Collector(ApiModel):
    id: str
    name: str
    site_id: str | None
    role: str
    version: str
    status: Status
    last_heartbeat: datetime | None
    sensor_count: int
    cpu: float
    memory: float
    queue_length: int
    is_demo: bool = False
    last_error: str | None = None


class User(ApiModel):
    id: str
    name: str
    login: str
    role: str
    email: str
    last_login: datetime | None
    active: bool
    # Ohne Passwort ist keine Anmeldung möglich (z. B. Demo-Benutzer)
    has_password: bool = False


class NotificationRule(ApiModel):
    id: str
    name: str
    trigger: str
    channel: str
    target: str
    enabled: bool


class ReportDefinition(ApiModel):
    id: str
    name: str
    description: str
    period: str
    last_run: datetime | None
    format: str


class StatusSummary(ApiModel):
    devices: int
    sensors: int
    by_status: dict[str, int]
    availability: float
    active_alerts: int


class DiscoveryRequest(ApiModel):
    range: str = Field(min_length=7, max_length=43)


class DiscoveryResult(ApiModel):
    ip: str
    hostname: str
    vendor_guess: str
    type_guess: str
    open_services: list[str]
    already_monitored: bool


Role = Literal["Administrator", "Operator", "Nur Lesen"]


class UserCreate(ApiModel):
    login: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(default="", max_length=300)
    role: Role
    active: bool = True
    # Optional: ohne Passwort kann sich der Benutzer erst nach "Passwort setzen" anmelden
    password: str | None = Field(default=None, max_length=500)


class UserUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=300)
    role: Role | None = None
    active: bool | None = None


class PasswordSet(ApiModel):
    password: str = Field(max_length=500)


class PasswordChange(ApiModel):
    current_password: str = Field(min_length=1, max_length=500)
    new_password: str = Field(max_length=500)


class LoginRequest(ApiModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=500)


class LoginResponse(ApiModel):
    token: str
    expires_at: datetime
    user: User


class Health(ApiModel):
    status: Literal["ok", "degraded"]
    version: str
    database: Literal["ok", "error"]
    timescaledb: bool


# ---------------------------------------------------------------------------
# Verwaltung
# ---------------------------------------------------------------------------

Protocol = Literal["SNMP v3", "SNMP v2c", "WMI", "SSH", "ICMP", "API"]
DeviceType = Literal[
    "windows-server", "linux-server", "switch", "router", "firewall",
    "hypervisor-vmware", "hypervisor-hyperv", "storage", "backup", "ups",
]
SensorType = Literal[
    "ping", "snmp-traffic", "cpu-load", "memory-usage", "disk-usage",
    "windows-services", "linux-load", "interface-status", "http", "dns",
]


class CredentialProfile(ApiModel):
    id: int
    name: str
    protocol: str
    description: str
    has_secret: bool
    # false: gespeicherte Daten passen nicht zum aktuellen NEXUS_SECRET_KEY
    readable: bool
    # Nicht geheime Felder (Benutzer, Port …); geheime nur als true/false
    fields: dict
    device_count: int


class CredentialProfileInput(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    protocol: Protocol
    description: str = Field(default="", max_length=2000)
    credentials: dict | None = None


class CredentialProfilePatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    protocol: Protocol | None = None
    description: str | None = Field(default=None, max_length=2000)
    # Nur übermittelte Felder werden geändert; leere geheime Felder bleiben erhalten
    credentials: dict | None = None


class SiteInput(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    subnet: str = Field(default="", max_length=100)
    contact: str = Field(default="", max_length=200)
    collector_id: str | None = None


class SitePatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    subnet: str | None = Field(default=None, max_length=100)
    contact: str | None = Field(default=None, max_length=200)
    collector_id: str | None = None


_HOST_PATTERN = r"^[A-Za-z0-9]([A-Za-z0-9.:_-]{0,252})$"


class DeviceInput(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    # IP-Adresse oder DNS-Name
    ip: str = Field(min_length=1, max_length=253, pattern=_HOST_PATTERN)
    type: DeviceType
    vendor: str = Field(default="", max_length=100)
    model: str = Field(default="", max_length=200)
    os: str = Field(default="", max_length=200)
    site_id: str
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    polling_interval_sec: int = Field(default=60, ge=10, le=86400)
    protocol: Protocol
    credential_profile_id: int | None = None
    notification_group: str = Field(default="", max_length=200)
    maintenance_window: str | None = Field(default=None, max_length=200)
    collector_id: str | None = None
    create_default_sensors: bool = True


class DevicePatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    ip: str | None = Field(default=None, min_length=1, max_length=253, pattern=_HOST_PATTERN)
    type: DeviceType | None = None
    vendor: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=200)
    os: str | None = Field(default=None, max_length=200)
    site_id: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    tags: list[str] | None = Field(default=None, max_length=30)
    polling_interval_sec: int | None = Field(default=None, ge=10, le=86400)
    protocol: Protocol | None = None
    credential_profile_id: int | None = None
    notification_group: str | None = Field(default=None, max_length=200)
    maintenance_window: str | None = Field(default=None, max_length=200)
    collector_id: str | None = None
    paused: bool | None = None


class SensorInput(ApiModel):
    type: SensorType
    name: str | None = Field(default=None, min_length=1, max_length=200)
    interval_sec: int | None = Field(default=None, ge=10, le=86400)
    thresholds: Thresholds | None = None
    settings: dict = Field(default_factory=dict)


class SensorPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    interval_sec: int | None = Field(default=None, ge=10, le=86400)
    # null = keine Schwellwerte
    thresholds: Thresholds | None = None
    settings: dict | None = None
    paused: bool | None = None


class CollectorInput(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    site_id: str | None = None


class CollectorCreated(ApiModel):
    collector: Collector
    # Nur einmal sichtbar – wird in der Zentrale nur als Hash gespeichert
    token: str
