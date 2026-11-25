"""Gemeinsame Typen der Prüfungen."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Result:
    """Ergebnis einer Prüfung.

    ok=False      Prüfung fehlgeschlagen (Gerät antwortet nicht, Wert nicht lesbar) -> Zentrale: kritisch
    unknown=True  Messung nicht möglich (Konfiguration, Zugangsdaten)                -> Zentrale: unbekannt
    skip=True     Noch kein Wert (z. B. erster Zählerstand beim Traffic) – nichts senden
    """

    ok: bool
    value: float | None = None
    message: str = ""
    display_value: str | None = None
    unknown: bool = False
    skip: bool = False

    @classmethod
    def fail(cls, message: str, value: float | None = None) -> Result:
        return cls(ok=False, value=value, message=message)

    @classmethod
    def config_error(cls, message: str) -> Result:
        return cls(ok=False, unknown=True, message=message)


class CheckFailed(Exception):
    """Gerät/Dienst antwortet nicht oder liefert Fehler -> Result.fail."""


class CheckMisconfigured(Exception):
    """Zugangsdaten/Einstellungen fehlen oder werden abgelehnt -> Result.config_error."""


@dataclass
class Target:
    """Gerät und Sensor, wie sie die Zentrale ausliefert."""

    device_id: str
    device_name: str
    host: str
    protocol: str
    credentials: dict[str, Any]
    sensor_id: str
    sensor_type: str
    sensor_name: str
    interval_sec: int
    settings: dict[str, Any]
    credential_error: str | None = None
    # Zustand zwischen zwei Messungen desselben Sensors (z. B. Zählerstände)
    state: dict[str, Any] = field(default_factory=dict)


def fmt_bytes(n: float) -> str:
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{n:.0f} {units[i]}" if i < 3 else f"{n:.1f} {units[i]}".replace(".", ",")


def fmt_num(v: float, digits: int = 1) -> str:
    return f"{v:.{digits}f}".replace(".", ",")
