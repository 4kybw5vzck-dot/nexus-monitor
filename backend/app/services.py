"""Abfragen und Ableitungen. Aggregationen laufen in SQL, damit sie auch bei
vielen tausend Sensoren schnell bleiben.

Zeitreihen werden mit `date_bin` (Standard-PostgreSQL ab Version 14) in Intervalle
gruppiert. Das funktioniert mit und ohne TimescaleDB.
"""

from __future__ import annotations

import ipaddress
import random
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from . import models as m
from . import schemas as s

STATUS_RANK = {"paused": 0, "ok": 1, "unknown": 2, "warning": 3, "critical": 4}
RANK_STATUS = {v: k for k, v in STATUS_RANK.items()}

_RANK_SQL = (
    "CASE {col} WHEN 'paused' THEN 0 WHEN 'ok' THEN 1 WHEN 'unknown' THEN 2 "
    "WHEN 'warning' THEN 3 WHEN 'critical' THEN 4 END"
)
_ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+00'"


def step_minutes_for(hours: int) -> int:
    """Auflösung je Zeitraum – identisch zum Frontend (stepMinutesFor)."""
    if hours <= 24:
        return 5
    if hours <= 24 * 7:
        return 30
    return 120


def worst_status(statuses: list[str]) -> str:
    if not statuses:
        return "unknown"
    return max(statuses, key=lambda x: STATUS_RANK[x])


def _now(db: Session) -> datetime:
    return db.execute(text("SELECT now()")).scalar_one()


# ---------------------------------------------------------------------------
# Geräte
# ---------------------------------------------------------------------------

# Effektiver Sensorstatus: pausierte Geräte/Sensoren zählen als "paused"
EFFECTIVE_STATUS_SQL = "CASE WHEN d.paused OR se.paused THEN 'paused' ELSE se.status END"


def list_devices(db: Session, device_id: str | None = None) -> list[s.Device]:
    rank = _RANK_SQL.format(col=f"({EFFECTIVE_STATUS_SQL})")
    sql = f"""
        SELECT d.id, d.name, d.ip, d.type, d.vendor, d.model, d.os, d.site_id, d.tags, d.description,
               d.boot_time, d.created_at, d.polling_interval_sec, d.protocol, d.notification_group,
               d.maintenance_window, d.credential_profile_id, d.collector_id, d.paused, d.is_demo,
               cp.name AS credential_profile,
               count(se.id) AS sensor_count, max({rank}) AS worst_rank, max(se.last_check) AS last_contact,
               now() AS now
        FROM devices d
        LEFT JOIN credential_profiles cp ON cp.id = d.credential_profile_id
        LEFT JOIN sensors se ON se.device_id = d.id
        {"WHERE d.id = :id" if device_id else ""}
        GROUP BY d.id, cp.name
        ORDER BY d.name
    """
    rows = db.execute(text(sql), {"id": device_id} if device_id else {}).mappings().all()
    result = []
    for r in rows:
        uptime = int((r["now"] - r["boot_time"]).total_seconds() // 86400) if r["boot_time"] else 0
        result.append(
            s.Device(
                id=r["id"], name=r["name"], ip=r["ip"], type=r["type"], vendor=r["vendor"], model=r["model"],
                os=r["os"], site_id=r["site_id"], tags=list(r["tags"] or []), description=r["description"],
                status=RANK_STATUS[r["worst_rank"]] if r["worst_rank"] is not None else "unknown",
                sensor_count=r["sensor_count"],
                last_contact=r["last_contact"] or r["created_at"],
                uptime_days=max(0, uptime),
                config=s.DeviceConfig(
                    polling_interval_sec=r["polling_interval_sec"], protocol=r["protocol"],
                    credential_profile=r["credential_profile"] or "",
                    credential_profile_id=r["credential_profile_id"],
                    notification_group=r["notification_group"], maintenance_window=r["maintenance_window"],
                    collector_id=r["collector_id"],
                ),
                paused=r["paused"],
                is_demo=r["is_demo"],
            )
        )
    return result


# ---------------------------------------------------------------------------
# Sensoren und Zeitreihen
# ---------------------------------------------------------------------------

def sensor_to_api(x: m.Sensor) -> s.Sensor:
    thresholds = None
    if x.warning_threshold is not None and x.critical_threshold is not None:
        thresholds = s.Thresholds(warning=x.warning_threshold, critical=x.critical_threshold, inverted=x.inverted)
    paused = x.paused or x.device.paused
    return s.Sensor(
        id=x.id, device_id=x.device_id, name=x.name, type=x.type, status="paused" if paused else x.status,
        value=x.value, unit=x.unit, display_value=x.display_value, last_check=x.last_check,
        interval_sec=x.interval_sec, thresholds=thresholds, message=x.message,
        settings=x.settings or {}, paused=x.paused, status_since=x.status_since,
    )


def _decimals(unit: str) -> int:
    return 2 if unit == "" else 1


def sensor_history(db: Session, sensor: m.Sensor, hours: int) -> list[s.MetricPoint]:
    step = step_minutes_for(hours)
    rows = db.execute(
        text(f"""
            SELECT date_bin(make_interval(mins => :step), time, {_ORIGIN}) AS b, avg(value) AS v
            FROM measurements
            WHERE sensor_id = :id AND time > now() - make_interval(hours => :hours)
            GROUP BY b ORDER BY b
        """),
        {"step": step, "id": sensor.id, "hours": hours},
    ).all()
    d = _decimals(sensor.unit)
    return [s.MetricPoint(t=b, v=round(v, d)) for b, v in rows]


# Auswahl der Sensoren je Kennzahl. Traffic: bis die Monitoring-Engine (Phase 3)
# getrennte Ein-/Ausgangskanäle liefert, wird die WAN-Summe wie im Mock aufgeteilt.
_AGGREGATES = {
    "cpu": ("se.type = 'cpu-load' AND se.status <> 'unknown'", "avg", 1.0),
    "memory": ("se.type = 'memory-usage'", "avg", 1.0),
    "traffic-in": ("se.type = 'snmp-traffic' AND se.name = 'Traffic WAN'", "sum", 0.68),
    "traffic-out": ("se.type = 'snmp-traffic' AND se.name = 'Traffic WAN'", "sum", 0.32),
}


def aggregate_series(db: Session, metric: str, hours: int) -> list[s.MetricPoint]:
    where, fn, share = _AGGREGATES[metric]
    step = step_minutes_for(hours)
    rows = db.execute(
        text(f"""
            WITH per_sensor AS (
                SELECT ms.sensor_id, date_bin(make_interval(mins => :step), ms.time, {_ORIGIN}) AS b, avg(ms.value) AS v
                FROM measurements ms
                JOIN sensors se ON se.id = ms.sensor_id
                WHERE {where} AND ms.time > now() - make_interval(hours => :hours)
                GROUP BY ms.sensor_id, b
            )
            SELECT b, {fn}(v) AS v FROM per_sensor GROUP BY b ORDER BY b
        """),
        {"step": step, "hours": hours},
    ).all()
    return [s.MetricPoint(t=b, v=round(v * share, 1)) for b, v in rows]


def availability(db: Session, hours: int) -> list[s.Availability]:
    """Verfügbarkeit je Gerät aus dem Ping-Sensor: je Intervall der Anteil der Messungen
    über der kritischen Schwelle (Ausfall), gemittelt über alle Intervalle. So zählt ein
    einzelner Ausfall auch dann, wenn ein Intervall mehrere Messungen enthält, und
    unterschiedlich dichte Daten (Demo-Datensatz) werden gleich gewichtet."""
    step = step_minutes_for(hours)
    rows = db.execute(
        text(f"""
            WITH ping AS (
                SELECT DISTINCT ON (device_id) id, device_id, critical_threshold AS crit, inverted
                FROM sensors WHERE type = 'ping' ORDER BY device_id, id
            ), buckets AS (
                SELECT p.device_id,
                       date_bin(make_interval(mins => :step), ms.time, {_ORIGIN}) AS b,
                       avg(CASE
                           WHEN p.crit IS NULL THEN 0
                           WHEN p.inverted AND ms.value <= p.crit THEN 1
                           WHEN NOT p.inverted AND ms.value >= p.crit THEN 1
                           ELSE 0 END) AS down
                FROM ping p JOIN measurements ms ON ms.sensor_id = p.id
                WHERE ms.time > now() - make_interval(hours => :hours)
                GROUP BY p.device_id, b
            ), per_device AS (
                SELECT device_id, 100.0 - 100.0 * avg(down) AS availability FROM buckets GROUP BY device_id
            )
            SELECT d.id, d.site_id, coalesce(pd.availability, 100) AS availability
            FROM devices d LEFT JOIN per_device pd ON pd.device_id = d.id
            ORDER BY d.name
        """),
        {"step": step, "hours": hours},
    ).all()
    return [s.Availability(device_id=i, site_id=site, availability=round(float(a), 2)) for i, site, a in rows]


def summary(db: Session) -> s.StatusSummary:
    by_status = {k: 0 for k in STATUS_RANK}
    rows = db.execute(text(f"""
        SELECT {EFFECTIVE_STATUS_SQL} AS st, count(*) FROM sensors se JOIN devices d ON d.id = se.device_id GROUP BY st
    """)).all()
    for status, n in rows:
        by_status[status] = n
    devices = db.scalar(select(func.count()).select_from(m.Device)) or 0
    ping_devices = set(db.scalars(select(m.Sensor.device_id).where(m.Sensor.type == "ping")).all())
    avail = [a.availability for a in availability(db, 24) if a.device_id in ping_devices]
    active = db.scalar(select(func.count()).select_from(m.Alert).where(m.Alert.state != "resolved")) or 0
    return s.StatusSummary(
        devices=devices,
        sensors=sum(by_status.values()),
        by_status=by_status,
        availability=round(sum(avail) / max(1, len(avail)), 2),
        active_alerts=active,
    )


# ---------------------------------------------------------------------------
# Alarme, Ereignisse, Verbindungen, Collectors
# ---------------------------------------------------------------------------

def alert_to_api(a: m.Alert) -> s.Alert:
    return s.Alert(
        id=a.id, severity=a.severity, state=a.state, device_id=a.device_id, sensor_id=a.sensor_id,
        site_id=a.device.site_id, title=a.title, description=a.description, raised_at=a.raised_at,
        resolved_at=a.resolved_at, acknowledged_by=a.acknowledged_by, acknowledged_at=a.acknowledged_at,
    )


def acknowledge_alert(db: Session, alert: m.Alert, user_login: str) -> m.Alert:
    """Bestätigt einen aktiven Alarm und schreibt ein Ereignis. Mehrfaches Bestätigen ist harmlos."""
    if alert.state != "active":
        return alert
    now = _now(db)
    alert.state = "acknowledged"
    alert.acknowledged_by = user_login
    alert.acknowledged_at = now
    db.add(
        m.Event(
            id=f"evt-{alert.id}-ack-{int(now.timestamp() * 1000)}",
            at=now, level="info", device_id=alert.device_id, sensor_id=alert.sensor_id,
            message=f"{alert.device.name} – Alarm bestätigt von {user_login}",
        )
    )
    db.commit()
    return alert


def link_to_api(x: m.Link) -> s.Link:
    return s.Link(
        id=x.id, **{"from": x.from_device_id}, to=x.to_device_id, bandwidth=x.bandwidth_mbps,
        utilization=x.utilization, status=x.status, kind=x.kind,
    )


CENTRAL_COLLECTOR_ID = "col-central"


def list_collectors(db: Session) -> list[s.Collector]:
    """Sensoranzahl: Demo-Collectors wie im Mock (Demo-Sensoren am Standort bzw. alle),
    echte Collectors nach Zuständigkeit (Gerät ohne Collector -> zentraler Collector)."""
    demo_total = db.scalar(select(func.count(m.Sensor.id)).join(m.Device).where(m.Device.is_demo.is_(True))) or 0
    demo_per_site = dict(db.execute(
        select(m.Device.site_id, func.count(m.Sensor.id)).join(m.Sensor)
        .where(m.Device.is_demo.is_(True)).group_by(m.Device.site_id)
    ).all())
    real_per_collector = dict(db.execute(
        select(func.coalesce(m.Device.collector_id, CENTRAL_COLLECTOR_ID), func.count(m.Sensor.id)).join(m.Sensor)
        .where(m.Device.is_demo.is_(False)).group_by(text("1"))
    ).all())
    result = []
    for c in db.scalars(select(m.Collector).order_by(m.Collector.is_demo, m.Collector.role, m.Collector.name)).all():
        if c.is_demo:
            count = demo_total if c.role == "central" else demo_per_site.get(c.site_id, 0)
        else:
            count = real_per_collector.get(c.id, 0)
        result.append(
            s.Collector(
                id=c.id, name=c.name, site_id=c.site_id, role=c.role, version=c.version, status=c.status,
                last_heartbeat=c.last_heartbeat, sensor_count=count, cpu=c.cpu, memory=c.memory,
                queue_length=c.queue_length, is_demo=c.is_demo, last_error=c.last_error,
            )
        )
    return result


# ---------------------------------------------------------------------------
# Discovery (simuliert)
# ---------------------------------------------------------------------------

_CANDIDATES = [
    ("drucker-eg-01", "Kyocera", "linux-server", ["HTTP", "SNMP", "IPP"]),
    ("ap-lager-02", "Huawei", "switch", ["SNMP", "SSH"]),
    ("srv-test-07", "Microsoft", "windows-server", ["RDP", "WMI", "SMB"]),
    ("kamera-tor-1", "Axis", "linux-server", ["HTTP", "RTSP"]),
    ("sw-halle-3", "Huawei", "switch", ["SNMP", "SSH", "LLDP"]),
]


def simulate_discovery(db: Session, cidr: str) -> list[s.DiscoveryResult]:
    """Simulierte Discovery – es findet KEIN Netzwerkzugriff statt (echter Scan: Phase 3)."""
    net = ipaddress.ip_network(cidr, strict=False)
    if net.version != 4:
        raise ValueError("Nur IPv4-Bereiche werden unterstützt")
    if net.prefixlen < 16:
        raise ValueError("Bereich zu groß (mindestens /16)")
    base = ".".join(str(net.network_address).split(".")[:3])
    devices = list_devices(db)
    known = {d.ip for d in devices}
    results = [
        s.DiscoveryResult(
            ip=d.ip, hostname=d.name.lower(), vendor_guess=d.vendor, type_guess=d.type,
            open_services=["ICMP", d.config.protocol.split(" ")[0]], already_monitored=True,
        )
        for d in devices
        if ipaddress.ip_address(d.ip) in net
    ]
    rng = random.Random(cidr)
    for hostname, vendor, dtype, services in _CANDIDATES:
        for _ in range(200):
            ip = f"{base}.{rng.randint(100, 230)}"
            if ip not in known and ipaddress.ip_address(ip) in net:
                break
        else:
            continue
        known.add(ip)
        results.append(
            s.DiscoveryResult(ip=ip, hostname=hostname, vendor_guess=vendor, type_guess=dtype,
                              open_services=services, already_monitored=False)
        )
    results.sort(key=lambda r: ipaddress.ip_address(r.ip))
    return results


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
