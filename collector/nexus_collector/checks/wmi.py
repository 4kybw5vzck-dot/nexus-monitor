"""Windows über WMI/CIM – abgefragt per WinRM (WS-Management, Port 5985/5986).

Gleiche Klassen wie klassisches WMI (Win32_Processor, Win32_OperatingSystem,
Win32_LogicalDisk, Win32_Service), aber über WinRM statt DCOM. Voraussetzung auf dem
Zielserver: WinRM aktiv (Standard auf Windows Server), Benutzer in den Gruppen
„Remoteverwaltungsbenutzer“ und „Leistungsüberwachungsbenutzer“ oder Administrator.
Anmeldung per NTLM (Domänen- oder lokales Konto).
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from .base import CheckFailed, CheckMisconfigured, Result, Target, fmt_bytes

# Automatisch startende Dienste, die auf aktuellen Windows-Versionen regulär
# beendet sind (Trigger-/verzögerter Start). Ergänzbar je Sensor über "exclude".
DEFAULT_SERVICE_EXCLUDES = {
    "gupdate", "gupdatem", "edgeupdate", "edgeupdatem", "sppsvc", "RemoteRegistry", "MapsBroker",
    "WbioSrvc", "tiledatamodelsvc", "CDPSvc", "BITS", "ShellHWDetection", "TrustedInstaller",
    "wuauserv", "UsoSvc", "WaaSMedicSvc", "stisvc", "AppReadiness", "SysMain", "WSearch",
    "dmwappushservice", "DoSvc", "sedsvc", "MSDTC", "lfsvc",
}
# Benutzerbezogene Dienste mit zufälligem Suffix (z. B. OneSyncSvc_1a2b3)
DEFAULT_SERVICE_PREFIX_EXCLUDES = ("CDPUserSvc_", "OneSyncSvc_", "WpnUserService_", "PimIndexMaintenanceSvc_",
                                   "UnistoreSvc_", "UserDataSvc_", "MessagingService_", "cbdhsvc_")

_SERVICE_NAME = re.compile(r"^[A-Za-z0-9_.\-$ ]{1,256}$")
_DRIVE = re.compile(r"^[A-Za-z]:$")


def _session(t: Target) -> Any:
    import winrm  # erst hier importieren – große Abhängigkeit

    c = t.credentials
    if not c.get("username") or not c.get("password"):
        raise CheckMisconfigured("Kein Zugangsprofil mit Windows-Benutzer und Passwort zugeordnet")
    transport = c.get("transport") or "http"
    port = int(c.get("port") or (5986 if transport == "https" else 5985))
    session = t.state.get("winrm")
    if session is None:
        session = winrm.Session(
            f"{transport}://{t.host}:{port}/wsman",
            auth=(c["username"], c["password"]),
            transport="ntlm",
            server_cert_validation="validate" if c.get("verifyTls", True) else "ignore",
            read_timeout_sec=40, operation_timeout_sec=30,
        )
        t.state["winrm"] = session
    return session


def _run_ps_sync(t: Target, script: str) -> Any:
    from requests.exceptions import ConnectionError as ReqConnectionError
    from requests.exceptions import ReadTimeout
    from winrm.exceptions import InvalidCredentialsError, WinRMTransportError

    session = _session(t)
    wrapped = f"$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; {script} | ConvertTo-Json -Compress -Depth 3"
    try:
        r = session.run_ps(wrapped)
    except InvalidCredentialsError:
        t.state.pop("winrm", None)
        raise CheckMisconfigured("WinRM-Anmeldung abgelehnt (Benutzer/Passwort prüfen)") from None
    except WinRMTransportError as exc:
        t.state.pop("winrm", None)
        if "401" in str(exc):
            raise CheckMisconfigured("WinRM-Anmeldung abgelehnt (Benutzer/Passwort/Berechtigung prüfen)") from None
        raise CheckFailed(f"WinRM-Fehler: {str(exc)[:200]}") from None
    except (ReqConnectionError, ReadTimeout, OSError) as exc:
        t.state.pop("winrm", None)
        raise CheckFailed(f"WinRM nicht erreichbar ({t.host}): {type(exc).__name__}") from None
    if r.status_code != 0:
        err = r.std_err.decode("utf-8", "replace")
        first = next((line.strip() for line in err.splitlines() if line.strip() and not line.startswith("#<")), "")
        if "Access is denied" in err or "Zugriff verweigert" in err:
            raise CheckMisconfigured("WMI-Zugriff verweigert – Benutzer braucht Leserechte auf WMI (root\\cimv2)")
        raise CheckFailed(f"PowerShell-Fehler: {first[:200]}")
    out = r.std_out.decode("utf-8", "replace").strip()
    if not out:
        return None
    return json.loads(out)


async def run_ps(t: Target, script: str) -> Any:
    return await asyncio.to_thread(_run_ps_sync, t, script)


async def cpu(t: Target) -> Result:
    v = await run_ps(t, "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average")
    if v is None:
        raise CheckFailed("Win32_Processor liefert keine Last")
    return Result(ok=True, value=round(float(v), 1), message="Mittel aller Prozessoren")


async def memory(t: Target) -> Result:
    v = await run_ps(t, "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory")
    total, free = int(v["TotalVisibleMemorySize"]) * 1024, int(v["FreePhysicalMemory"]) * 1024
    used = total - free
    return Result(ok=True, value=round(100 * used / total, 1), message=f"{fmt_bytes(used)} von {fmt_bytes(total)} belegt")


async def disk(t: Target) -> Result:
    drive = str(t.settings.get("path") or "C:").strip().rstrip("\\").upper()
    if not _DRIVE.match(drive):
        raise CheckMisconfigured(f"Laufwerk „{drive}“ ungültig – Format z. B. C:")
    v = await run_ps(t, f"Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='{drive}'\" | Select-Object Size,FreeSpace")
    if not v or not v.get("Size"):
        raise CheckMisconfigured(f"Laufwerk {drive} nicht gefunden")
    size, free = int(v["Size"]), int(v["FreeSpace"])
    return Result(ok=True, value=round(100 * (size - free) / size, 1), message=f"{fmt_bytes(free)} von {fmt_bytes(size)} frei")


async def services(t: Target) -> Result:
    wanted = [s for s in t.settings.get("services") or [] if s]
    excludes = {s.lower() for s in t.settings.get("exclude") or []}
    for name in [*wanted, *excludes]:
        if not _SERVICE_NAME.match(name):
            raise CheckMisconfigured(f"Ungültiger Dienstname: {name}")
    if wanted:
        names = ",".join("'" + n.replace("'", "''") + "'" for n in wanted)
        script = f"Get-CimInstance Win32_Service | Where-Object {{ @({names}) -contains $_.Name }} | Select-Object Name,DisplayName,State,StartMode"
    else:
        script = "Get-CimInstance Win32_Service -Filter \"StartMode='Auto'\" | Select-Object Name,DisplayName,State,StartMode"
    data = await run_ps(t, script) or []
    if isinstance(data, dict):
        data = [data]
    if wanted:
        found = {d["Name"].lower() for d in data}
        missing = [n for n in wanted if n.lower() not in found]
    else:
        missing = []
        default_ex = {s.lower() for s in DEFAULT_SERVICE_EXCLUDES}
        data = [d for d in data if d["Name"].lower() not in default_ex
                and not d["Name"].startswith(DEFAULT_SERVICE_PREFIX_EXCLUDES)]
    data = [d for d in data if d["Name"].lower() not in excludes]
    stopped = [d for d in data if d.get("State") != "Running"]
    problems = [f"{d.get('DisplayName') or d['Name']} ({d['Name']})" for d in stopped] + [f"{n} (nicht vorhanden)" for n in missing]
    total = len(data) + len(missing)
    count = len(problems)
    display = f"{total - count} von {total} Diensten laufen"
    if count == 0:
        return Result(ok=True, value=0, message="OK", display_value=display)
    return Result(ok=True, value=count, message=("Gestoppt: " + ", ".join(problems))[:1000], display_value=display)


CHECKS = {"cpu-load": cpu, "memory-usage": memory, "disk-usage": disk, "windows-services": services}
