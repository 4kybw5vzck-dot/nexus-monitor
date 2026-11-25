"""Linux/Unix über SSH (asyncssh): Systemlast, CPU, Arbeitsspeicher, Dateisystem.

Verbindungen werden je Gerät wiederverwendet. Host-Schlüssel: Beim ersten Kontakt
wird der Schlüssel übernommen und für die Laufzeit des Collectors festgehalten;
ändert er sich, schlägt die Prüfung fehl (Schutz gegen untergeschobene Server).
"""

from __future__ import annotations

import asyncio
import shlex
from typing import Any

import asyncssh

from .base import CheckFailed, CheckMisconfigured, Result, Target, fmt_bytes

_connections: dict[tuple[str, int, str], asyncssh.SSHClientConnection] = {}
_host_keys: dict[tuple[str, int], str] = {}
_locks: dict[tuple[str, int, str], asyncio.Lock] = {}


class _PinningClient(asyncssh.SSHClient):
    def __init__(self, host_port: tuple[str, int]) -> None:
        self.host_port = host_port

    def validate_host_public_key(self, host, addr, port, key) -> bool:  # noqa: ANN001
        fp = key.get_fingerprint()
        known = _host_keys.get(self.host_port)
        if known is None:
            _host_keys[self.host_port] = fp
            return True
        return known == fp


async def _connection(t: Target) -> asyncssh.SSHClientConnection:
    c = t.credentials
    user = c.get("username")
    if not user or not (c.get("password") or c.get("privateKey")):
        raise CheckMisconfigured("Kein Zugangsprofil mit SSH-Benutzer und Passwort/Schlüssel zugeordnet")
    port = int(c.get("port") or 22)
    key = (t.host, port, user)
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        conn = _connections.get(key)
        if conn is not None and not conn.is_closed():
            return conn
        options: dict[str, Any] = {
            "username": user, "port": port, "known_hosts": None, "connect_timeout": 10,
            "client_factory": lambda: _PinningClient((t.host, port)),
        }
        if c.get("privateKey"):
            try:
                options["client_keys"] = [asyncssh.import_private_key(c["privateKey"], c.get("passphrase") or None)]
            except (asyncssh.KeyImportError, ValueError) as exc:
                raise CheckMisconfigured(f"Privater Schlüssel ungültig: {exc}") from None
        if c.get("password"):
            options["password"] = c["password"]
        try:
            conn = await asyncssh.connect(t.host, **options)
        except asyncssh.PermissionDenied:
            raise CheckMisconfigured("SSH-Anmeldung abgelehnt (Benutzer/Passwort/Schlüssel prüfen)") from None
        except asyncssh.HostKeyNotVerifiable:
            raise CheckFailed("SSH-Host-Schlüssel hat sich geändert – Verbindung abgelehnt") from None
        except (OSError, asyncssh.Error, asyncio.TimeoutError) as exc:
            raise CheckFailed(f"SSH-Verbindung fehlgeschlagen: {str(exc) or type(exc).__name__}") from None
        _connections[key] = conn
        return conn


async def run(t: Target, command: str, timeout: float = 20) -> str:
    conn = await _connection(t)
    try:
        result = await conn.run(command, check=False, timeout=timeout)
    except (asyncssh.Error, OSError, asyncio.TimeoutError) as exc:
        conn.close()
        raise CheckFailed(f"SSH-Befehl fehlgeschlagen: {str(exc) or type(exc).__name__}") from None
    if result.exit_status not in (0, None):
        err = (result.stderr or "").strip()[:200]
        raise CheckFailed(f"Befehl meldet Fehler ({result.exit_status}): {err}")
    return str(result.stdout or "")


async def linux_load(t: Target) -> Result:
    out = await run(t, "cat /proc/loadavg")
    load = float(out.split()[0])
    return Result(ok=True, value=round(load, 2), message="OK")


async def cpu(t: Target) -> Result:
    out = await run(t, "head -n1 /proc/stat; sleep 1; head -n1 /proc/stat")
    lines = [line.split() for line in out.splitlines() if line.startswith("cpu ")]
    if len(lines) < 2:
        raise CheckFailed("Unerwartete Ausgabe von /proc/stat")
    a, b = ([int(x) for x in line[1:]] for line in lines[:2])
    idle_a, idle_b = a[3] + (a[4] if len(a) > 4 else 0), b[3] + (b[4] if len(b) > 4 else 0)
    total = sum(b) - sum(a)
    busy = 100 * (1 - (idle_b - idle_a) / total) if total > 0 else 0.0
    return Result(ok=True, value=round(max(0.0, min(100.0, busy)), 1), message="OK")


async def memory(t: Target) -> Result:
    out = await run(t, "cat /proc/meminfo")
    info = {}
    for line in out.splitlines():
        parts = line.replace(":", " ").split()
        if len(parts) >= 2 and parts[1].isdigit():
            info[parts[0]] = int(parts[1]) * 1024
    total = info.get("MemTotal")
    avail = info.get("MemAvailable", info.get("MemFree", 0) + info.get("Buffers", 0) + info.get("Cached", 0))
    if not total:
        raise CheckFailed("Unerwartete Ausgabe von /proc/meminfo")
    used = total - avail
    return Result(ok=True, value=round(100 * used / total, 1), message=f"{fmt_bytes(used)} von {fmt_bytes(total)} belegt")


async def disk(t: Target) -> Result:
    path = str(t.settings.get("path") or "/")
    out = await run(t, f"df -P -k -- {shlex.quote(path)}")
    rows = [line.split() for line in out.strip().splitlines()[1:]]
    if not rows or len(rows[-1]) < 6:
        raise CheckFailed(f"Dateisystem {path} nicht gefunden")
    _fs, size_k, used_k, avail_k, _cap, mount = rows[-1][:6]
    size, used, avail = int(size_k) * 1024, int(used_k) * 1024, int(avail_k) * 1024
    # wie df: belegt / (belegt + verfügbar), reservierte Blöcke zählen nicht als frei
    pct = 100 * used / (used + avail) if used + avail else 0
    return Result(ok=True, value=round(pct, 1), message=f"{fmt_bytes(avail)} von {fmt_bytes(size)} frei ({mount})")


CHECKS = {"linux-load": linux_load, "cpu-load": cpu, "memory-usage": memory, "disk-usage": disk}


async def close_all() -> None:
    for conn in list(_connections.values()):
        conn.close()
    _connections.clear()
