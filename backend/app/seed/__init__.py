"""Erststart: Administratorkonto anlegen und optional den Demo-Datensatz laden.

Der Demo-Datensatz (demo_data.json.gz) wird mit `npm run export:demo` aus den
Mock-Daten des Frontends erzeugt. Er wird nur in eine Datenbank ohne Geräte
geladen und nur, wenn NEXUS_SEED_DEMO=true gesetzt ist. Alle Zeitstempel werden
dabei so verschoben, dass der Datenbestand „jetzt“ endet.
"""

from __future__ import annotations

import gzip
import json
import logging
from datetime import datetime, timedelta
from importlib import resources

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import models as m
from ..config import Settings
from ..security import generate_password, hash_password

log = logging.getLogger("nexus.seed")


def ensure_admin(db: Session, settings: Settings) -> None:
    """Legt beim ersten Start ein Administratorkonto an, falls sich niemand anmelden kann."""
    can_login = db.scalar(
        select(func.count()).select_from(m.User).where(
            m.User.role == "Administrator", m.User.active.is_(True), m.User.password_hash.is_not(None)
        )
    )
    if can_login:
        return
    password = settings.admin_password
    generated = not password
    if generated:
        password = generate_password()
    user = db.scalar(select(m.User).where(m.User.login == settings.admin_login))
    if user is None:
        user = m.User(id="usr-admin", login=settings.admin_login, name="Administrator", email="", role="Administrator")
        db.add(user)
    user.role = "Administrator"
    user.active = True
    user.password_hash = hash_password(password)
    db.commit()
    if generated:
        log.warning(
            "Administratorkonto '%s' angelegt. Erzeugtes Passwort: %s  "
            "(sicher aufbewahren; ändern mit: docker compose exec backend python -m app.cli set-password %s)",
            settings.admin_login, password, settings.admin_login,
        )
    else:
        log.info("Administratorkonto '%s' angelegt (Passwort aus NEXUS_ADMIN_PASSWORD).", settings.admin_login)


def load_demo_dataset() -> dict:
    with resources.files(__package__).joinpath("demo_data.json.gz").open("rb") as fh:
        return json.loads(gzip.decompress(fh.read()))


def _ts(value: str | None, shift: timedelta) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")) + shift


def seed_demo(db: Session, now: datetime | None = None) -> bool:
    """Lädt den Demo-Datensatz. Gibt False zurück, wenn bereits Geräte vorhanden sind."""
    if db.scalar(select(func.count()).select_from(m.Device)):
        return False
    data = load_demo_dataset()
    now = now or db.execute(text("SELECT now()")).scalar_one()
    exported = datetime.fromisoformat(data["exportedAt"].replace("Z", "+00:00"))
    shift = now - exported

    # Standorte zuerst ohne Collector (zirkulärer Verweis, FK ist DEFERRABLE)
    for x in data["sites"]:
        db.add(m.Site(id=x["id"], name=x["name"], city=x["city"], address=x["address"], subnet=x["subnet"],
                      contact=x["contact"], collector_id=x["collectorId"]))
    db.flush()  # Standorte zuerst; der Verweis auf den Collector wird erst beim Commit geprüft
    for x in data["collectors"]:
        db.add(m.Collector(id=x["id"], name=x["name"], site_id=x["siteId"], role=x["role"], version=x["version"],
                           status=x["status"], last_heartbeat=_ts(x["lastHeartbeat"], shift), cpu=x["cpu"],
                           memory=x["memory"], queue_length=x["queueLength"]))
    db.flush()

    profiles: dict[str, m.CredentialProfile] = {}
    for x in data["devices"]:
        cfg = x["config"]
        name = cfg["credentialProfile"]
        if name and name not in profiles:
            profiles[name] = m.CredentialProfile(name=name, protocol=cfg["protocol"])
            db.add(profiles[name])
    db.flush()

    for x in data["devices"]:
        cfg = x["config"]
        db.add(m.Device(
            id=x["id"], name=x["name"], ip=x["ip"], type=x["type"], vendor=x["vendor"], model=x["model"], os=x["os"],
            site_id=x["siteId"], description=x["description"], tags=x["tags"],
            boot_time=now - timedelta(days=x["uptimeDays"], hours=3),
            polling_interval_sec=cfg["pollingIntervalSec"], protocol=cfg["protocol"],
            credential_profile_id=profiles[cfg["credentialProfile"]].id if cfg["credentialProfile"] else None,
            notification_group=cfg["notificationGroup"], maintenance_window=cfg["maintenanceWindow"],
        ))
    db.flush()

    for x in data["sensors"]:
        t = x.get("thresholds") or {}
        db.add(m.Sensor(
            id=x["id"], device_id=x["deviceId"], name=x["name"], type=x["type"], unit=x["unit"],
            interval_sec=x["intervalSec"], warning_threshold=t.get("warning"), critical_threshold=t.get("critical"),
            inverted=bool(t.get("inverted", False)), status=x["status"], value=x["value"],
            display_value=x.get("displayValue"), message=x["message"], last_check=_ts(x["lastCheck"], shift),
        ))
    db.flush()

    for x in data["links"]:
        db.add(m.Link(id=x["id"], from_device_id=x["from"], to_device_id=x["to"], bandwidth_mbps=x["bandwidth"],
                      utilization=x["utilization"], status=x["status"], kind=x["kind"]))
    for x in data["alerts"]:
        db.add(m.Alert(
            id=x["id"], severity=x["severity"], state=x["state"], device_id=x["deviceId"], sensor_id=x["sensorId"],
            title=x["title"], description=x["description"], raised_at=_ts(x["raisedAt"], shift),
            resolved_at=_ts(x.get("resolvedAt"), shift), acknowledged_by=x.get("acknowledgedBy"),
            acknowledged_at=_ts(x.get("acknowledgedAt"), shift),
        ))
    for x in data["events"]:
        db.add(m.Event(id=x["id"], at=_ts(x["at"], shift), level=x["level"], device_id=x.get("deviceId"),
                       sensor_id=x.get("sensorId"), message=x["message"]))
    existing_logins = set(db.scalars(select(m.User.login)).all())
    for x in data["users"]:
        if x["login"] in existing_logins:
            continue
        # Demo-Benutzer ohne Passwort: erscheinen in der Verwaltung, können sich aber nicht anmelden
        db.add(m.User(id=x["id"], login=x["login"], name=x["name"], email=x["email"], role=x["role"],
                      active=x["active"], last_login=_ts(x["lastLogin"], shift)))
    for x in data["notificationRules"]:
        db.add(m.NotificationRule(id=x["id"], name=x["name"], trigger=x["trigger"], channel=x["channel"],
                                  target=x["target"], enabled=x["enabled"]))
    for x in data["reports"]:
        db.add(m.Report(id=x["id"], name=x["name"], description=x["description"], period=x["period"],
                        format=x["format"], last_run=_ts(x["lastRun"], shift)))
    db.flush()

    count = _copy_measurements(db, data["measurements"], now)
    db.commit()
    log.info("Demo-Datensatz geladen: %d Geräte, %d Sensoren, %d Messwerte",
             len(data["devices"]), len(data["sensors"]), count)
    return True


def _copy_measurements(db: Session, measurements: dict, now: datetime) -> int:
    """Schreibt die Verlaufsdaten per COPY (schnell, auch bei vielen Werten)."""
    raw = db.connection().connection.driver_connection  # psycopg-Verbindung
    count = 0
    with raw.cursor() as cur, cur.copy("COPY measurements (sensor_id, time, value) FROM STDIN") as copy:
        for sensor_id, tiers in measurements.items():
            for tier in tiers:
                step = timedelta(minutes=tier["stepMin"])
                end = now - timedelta(hours=tier["endsHoursAgo"])
                values = tier["values"]
                n = len(values)
                for i, v in enumerate(values):
                    copy.write_row((sensor_id, end - (n - 1 - i) * step, v))
                count += n
    return count


__all__ = ["ensure_admin", "seed_demo", "load_demo_dataset"]
