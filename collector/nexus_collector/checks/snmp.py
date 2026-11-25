"""SNMP v2c/v3 (pysnmp, asyncio).

Herstellerspezifische Werte für Huawei und Cisco, sonst Standard-MIBs
(HOST-RESOURCES-MIB, UCD-SNMP-MIB). Interfaces werden über ifName/ifDescr
oder die Indexnummer gefunden; Traffic aus 64-Bit-Zählern (ifHC*), ersatzweise 32 Bit.
"""

from __future__ import annotations

import time
from typing import Any

from pysnmp.hlapi.v3arch.asyncio import (
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    UsmUserData,
    bulk_walk_cmd,
    get_cmd,
    usmAesCfb128Protocol,
    usmAesCfb256Protocol,
    usmDESPrivProtocol,
    usmHMAC192SHA256AuthProtocol,
    usmHMAC384SHA512AuthProtocol,
    usmHMACMD5AuthProtocol,
    usmHMACSHAAuthProtocol,
    usmNoAuthProtocol,
    usmNoPrivProtocol,
)
from pysnmp.proto.rfc1905 import EndOfMibView, NoSuchInstance, NoSuchObject

from .base import CheckFailed, CheckMisconfigured, Result, Target, fmt_bytes, fmt_num

# --- OIDs -------------------------------------------------------------------
SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0"
IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
IF_OPER = "1.3.6.1.2.1.2.2.1.8"
IF_ADMIN = "1.3.6.1.2.1.2.2.1.7"
IF_IN32, IF_OUT32 = "1.3.6.1.2.1.2.2.1.10", "1.3.6.1.2.1.2.2.1.16"
IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
IF_HC_IN, IF_HC_OUT = "1.3.6.1.2.1.31.1.1.1.6", "1.3.6.1.2.1.31.1.1.1.10"
IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15"
IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18"
HR_PROCESSOR_LOAD = "1.3.6.1.2.1.25.3.3.1.2"
HR_STORAGE_TYPE, HR_STORAGE_DESCR = "1.3.6.1.2.1.25.2.3.1.2", "1.3.6.1.2.1.25.2.3.1.3"
HR_STORAGE_UNITS, HR_STORAGE_SIZE, HR_STORAGE_USED = "1.3.6.1.2.1.25.2.3.1.4", "1.3.6.1.2.1.25.2.3.1.5", "1.3.6.1.2.1.25.2.3.1.6"
HR_STORAGE_RAM = "1.3.6.1.2.1.25.2.1.2"
UCD_CPU_IDLE = "1.3.6.1.4.1.2021.11.11.0"
UCD_LOAD1 = "1.3.6.1.4.1.2021.10.1.3.1"
# Huawei (HUAWEI-ENTITY-EXTENT-MIB)
HW_CPU = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5"
HW_MEM = "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7"
# Cisco (CISCO-PROCESS-MIB, CISCO-MEMORY-POOL-MIB) – auch ASA
CISCO_CPU_1MIN = "1.3.6.1.4.1.9.9.109.1.1.1.1.7"
CISCO_MEM_USED, CISCO_MEM_FREE = "1.3.6.1.4.1.9.9.48.1.1.1.5", "1.3.6.1.4.1.9.9.48.1.1.1.6"

ENTERPRISE_HUAWEI = "1.3.6.1.4.1.2011."
ENTERPRISE_CISCO = "1.3.6.1.4.1.9."

_AUTH = {
    "none": usmNoAuthProtocol, "MD5": usmHMACMD5AuthProtocol, "SHA": usmHMACSHAAuthProtocol,
    "SHA256": usmHMAC192SHA256AuthProtocol, "SHA512": usmHMAC384SHA512AuthProtocol,
}
_PRIV = {"none": usmNoPrivProtocol, "DES": usmDESPrivProtocol, "AES": usmAesCfb128Protocol, "AES256": usmAesCfb256Protocol}

_engine: tuple[object, SnmpEngine] | None = None


def _get_engine() -> SnmpEngine:
    """Eine SNMP-Engine je Event-Loop (pysnmp bindet sie an den Loop, in dem sie entsteht)."""
    import asyncio

    global _engine
    loop = asyncio.get_running_loop()
    if _engine is None or _engine[0] is not loop:
        _engine = (loop, SnmpEngine())
    return _engine[1]


class Snmp:
    """Kleine Hülle um pysnmp für ein Gerät."""

    def __init__(self, t: Target, timeout: float = 3, retries: int = 1) -> None:
        self.t = t
        self.timeout = timeout
        self.retries = retries
        c = t.credentials
        if t.protocol == "SNMP v2c":
            if not c.get("community"):
                raise CheckMisconfigured("Kein Zugangsprofil mit SNMP-Community zugeordnet")
            self.auth: Any = CommunityData(c["community"], mpModel=1)
        elif t.protocol == "SNMP v3":
            if not c.get("username"):
                raise CheckMisconfigured("Kein Zugangsprofil mit SNMPv3-Benutzer zugeordnet")
            auth_proto = c.get("authProtocol", "SHA")
            priv_proto = c.get("privProtocol", "AES")
            self.auth = UsmUserData(
                c["username"],
                authKey=c.get("authPassword") if auth_proto != "none" else None,
                privKey=c.get("privPassword") if priv_proto != "none" else None,
                authProtocol=_AUTH.get(auth_proto, usmHMACSHAAuthProtocol),
                privProtocol=_PRIV.get(priv_proto, usmAesCfb128Protocol),
            )
        else:
            raise CheckMisconfigured(f"Gerät nutzt Protokoll {t.protocol}, nicht SNMP")
        self.port = int(c.get("port") or 161)
        self._target = None

    async def _transport(self):
        if self._target is None:
            try:
                self._target = await UdpTransportTarget.create((self.t.host, self.port), timeout=self.timeout, retries=self.retries)
            except Exception as exc:  # noqa: BLE001 – z. B. Name nicht auflösbar
                raise CheckFailed(f"Adresse {self.t.host} nicht erreichbar: {exc}") from None
        return self._target

    @staticmethod
    def _missing(value: Any) -> bool:
        return value is None or isinstance(value, (NoSuchObject, NoSuchInstance, EndOfMibView))

    def _check_error(self, err_ind: Any, err_status: Any) -> None:
        if err_ind:
            text = str(err_ind)
            if "timeout" in text.lower() or "No SNMP response" in text:
                raise CheckFailed("Keine SNMP-Antwort (Zeitüberschreitung – Community/Zugriffsliste prüfen)")
            if "unknownUserName" in text or "wrongDigest" in text or "decryption" in text.lower():
                raise CheckMisconfigured(f"SNMPv3-Anmeldung abgelehnt: {text}")
            raise CheckFailed(f"SNMP-Fehler: {text}")
        if err_status:
            raise CheckFailed(f"SNMP-Fehler: {err_status.prettyPrint()}")

    async def get(self, *oids: str) -> dict[str, Any]:
        err_ind, err_status, _idx, binds = await get_cmd(
            _get_engine(), self.auth, await self._transport(), ContextData(),
            *[ObjectType(ObjectIdentity(o)) for o in oids],
        )
        self._check_error(err_ind, err_status)
        return {str(name): (None if self._missing(val) else val) for name, val in binds}

    async def walk(self, oid: str, limit: int = 5000) -> dict[str, Any]:
        """Teilbaum als {Index: Wert}; Index = OID-Rest nach `oid`."""
        result: dict[str, Any] = {}
        prefix = oid + "."
        async for err_ind, err_status, _idx, binds in bulk_walk_cmd(
            _get_engine(), self.auth, await self._transport(), ContextData(), 0, 25,
            ObjectType(ObjectIdentity(oid)), lexicographicMode=False,
        ):
            self._check_error(err_ind, err_status)
            for name, val in binds:
                key = str(name)
                if not key.startswith(prefix) or self._missing(val):
                    continue
                result[key[len(prefix):]] = val
                if len(result) >= limit:
                    return result
        return result

    async def vendor(self) -> str:
        cached = self.t.state.get("sysObjectID")
        if cached is None:
            values = await self.get(SYS_OBJECT_ID)
            cached = str(values.get(SYS_OBJECT_ID) or "")
            self.t.state["sysObjectID"] = cached
        if cached.startswith(ENTERPRISE_HUAWEI):
            return "huawei"
        if cached.startswith(ENTERPRISE_CISCO):
            return "cisco"
        return "generic"


def _num(v: Any) -> float:
    return float(int(v)) if hasattr(v, "__int__") else float(str(v))


# --- Prüfungen ----------------------------------------------------------------

async def cpu(t: Target) -> Result:
    s = Snmp(t)
    vendor = await s.vendor()
    if vendor == "huawei":
        vals = [_num(v) for v in (await s.walk(HW_CPU)).values()]
        vals = [v for v in vals if v > 0] or vals
        if vals:
            return _pct_result(max(vals), "Höchste CPU-Last der Baugruppen")
    if vendor == "cisco":
        vals = [_num(v) for v in (await s.walk(CISCO_CPU_1MIN)).values()]
        if vals:
            return _pct_result(sum(vals) / len(vals), "CPU-Last (1 Min.)")
    vals = [_num(v) for v in (await s.walk(HR_PROCESSOR_LOAD)).values()]
    if vals:
        return _pct_result(sum(vals) / len(vals), f"Mittel über {len(vals)} Kerne")
    idle = (await s.get(UCD_CPU_IDLE)).get(UCD_CPU_IDLE)
    if idle is not None:
        return _pct_result(100 - _num(idle), "CPU-Last")
    return Result.config_error("Gerät liefert keine CPU-Werte per SNMP (keine unterstützte MIB)")


async def memory(t: Target) -> Result:
    s = Snmp(t)
    vendor = await s.vendor()
    if vendor == "huawei":
        vals = [_num(v) for v in (await s.walk(HW_MEM)).values()]
        vals = [v for v in vals if v > 0] or vals
        if vals:
            return _pct_result(max(vals), "Höchste Speicherauslastung der Baugruppen")
    if vendor == "cisco":
        used = sum(_num(v) for v in (await s.walk(CISCO_MEM_USED)).values())
        free = sum(_num(v) for v in (await s.walk(CISCO_MEM_FREE)).values())
        if used + free > 0:
            return _pct_result(100 * used / (used + free), f"{fmt_bytes(used)} von {fmt_bytes(used + free)} belegt")
    storage = await _hr_storage(s)
    ram = [x for x in storage if x["type"] == HR_STORAGE_RAM and x["size"] > 0]
    if ram:
        x = ram[0]
        return _pct_result(100 * x["used"] / x["size"], f"{fmt_bytes(x['used'])} von {fmt_bytes(x['size'])} belegt")
    return Result.config_error("Gerät liefert keine Speicherwerte per SNMP (keine unterstützte MIB)")


async def disk(t: Target) -> Result:
    path = str(t.settings.get("path") or "").strip()
    s = Snmp(t)
    storage = await _hr_storage(s)
    wanted = path.rstrip("\\").lower()

    def matches(descr: str) -> bool:
        d = descr.lower()
        # Windows: "C:\\ Label:System  Serial Number …", Linux: "/" oder "/var"
        return d == wanted or d.startswith(wanted + "\\") or d.startswith(wanted + " ")

    found = [x for x in storage if x["size"] > 0 and matches(x["descr"])]
    if not found:
        names = ", ".join(x["descr"].split(" ")[0] for x in storage if x["type"] != HR_STORAGE_RAM)[:200]
        return Result.config_error(f"Datenträger „{path}“ nicht gefunden (vorhanden: {names or 'keine'})")
    x = found[0]
    free = x["size"] - x["used"]
    return _pct_result(100 * x["used"] / x["size"], f"{fmt_bytes(free)} von {fmt_bytes(x['size'])} frei")


async def linux_load(t: Target) -> Result:
    s = Snmp(t)
    v = (await s.get(UCD_LOAD1)).get(UCD_LOAD1)
    if v is None:
        return Result.config_error("Gerät liefert keine Systemlast per SNMP (UCD-SNMP-MIB)")
    load = float(str(v))
    return Result(ok=True, value=round(load, 2), message="OK")


async def _hr_storage(s: Snmp) -> list[dict[str, Any]]:
    descr = await s.walk(HR_STORAGE_DESCR)
    if not descr:
        return []
    types = await s.walk(HR_STORAGE_TYPE)
    units = await s.walk(HR_STORAGE_UNITS)
    sizes = await s.walk(HR_STORAGE_SIZE)
    used = await s.walk(HR_STORAGE_USED)
    out = []
    for idx, d in descr.items():
        u = _num(units.get(idx, 1)) or 1
        out.append({
            "descr": str(d), "type": str(types.get(idx, "")),
            "size": _num(sizes.get(idx, 0)) * u, "used": _num(used.get(idx, 0)) * u,
        })
    return out


def _pct_result(v: float, detail: str) -> Result:
    """Prozentwert als Messwert, Details als Meldung (Anzeige wie im Mock: „42,0 %“)."""
    v = max(0.0, min(100.0, v))
    return Result(ok=True, value=round(v, 1), message=detail)


# --- Interfaces ---------------------------------------------------------------

async def _if_index(s: Snmp, t: Target) -> tuple[str, str]:
    """Index und Anzeigename des Interfaces aus settings.interface (Name, Beschreibung oder Index)."""
    wanted = str(t.settings.get("interface") or "").strip()
    cache = t.state.get("ifIndex")
    if cache and cache[0] == wanted:
        return cache[1], cache[2]
    names = {k: str(v) for k, v in (await s.walk(IF_NAME)).items()}
    descrs = {k: str(v) for k, v in (await s.walk(IF_DESCR)).items()}
    w = wanted.lower()
    idx = None
    for table in (names, descrs):
        idx = next((k for k, v in table.items() if v.lower() == w), None)
        if idx:
            break
    if idx is None and wanted.isdigit() and (wanted in names or wanted in descrs):
        idx = wanted
    if idx is None:
        sample = ", ".join(list(names.values() or descrs.values())[:12])
        raise CheckMisconfigured(f"Interface „{wanted}“ nicht gefunden (z. B.: {sample})")
    label = names.get(idx) or descrs.get(idx) or idx
    t.state["ifIndex"] = (wanted, idx, label)
    return idx, label


def _speed_text(mbit: float) -> str:
    if mbit >= 1000:
        return f"{fmt_num(mbit / 1000, 0 if mbit % 1000 == 0 else 1)} Gbit/s"
    return f"{mbit:.0f} Mbit/s"


async def interface_status(t: Target) -> Result:
    s = Snmp(t)
    idx, label = await _if_index(s, t)
    oids = [f"{IF_OPER}.{idx}", f"{IF_ADMIN}.{idx}", f"{IF_HIGH_SPEED}.{idx}"]
    v = await s.get(*oids)
    oper = v.get(oids[0])
    if oper is None:
        return Result.config_error(f"Status von Interface {label} nicht lesbar")
    oper = int(oper)
    speed = v.get(oids[2])
    speed_text = _speed_text(_num(speed)) if speed not in (None, 0) and _num(speed) > 0 else ""
    if oper == 1:
        return Result(ok=True, value=1, message="OK", display_value=f"Up ({speed_text})" if speed_text else "Up")
    admin = v.get(oids[1])
    states = {2: "down", 3: "testing", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}
    reason = "administrativ deaktiviert" if admin is not None and int(admin) == 2 else states.get(oper, f"Status {oper}")
    return Result(ok=True, value=0, message=f"Interface {label} ist {reason}", display_value="Down")


async def traffic(t: Target) -> Result:
    s = Snmp(t)
    idx, label = await _if_index(s, t)
    hc = [f"{IF_HC_IN}.{idx}", f"{IF_HC_OUT}.{idx}"]
    v = await s.get(*hc)
    bits = 64
    if v.get(hc[0]) is None or v.get(hc[1]) is None:
        lo = [f"{IF_IN32}.{idx}", f"{IF_OUT32}.{idx}"]
        v32 = await s.get(*lo)
        if v32.get(lo[0]) is None:
            return Result.config_error(f"Interface {label} liefert keine Zähler")
        v = {hc[0]: v32[lo[0]], hc[1]: v32[lo[1]]}
        bits = 32
    now = time.monotonic()
    cur = (int(v[hc[0]]), int(v[hc[1]]))
    prev = t.state.get("counters")
    t.state["counters"] = (now, cur, bits)
    if prev is None or prev[2] != bits:
        return Result(ok=True, skip=True)  # erster Zählerstand – Rate erst ab der nächsten Messung
    dt = now - prev[0]
    if dt <= 0:
        return Result(ok=True, skip=True)
    wrap = 2**bits

    def delta(a: int, b: int) -> int:
        return b - a if b >= a else b + wrap - a  # Zählerüberlauf

    din, dout = delta(prev[1][0], cur[0]), delta(prev[1][1], cur[1])
    mbit_in, mbit_out = din * 8 / dt / 1e6, dout * 8 / dt / 1e6
    total = mbit_in + mbit_out
    return Result(ok=True, value=round(total, 3), message=f"Ein {fmt_num(mbit_in, 2)} · Aus {fmt_num(mbit_out, 2)} Mbit/s")


CHECKS = {
    "cpu-load": cpu,
    "memory-usage": memory,
    "disk-usage": disk,
    "linux-load": linux_load,
    "interface-status": interface_status,
    "snmp-traffic": traffic,
}
