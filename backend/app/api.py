"""REST-Endpunkte – bilden das Frontend-Interface MonitoringDataSource ab
(Tabelle in docs/ARCHITEKTUR.md). Alle Endpunkte außer /api/health erfordern eine Anmeldung.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import __version__
from . import models as m
from . import schemas as s
from . import services as svc
from .auth import current_user, require_roles, user_to_api
from .db import get_db

public = APIRouter(prefix="/api", tags=["System"])
router = APIRouter(prefix="/api", tags=["Monitoring"], dependencies=[Depends(current_user)])

MAX_HOURS = 24 * 90


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} nicht gefunden")


@public.get("/health", response_model=s.Health)
def health(db: Session = Depends(get_db)) -> s.Health:
    try:
        db.execute(text("SELECT 1"))
        timescale = bool(db.scalar(text("SELECT count(*) FROM pg_extension WHERE extname = 'timescaledb'")))
        return s.Health(status="ok", version=__version__, database="ok", timescaledb=timescale)
    except Exception:  # noqa: BLE001 – Healthcheck darf nicht selbst fehlschlagen
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "degraded", "version": __version__, "database": "error"},
        ) from None


@router.get("/summary", response_model=s.StatusSummary)
def summary(db: Session = Depends(get_db)):
    return svc.summary(db)


# --- Standorte -----------------------------------------------------------------

@router.get("/sites", response_model=list[s.Site])
def sites(db: Session = Depends(get_db)):
    return [s.Site.model_validate(x) for x in db.scalars(select(m.Site).order_by(m.Site.name))]


@router.get("/sites/{site_id}", response_model=s.Site)
def site(site_id: str, db: Session = Depends(get_db)):
    x = db.get(m.Site, site_id)
    if x is None:
        raise _not_found("Standort")
    return s.Site.model_validate(x)


# --- Geräte --------------------------------------------------------------------

@router.get("/devices", response_model=list[s.Device])
def devices(db: Session = Depends(get_db)):
    return svc.list_devices(db)


@router.get("/devices/{device_id}", response_model=s.Device)
def device(device_id: str, db: Session = Depends(get_db)):
    found = svc.list_devices(db, device_id)
    if not found:
        raise _not_found("Gerät")
    return found[0]


@router.get("/devices/{device_id}/events", response_model=list[s.EventLogEntry])
def device_events(device_id: str, limit: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    q = select(m.Event).where(m.Event.device_id == device_id).order_by(m.Event.at.desc()).limit(limit)
    return [s.EventLogEntry.model_validate(e) for e in db.scalars(q)]


# --- Sensoren ------------------------------------------------------------------

@router.get("/sensors", response_model=list[s.Sensor])
def sensors(device_id: str | None = None, db: Session = Depends(get_db)):
    q = select(m.Sensor).order_by(m.Sensor.device_id, m.Sensor.id)
    if device_id:
        q = q.where(m.Sensor.device_id == device_id)
    return [svc.sensor_to_api(x) for x in db.scalars(q)]


@router.get("/sensors/{sensor_id}", response_model=s.Sensor)
def sensor(sensor_id: str, db: Session = Depends(get_db)):
    x = db.get(m.Sensor, sensor_id)
    if x is None:
        raise _not_found("Sensor")
    return svc.sensor_to_api(x)


@router.get("/sensors/{sensor_id}/history", response_model=list[s.MetricPoint])
def sensor_history(sensor_id: str, hours: int = Query(24, ge=1, le=MAX_HOURS), db: Session = Depends(get_db)):
    x = db.get(m.Sensor, sensor_id)
    if x is None:
        raise _not_found("Sensor")
    return svc.sensor_history(db, x, hours)


# --- Kennzahlen ----------------------------------------------------------------

@router.get("/metrics/aggregate", response_model=list[s.MetricPoint])
def aggregate(
    metric: Literal["traffic-in", "traffic-out", "cpu", "memory"],
    hours: int = Query(24, ge=1, le=MAX_HOURS),
    db: Session = Depends(get_db),
):
    return svc.aggregate_series(db, metric, hours)


@router.get("/availability", response_model=list[s.Availability])
def availability(hours: int = Query(24, ge=1, le=MAX_HOURS), db: Session = Depends(get_db)):
    return svc.availability(db, hours)


# --- Alarme und Ereignisse -----------------------------------------------------

@router.get("/alerts", response_model=list[s.Alert])
def alerts(db: Session = Depends(get_db)):
    return [svc.alert_to_api(a) for a in db.scalars(select(m.Alert).order_by(m.Alert.raised_at.desc()))]


@router.post("/alerts/{alert_id}/acknowledge", response_model=s.Alert)
def acknowledge(
    alert_id: str,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_roles("Administrator", "Operator")),
):
    a = db.get(m.Alert, alert_id)
    if a is None:
        raise _not_found("Alarm")
    return svc.alert_to_api(svc.acknowledge_alert(db, a, user.login))


@router.get("/events", response_model=list[s.EventLogEntry])
def events(limit: int = Query(50, ge=1, le=1000), db: Session = Depends(get_db)):
    q = select(m.Event).order_by(m.Event.at.desc(), m.Event.id).limit(limit)
    return [s.EventLogEntry.model_validate(e) for e in db.scalars(q)]


# --- Weitere Stammdaten ---------------------------------------------------------

@router.get("/links", response_model=list[s.Link])
def links(db: Session = Depends(get_db)):
    return [svc.link_to_api(x) for x in db.scalars(select(m.Link).order_by(m.Link.id))]


@router.get("/collectors", response_model=list[s.Collector])
def collectors(db: Session = Depends(get_db)):
    return svc.list_collectors(db)


@router.get("/users", response_model=list[s.User])
def users(db: Session = Depends(get_db)):
    return [user_to_api(u) for u in db.scalars(select(m.User).order_by(m.User.name))]


@router.get("/notification-rules", response_model=list[s.NotificationRule])
def notification_rules(db: Session = Depends(get_db)):
    return [s.NotificationRule.model_validate(x) for x in db.scalars(select(m.NotificationRule).order_by(m.NotificationRule.id))]


@router.get("/reports", response_model=list[s.ReportDefinition])
def reports(db: Session = Depends(get_db)):
    return [s.ReportDefinition.model_validate(x) for x in db.scalars(select(m.Report).order_by(m.Report.id))]


# --- Discovery -----------------------------------------------------------------

@router.post(
    "/discovery",
    response_model=list[s.DiscoveryResult],
    dependencies=[Depends(require_roles("Administrator", "Operator"))],
)
def discovery(body: s.DiscoveryRequest, db: Session = Depends(get_db)):
    """Simuliert – es findet kein Netzwerkscan statt. Echte Discovery folgt mit der Monitoring-Engine (Phase 3)."""
    try:
        return svc.simulate_discovery(db, body.range)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Ungültiger Bereich: {exc}") from None
