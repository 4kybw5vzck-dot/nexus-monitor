"""Verwaltung: Zugangsprofile, Standorte, Geräte, Sensoren, Collectors.

Rechte:
- Geräte und Sensoren: Administrator und Operator
- Zugangsprofile, Standorte, Collectors: Administrator
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import catalog
from . import models as m
from . import schemas as s
from . import services as svc
from .auth import current_user, require_roles
from .crypto import SecretKeyMissing, SecretUnreadable, decrypt_secret, encrypt_secret
from .db import get_db
from .security import new_token, token_hash

router = APIRouter(prefix="/api", tags=["Verwaltung"])
admin_only = require_roles("Administrator")
operator = require_roles("Administrator", "Operator")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, msg)


def _conflict(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, msg)


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} nicht gefunden")


@router.get("/catalog", dependencies=[Depends(current_user)])
def get_catalog() -> dict:
    return catalog.catalog_for_frontend()


# ---------------------------------------------------------------------------
# Zugangsprofile
# ---------------------------------------------------------------------------

def _profile_to_api(db: Session, p: m.CredentialProfile) -> s.CredentialProfile:
    used = db.scalar(select(func.count()).select_from(m.Device).where(m.Device.credential_profile_id == p.id)) or 0
    fields: dict = {}
    readable = True
    try:
        fields = catalog.public_credentials(p.protocol, decrypt_secret(p.secret_ciphertext))
    except (SecretKeyMissing, SecretUnreadable):
        readable = p.secret_ciphertext is None
    return s.CredentialProfile(
        id=p.id, name=p.name, protocol=p.protocol, description=p.description,
        has_secret=p.secret_ciphertext is not None, readable=readable, fields=fields, device_count=used,
    )


@router.get("/credential-profiles", response_model=list[s.CredentialProfile], dependencies=[Depends(current_user)])
def list_profiles(db: Session = Depends(get_db)):
    return [_profile_to_api(db, p) for p in db.scalars(select(m.CredentialProfile).order_by(m.CredentialProfile.name))]


def _store_credentials(p: m.CredentialProfile, data: dict | None, protocol_changed: bool) -> None:
    if data is None and not protocol_changed:
        return
    if p.protocol == "ICMP":
        p.secret_ciphertext = None
        return
    try:
        old = {} if protocol_changed else decrypt_secret(p.secret_ciphertext)
    except SecretUnreadable:
        old = {}
    try:
        normalized = catalog.normalize_credentials(p.protocol, data or {}, old)
        p.secret_ciphertext = encrypt_secret(normalized)
    except ValueError as exc:
        raise _bad(str(exc)) from None
    except SecretKeyMissing as exc:
        raise _conflict(str(exc)) from None


@router.post("/credential-profiles", response_model=s.CredentialProfile, status_code=201, dependencies=[Depends(admin_only)])
def create_profile(body: s.CredentialProfileInput, db: Session = Depends(get_db)):
    if db.scalar(select(m.CredentialProfile).where(func.lower(m.CredentialProfile.name) == body.name.strip().lower())):
        raise _conflict(f"Zugangsprofil „{body.name}“ existiert bereits")
    p = m.CredentialProfile(name=body.name.strip(), protocol=body.protocol, description=body.description or "")
    _store_credentials(p, body.credentials or {}, protocol_changed=True)
    db.add(p)
    db.commit()
    return _profile_to_api(db, p)


@router.patch("/credential-profiles/{profile_id}", response_model=s.CredentialProfile, dependencies=[Depends(admin_only)])
def update_profile(profile_id: int, body: s.CredentialProfilePatch, db: Session = Depends(get_db)):
    p = db.get(m.CredentialProfile, profile_id)
    if p is None:
        raise _not_found("Zugangsprofil")
    changed = body.protocol is not None and body.protocol != p.protocol
    if changed:
        used = db.scalar(select(func.count()).select_from(m.Device).where(m.Device.credential_profile_id == p.id))
        if used:
            raise _conflict("Protokoll kann nicht geändert werden, solange Geräte das Profil nutzen")
        p.protocol = body.protocol
    if body.name is not None:
        p.name = body.name.strip()
    if body.description is not None:
        p.description = body.description
    _store_credentials(p, body.credentials, protocol_changed=changed)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(f"Zugangsprofil „{body.name}“ existiert bereits") from None
    return _profile_to_api(db, p)


@router.delete("/credential-profiles/{profile_id}", status_code=204, dependencies=[Depends(admin_only)])
def delete_profile(profile_id: int, db: Session = Depends(get_db)):
    p = db.get(m.CredentialProfile, profile_id)
    if p is None:
        raise _not_found("Zugangsprofil")
    used = db.scalar(select(func.count()).select_from(m.Device).where(m.Device.credential_profile_id == p.id))
    if used:
        raise _conflict(f"Zugangsprofil wird von {used} Gerät(en) verwendet")
    db.delete(p)
    db.commit()


# ---------------------------------------------------------------------------
# Standorte
# ---------------------------------------------------------------------------

def _check_collector(db: Session, collector_id: str | None) -> None:
    if collector_id:
        c = db.get(m.Collector, collector_id)
        if c is None:
            raise _bad("Collector nicht gefunden")


@router.post("/sites", response_model=s.Site, status_code=201, dependencies=[Depends(admin_only)])
def create_site(body: s.SiteInput, db: Session = Depends(get_db)):
    _check_collector(db, body.collector_id)
    site = m.Site(id=_new_id("site"), **body.model_dump(exclude={"collector_id"}), collector_id=body.collector_id)
    db.add(site)
    db.commit()
    return s.Site.model_validate(site)


@router.patch("/sites/{site_id}", response_model=s.Site, dependencies=[Depends(admin_only)])
def update_site(site_id: str, body: s.SitePatch, db: Session = Depends(get_db)):
    site = db.get(m.Site, site_id)
    if site is None:
        raise _not_found("Standort")
    data = body.model_dump(exclude_unset=True)
    if "collector_id" in data:
        _check_collector(db, data["collector_id"])
    for k, v in data.items():
        setattr(site, k, v)
    db.commit()
    return s.Site.model_validate(site)


@router.delete("/sites/{site_id}", status_code=204, dependencies=[Depends(admin_only)])
def delete_site(site_id: str, db: Session = Depends(get_db)):
    site = db.get(m.Site, site_id)
    if site is None:
        raise _not_found("Standort")
    count = db.scalar(select(func.count()).select_from(m.Device).where(m.Device.site_id == site_id))
    if count:
        raise _conflict(f"Standort hat noch {count} Gerät(e)")
    db.execute(m.Collector.__table__.update().where(m.Collector.site_id == site_id).values(site_id=None))
    db.delete(site)
    db.commit()


# ---------------------------------------------------------------------------
# Geräte
# ---------------------------------------------------------------------------

def _validate_device_refs(db: Session, data: dict, protocol: str) -> None:
    if "site_id" in data and db.get(m.Site, data["site_id"]) is None:
        raise _bad("Standort nicht gefunden")
    if data.get("collector_id"):
        c = db.get(m.Collector, data["collector_id"])
        if c is None or c.is_demo:
            raise _bad("Collector nicht gefunden (Demo-Collectors fragen keine Geräte ab)")
    pid = data.get("credential_profile_id")
    if pid is not None:
        p = db.get(m.CredentialProfile, pid)
        if p is None:
            raise _bad("Zugangsprofil nicht gefunden")
        if p.protocol != protocol:
            raise _bad(f"Zugangsprofil ist für {p.protocol}, das Gerät nutzt {protocol}")


def _make_sensor(device: m.Device, sensor_type: str, name: str | None, settings: dict | None,
                 interval: int | None = None, thresholds: s.Thresholds | None = None) -> m.Sensor:
    spec = catalog.SENSOR_TYPES[sensor_type]
    try:
        merged = catalog.validate_settings(sensor_type, settings or {})
    except ValueError as exc:
        raise _bad(str(exc)) from None
    t = thresholds.model_dump() if thresholds else spec["thresholds"]
    return m.Sensor(
        id=_new_id("sen"), device_id=device.id, name=(name or spec["name"]).strip(), type=sensor_type,
        unit=spec["unit"], interval_sec=interval or spec["intervalSec"],
        warning_threshold=t["warning"] if t else None, critical_threshold=t["critical"] if t else None,
        inverted=bool(t.get("inverted")) if t else False, settings=merged, status="unknown",
        value=0, message="Noch keine Messung", paused=False,
    )


@router.post("/devices", response_model=s.Device, status_code=201, dependencies=[Depends(operator)])
def create_device(body: s.DeviceInput, db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"create_default_sensors"})
    _validate_device_refs(db, data, body.protocol)
    device = m.Device(id=_new_id("dev"), is_demo=False, paused=False, **data)
    db.add(device)
    db.flush()
    if body.create_default_sensors:
        for sensor_type, name, settings in catalog.default_sensors(body.protocol):
            db.add(_make_sensor(device, sensor_type, name, settings))
    db.add(m.Event(id=_new_id("evt"), at=svc.utcnow(), level="info", device_id=device.id,
                   message=f"{device.name} – Gerät angelegt"))
    db.commit()
    return svc.list_devices(db, device.id)[0]


@router.patch("/devices/{device_id}", response_model=s.Device, dependencies=[Depends(operator)])
def update_device(device_id: str, body: s.DevicePatch, db: Session = Depends(get_db)):
    device = db.get(m.Device, device_id)
    if device is None:
        raise _not_found("Gerät")
    data = body.model_dump(exclude_unset=True)
    protocol = data.get("protocol", device.protocol)
    if "protocol" in data and "credential_profile_id" not in data and device.credential_profile_id is not None:
        data["credential_profile_id"] = None  # Profil passt nicht mehr zum neuen Protokoll
    _validate_device_refs(db, data, protocol)
    if "protocol" in data and data["protocol"] != device.protocol:
        for sensor in device.sensors:
            if catalog.check_sensor_compatible(sensor.type, protocol):
                raise _conflict(f"Sensor „{sensor.name}“ passt nicht zum neuen Protokoll {protocol} – erst entfernen")
    was_paused = device.paused
    for k, v in data.items():
        setattr(device, k, v)
    if "paused" in data and data["paused"] != was_paused:
        db.add(m.Event(id=_new_id("evt"), at=svc.utcnow(), level="info", device_id=device.id,
                       message=f"{device.name} – Überwachung {'pausiert' if device.paused else 'fortgesetzt'}"))
    db.commit()
    return svc.list_devices(db, device.id)[0]


@router.delete("/devices/{device_id}", status_code=204, dependencies=[Depends(operator)])
def delete_device(device_id: str, db: Session = Depends(get_db)):
    device = db.get(m.Device, device_id)
    if device is None:
        raise _not_found("Gerät")
    db.delete(device)  # Sensoren, Messwerte, Alarme, Ereignisse, Verbindungen werden mitgelöscht
    db.commit()


# ---------------------------------------------------------------------------
# Sensoren
# ---------------------------------------------------------------------------

@router.post("/devices/{device_id}/sensors", response_model=s.Sensor, status_code=201, dependencies=[Depends(operator)])
def create_sensor(device_id: str, body: s.SensorInput, db: Session = Depends(get_db)):
    device = db.get(m.Device, device_id)
    if device is None:
        raise _not_found("Gerät")
    problem = catalog.check_sensor_compatible(body.type, device.protocol)
    if problem:
        raise _bad(problem)
    sensor = _make_sensor(device, body.type, body.name, body.settings, body.interval_sec, body.thresholds)
    db.add(sensor)
    db.commit()
    return svc.sensor_to_api(sensor)


@router.patch("/sensors/{sensor_id}", response_model=s.Sensor, dependencies=[Depends(operator)])
def update_sensor(sensor_id: str, body: s.SensorPatch, db: Session = Depends(get_db)):
    sensor = db.get(m.Sensor, sensor_id)
    if sensor is None:
        raise _not_found("Sensor")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        sensor.name = data["name"].strip()
    if "interval_sec" in data:
        sensor.interval_sec = data["interval_sec"]
    if "thresholds" in data:
        t = data["thresholds"]
        sensor.warning_threshold = t["warning"] if t else None
        sensor.critical_threshold = t["critical"] if t else None
        sensor.inverted = bool(t.get("inverted")) if t else False
    if "settings" in data:
        try:
            sensor.settings = catalog.validate_settings(sensor.type, {**(sensor.settings or {}), **(data["settings"] or {})})
        except ValueError as exc:
            raise _bad(str(exc)) from None
    if "paused" in data:
        sensor.paused = data["paused"]
    db.commit()
    return svc.sensor_to_api(sensor)


@router.delete("/sensors/{sensor_id}", status_code=204, dependencies=[Depends(operator)])
def delete_sensor(sensor_id: str, db: Session = Depends(get_db)):
    sensor = db.get(m.Sensor, sensor_id)
    if sensor is None:
        raise _not_found("Sensor")
    db.delete(sensor)
    db.commit()


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------

@router.post("/collectors", response_model=s.CollectorCreated, status_code=201, dependencies=[Depends(admin_only)])
def create_collector(body: s.CollectorInput, db: Session = Depends(get_db)):
    if body.site_id and db.get(m.Site, body.site_id) is None:
        raise _bad("Standort nicht gefunden")
    token = new_token()
    c = m.Collector(id=_new_id("col"), name=body.name.strip(), site_id=body.site_id, role="remote", version="",
                    status="unknown", cpu=0, memory=0, queue_length=0, token_hash=token_hash(token), is_demo=False)
    db.add(c)
    db.commit()
    created = next(x for x in svc.list_collectors(db) if x.id == c.id)
    return s.CollectorCreated(collector=created, token=token)


@router.post("/collectors/{collector_id}/token", response_model=s.CollectorCreated, dependencies=[Depends(admin_only)])
def renew_collector_token(collector_id: str, db: Session = Depends(get_db)):
    c = db.get(m.Collector, collector_id)
    if c is None or c.is_demo:
        raise _not_found("Collector")
    if c.role == "central":
        raise _conflict("Der Token des zentralen Collectors kommt aus NEXUS_COLLECTOR_TOKEN in der .env")
    token = new_token()
    c.token_hash = token_hash(token)
    db.commit()
    created = next(x for x in svc.list_collectors(db) if x.id == c.id)
    return s.CollectorCreated(collector=created, token=token)


@router.delete("/collectors/{collector_id}", status_code=204, dependencies=[Depends(admin_only)])
def delete_collector(collector_id: str, db: Session = Depends(get_db)):
    c = db.get(m.Collector, collector_id)
    if c is None:
        raise _not_found("Collector")
    if c.role == "central" and not c.is_demo:
        raise _conflict("Der zentrale Collector kann nicht gelöscht werden")
    db.execute(m.Device.__table__.update().where(m.Device.collector_id == collector_id).values(collector_id=None))
    db.delete(c)
    db.commit()
