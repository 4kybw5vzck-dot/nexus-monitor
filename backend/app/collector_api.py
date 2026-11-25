"""Schnittstelle für Collectors und Auswertung der Messergebnisse.

Ablauf:
1. Collector holt GET /api/collector/config (Header X-Collector-Token): seine Geräte,
   Sensoren und die entschlüsselten Zugangsdaten.
2. Collector misst und sendet POST /api/collector/results (gebündelt, auch nachträglich
   aus dem Puffer). Messwerte sind idempotent (Primärschlüssel sensor_id + time).
3. Die Zentrale setzt Sensorstatus, eröffnet/aktualisiert/schließt Alarme und schreibt Ereignisse.
4. Ein Hintergrundjob markiert Sensoren ohne aktuelle Messwerte als "unknown" und
   Collectors ohne Lebenszeichen als gestört.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import Field
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from . import models as m
from .config import Settings
from .crypto import SecretKeyMissing, SecretUnreadable, decrypt_secret
from .db import get_db, session_scope
from .schemas import ApiModel
from .security import token_hash
from .services import CENTRAL_COLLECTOR_ID, utcnow

log = logging.getLogger("nexus.collector")
router = APIRouter(prefix="/api/collector", tags=["Collector"])

MIN_TOKEN_LENGTH = 20
MAX_RESULTS_PER_REQUEST = 5000


# ---------------------------------------------------------------------------
# Zentraler Collector und Anmeldung
# ---------------------------------------------------------------------------

def ensure_central_collector(db: Session, settings: Settings) -> None:
    """Legt den zentralen Collector an bzw. aktualisiert dessen Token aus NEXUS_COLLECTOR_TOKEN."""
    token = settings.collector_token
    c = db.get(m.Collector, CENTRAL_COLLECTOR_ID)
    if c is None:
        c = m.Collector(id=CENTRAL_COLLECTOR_ID, name="Zentraler Collector", site_id=None, role="central",
                        version="", status="unknown", cpu=0, memory=0, queue_length=0, is_demo=False)
        db.add(c)
    if len(token) >= MIN_TOKEN_LENGTH:
        c.token_hash = token_hash(token)
    else:
        c.token_hash = None
        if token:
            log.warning("NEXUS_COLLECTOR_TOKEN ist kürzer als %d Zeichen und wird ignoriert", MIN_TOKEN_LENGTH)
        else:
            log.warning("NEXUS_COLLECTOR_TOKEN ist nicht gesetzt – der zentrale Collector kann sich nicht anmelden")
    db.commit()


def current_collector(x_collector_token: str | None = Header(default=None), db: Session = Depends(get_db)) -> m.Collector:
    if not x_collector_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Collector-Token fehlt")
    c = db.scalar(select(m.Collector).where(m.Collector.token_hash == token_hash(x_collector_token)))
    if c is None or c.is_demo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Collector-Token ungültig")
    return c


def _devices_for(db: Session, c: m.Collector):
    cond = m.Device.collector_id == c.id
    if c.id == CENTRAL_COLLECTOR_ID:
        cond = or_(cond, m.Device.collector_id.is_(None))
    return db.scalars(
        select(m.Device).where(cond, m.Device.is_demo.is_(False), m.Device.paused.is_(False)).order_by(m.Device.id)
    ).unique().all()


# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

@router.get("/config")
def get_config(db: Session = Depends(get_db), c: m.Collector = Depends(current_collector)) -> dict:
    devices = []
    for d in _devices_for(db, c):
        credentials: dict = {}
        credential_error = None
        if d.credential_profile is not None:
            try:
                credentials = decrypt_secret(d.credential_profile.secret_ciphertext)
            except (SecretKeyMissing, SecretUnreadable) as exc:
                credential_error = str(exc)
        devices.append({
            "id": d.id, "name": d.name, "host": d.ip, "protocol": d.protocol,
            "credentials": credentials, "credentialError": credential_error,
            "sensors": [
                {"id": se.id, "type": se.type, "name": se.name, "intervalSec": se.interval_sec, "settings": se.settings or {}}
                for se in sorted(d.sensors, key=lambda x: x.id) if not se.paused
            ],
        })
    return {"collectorId": c.id, "name": c.name, "generatedAt": utcnow().isoformat(), "devices": devices}


# ---------------------------------------------------------------------------
# Ergebnisse
# ---------------------------------------------------------------------------

class CheckResult(ApiModel):
    sensor_id: str = Field(max_length=80)
    time: datetime
    # ok=false: Prüfung fehlgeschlagen (z. B. keine Antwort) -> Status kritisch
    ok: bool
    value: float | None = None
    message: str = Field(default="", max_length=2000)
    display_value: str | None = Field(default=None, max_length=300)
    # unknown=true: Messung nicht möglich (z. B. Zugangsdaten fehlen) -> Status unbekannt, kein Alarm
    unknown: bool = False


class CollectorStatus(ApiModel):
    version: str = Field(default="", max_length=50)
    cpu: float = 0
    memory: float = 0
    queue_length: int = 0
    last_error: str | None = Field(default=None, max_length=2000)


class ResultBatch(ApiModel):
    status: CollectorStatus | None = None
    results: list[CheckResult] = Field(default_factory=list, max_length=MAX_RESULTS_PER_REQUEST)


def evaluate(value: float, warning: float | None, critical: float | None, inverted: bool) -> str:
    if warning is None or critical is None:
        return "ok"
    if inverted:
        if value <= critical:
            return "critical"
        if value <= warning:
            return "warning"
        return "ok"
    if value >= critical:
        return "critical"
    if value >= warning:
        return "warning"
    return "ok"


def _event(db: Session, at: datetime, level: str, sensor: m.Sensor, message: str) -> None:
    db.add(m.Event(id=f"evt-{uuid.uuid4().hex[:16]}", at=at, level=level, device_id=sensor.device_id,
                   sensor_id=sensor.id, message=f"{sensor.device.name} – {message}"))


def _open_alert(db: Session, sensor: m.Sensor) -> m.Alert | None:
    return db.scalar(
        select(m.Alert).where(m.Alert.sensor_id == sensor.id, m.Alert.state.in_(("active", "acknowledged")))
        .order_by(m.Alert.raised_at.desc()).limit(1)
    )


def apply_result(db: Session, sensor: m.Sensor, r: CheckResult) -> None:
    """Übernimmt ein Ergebnis als aktuellen Zustand und führt Alarme/Ereignisse nach."""
    if r.unknown:
        new_status = "unknown"
    elif not r.ok:
        new_status = "critical"
    else:
        new_status = evaluate(r.value or 0.0, sensor.warning_threshold, sensor.critical_threshold, sensor.inverted)

    old_status = sensor.status
    sensor.last_check = r.time
    if r.value is not None:
        sensor.value = r.value
    sensor.display_value = r.display_value
    sensor.message = r.message or ("OK" if new_status == "ok" else "")
    if new_status != old_status:
        sensor.status = new_status
        sensor.status_since = r.time

    label = {"critical": "Kritisch", "warning": "Warnung"}
    alert = _open_alert(db, sensor)
    if new_status in ("warning", "critical"):
        description = sensor.message or f"Status {label[new_status]}"
        if alert is None:
            db.add(m.Alert(
                id=f"alr-{uuid.uuid4().hex[:16]}", severity=new_status, state="active", device_id=sensor.device_id,
                sensor_id=sensor.id, title=f"{sensor.name}: {label[new_status]}", description=description,
                raised_at=r.time,
            ))
            _event(db, r.time, new_status, sensor, f"{sensor.name}: {description}")
        elif alert.severity != new_status:
            alert.severity = new_status
            alert.title = f"{sensor.name}: {label[new_status]}"
            alert.description = description
            _event(db, r.time, new_status, sensor, f"{sensor.name}: {description}")
        else:
            alert.description = description
    elif new_status == "ok":
        if alert is not None:
            for a in db.scalars(select(m.Alert).where(m.Alert.sensor_id == sensor.id,
                                                      m.Alert.state.in_(("active", "acknowledged")))):
                a.state = "resolved"
                a.resolved_at = r.time
            _event(db, r.time, "ok", sensor, f"{sensor.name} wieder normal")
    elif new_status == "unknown" and old_status != "unknown":
        _event(db, r.time, "info", sensor, f"{sensor.name}: keine Messung möglich – {sensor.message}")


@router.post("/results")
def post_results(body: ResultBatch, db: Session = Depends(get_db), c: m.Collector = Depends(current_collector)) -> dict:
    now = utcnow()
    allowed = {se.id: se for d in _devices_for(db, c) for se in d.sensors}
    accepted = 0
    rows = []
    for r in sorted(body.results, key=lambda x: x.time):
        sensor = allowed.get(r.sensor_id)
        if sensor is None:
            continue  # gelöschter/pausierter/fremder Sensor – verwerfen
        if r.time > now + timedelta(minutes=5):
            continue  # Uhr des Collectors falsch – nicht in die Zukunft schreiben
        accepted += 1
        if r.value is not None and r.ok and not r.unknown:
            rows.append({"sensor_id": r.sensor_id, "time": r.time, "value": r.value})
        elif not r.ok and not r.unknown and sensor.type == "ping":
            # Ausfall als Messpunkt über der kritischen Schwelle, damit die Verfügbarkeit stimmt
            rows.append({"sensor_id": r.sensor_id, "time": r.time,
                         "value": max(sensor.critical_threshold or 0, r.value or 0) or 1e6})
        if sensor.last_check is None or r.time >= sensor.last_check:
            apply_result(db, sensor, r)
    if rows:
        db.execute(insert(m.Measurement).values(rows).on_conflict_do_nothing(index_elements=["sensor_id", "time"]))

    if body.status is not None:
        c.version = body.status.version
        c.cpu = body.status.cpu
        c.memory = body.status.memory
        c.queue_length = body.status.queue_length
        c.last_error = body.status.last_error
    if c.status != "ok" and c.last_heartbeat is not None:
        db.add(m.Event(id=f"evt-{uuid.uuid4().hex[:16]}", at=now, level="ok",
                       message=f"Collector {c.name} meldet sich wieder"))
    c.last_heartbeat = now
    c.status = "ok"
    db.commit()
    return {"accepted": accepted, "received": len(body.results)}


# ---------------------------------------------------------------------------
# Veraltete Sensoren und Collectors
# ---------------------------------------------------------------------------

STALE_FACTOR = 3
STALE_GRACE = timedelta(minutes=2)


def mark_stale(db: Session, now: datetime | None = None) -> int:
    """Sensoren ohne aktuelle Messung -> unknown; Collectors ohne Lebenszeichen -> warning/critical."""
    now = now or utcnow()
    changed = 0
    sensors = db.scalars(
        select(m.Sensor).join(m.Device).where(
            m.Device.is_demo.is_(False), m.Device.paused.is_(False), m.Sensor.paused.is_(False),
            m.Sensor.status != "unknown",
        )
    ).all()
    for se in sensors:
        reference = se.last_check or se.created_at
        if reference is None or now - reference <= timedelta(seconds=se.interval_sec * STALE_FACTOR) + STALE_GRACE:
            continue
        se.status = "unknown"
        se.status_since = now
        se.message = "Keine aktuellen Messwerte vom Collector"
        _event(db, now, "warning", se, f"{se.name}: keine aktuellen Messwerte")
        changed += 1
    for c in db.scalars(select(m.Collector).where(m.Collector.is_demo.is_(False), m.Collector.last_heartbeat.is_not(None))):
        age = now - c.last_heartbeat
        new = "critical" if age > timedelta(minutes=10) else "warning" if age > timedelta(minutes=3) else c.status
        if new != c.status:
            c.status = new
            db.add(m.Event(id=f"evt-{uuid.uuid4().hex[:16]}", at=now, level=new,
                           message=f"Collector {c.name} meldet sich seit {int(age.total_seconds() // 60)} Minuten nicht"))
            changed += 1
    db.commit()
    return changed


class StaleWatcher:
    """Führt mark_stale regelmäßig in einem Hintergrund-Thread aus."""

    def __init__(self, interval_sec: int = 60) -> None:
        self.interval = interval_sec
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="nexus-stale-watcher", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                with session_scope() as db:
                    mark_stale(db)
            except Exception:  # noqa: BLE001 – Job darf nie abbrechen
                log.exception("Prüfung auf veraltete Sensoren fehlgeschlagen")


__all__ = ["router", "ensure_central_collector", "mark_stale", "StaleWatcher", "apply_result", "evaluate"]
