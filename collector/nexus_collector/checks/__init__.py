"""Zuordnung Sensortyp + Geräteprotokoll -> Prüfung, einheitliche Fehlerbehandlung."""

from __future__ import annotations

import asyncio
import logging

from . import dns, http, ping, snmp, ssh, wmi
from .base import CheckFailed, CheckMisconfigured, Result, Target

log = logging.getLogger("nexus.collector.checks")

METHOD_BY_PROTOCOL = {"SNMP v2c": "snmp", "SNMP v3": "snmp", "WMI": "wmi", "SSH": "ssh"}
BY_METHOD = {"snmp": snmp.CHECKS, "wmi": wmi.CHECKS, "ssh": ssh.CHECKS}
INDEPENDENT = {"ping": ping.check, "http": http.check, "dns": dns.check}


def resolve(t: Target):
    if t.sensor_type in INDEPENDENT:
        return INDEPENDENT[t.sensor_type]
    method = METHOD_BY_PROTOCOL.get(t.protocol)
    fn = BY_METHOD.get(method or "", {}).get(t.sensor_type)
    if fn is None:
        raise CheckMisconfigured(f"Sensortyp {t.sensor_type} wird für Protokoll {t.protocol} nicht unterstützt")
    return fn


async def run_check(t: Target) -> Result:
    try:
        fn = resolve(t)
        if t.credential_error and t.sensor_type not in INDEPENDENT:
            return Result.config_error(t.credential_error)
        # Zeitlimit: nie länger als das Intervall (mindestens 20 s)
        return await asyncio.wait_for(fn(t), timeout=max(20, min(t.interval_sec, 120)))
    except CheckMisconfigured as exc:
        return Result.config_error(str(exc))
    except CheckFailed as exc:
        return Result.fail(str(exc))
    except asyncio.TimeoutError:
        return Result.fail("Zeitüberschreitung der Prüfung")
    except Exception as exc:  # noqa: BLE001 – eine fehlerhafte Prüfung darf den Collector nie stoppen
        log.exception("Unerwarteter Fehler bei %s/%s", t.device_name, t.sensor_name)
        return Result.config_error(f"Interner Fehler der Prüfung: {type(exc).__name__}: {str(exc)[:200]}")
