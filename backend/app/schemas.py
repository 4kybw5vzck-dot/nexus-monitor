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
    notification_group: str
    maintenance_window: str | None


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


class User(ApiModel):
    id: str
    name: str
    login: str
    role: str
    email: str
    last_login: datetime | None
    active: bool


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
