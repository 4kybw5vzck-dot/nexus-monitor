"""Tests der Prüfungen.

Gegen echte Dienste, wenn diese über Umgebungsvariablen angegeben sind (sonst übersprungen):
  NEXUS_TEST_SNMP=host:port:community      z. B. 127.0.0.1:16100:nexus-test (net-snmp snmpd)
  NEXUS_TEST_SSH=host:port:user:password   z. B. 127.0.0.1:2222:nexustest:geheim
  NEXUS_TEST_DNS=server:port:name:ip       z. B. 127.0.0.1:5353:srv.nexus.test:192.0.2.55
WMI/WinRM wird mit einer nachgebildeten WinRM-Sitzung geprüft.
"""

from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import threading

import pytest

from nexus_collector.checks import dns, ping, run_check, snmp, ssh, wmi
from nexus_collector.checks import http as http_check
from nexus_collector.checks.base import Target


def T(sensor_type: str, host: str = "127.0.0.1", protocol: str = "ICMP", credentials: dict | None = None, **settings) -> Target:
    return Target("dev-1", "TEST", host, protocol, credentials or {}, "sen-1", sensor_type, "Sensor", 60, settings)


def run(coro):
    return asyncio.run(coro)


def env(name: str) -> list[str] | None:
    v = os.environ.get(name)
    return v.split(":") if v else None


# --- Ping -------------------------------------------------------------------

def test_ping_localhost():
    r = run(ping.check(T("ping", count=2, timeoutSec=1)))
    if r.unknown:
        pytest.skip(r.message)  # ICMP ohne Root in dieser Umgebung nicht erlaubt
    assert r.ok and r.value is not None and r.value >= 0


def test_ping_unresolvable_name():
    r = run(ping.check(T("ping", host="gibt-es-nicht.invalid", count=1, timeoutSec=1)))
    assert not r.ok and "nicht auflösbar" in r.message


# --- HTTP -------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/ok":
            body = b"<html>NEXUS-Statusseite OK</html>"
            self.send_response(200)
        else:
            body = b"kaputt"
            self.send_response(503)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D401
        pass


@pytest.fixture(scope="module")
def web():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_http_ok_and_keyword(web):
    r = run(http_check.check(T("http", url=f"{web}/ok", keyword="Statusseite")))
    assert r.ok and r.value is not None and "HTTP 200" in r.message
    r = run(http_check.check(T("http", url=f"{web}/ok", keyword="fehlt")))
    assert not r.ok and "Suchbegriff" in r.message


def test_http_error_status_and_refused(web):
    r = run(http_check.check(T("http", url=f"{web}/kaputt")))
    assert not r.ok and "503" in r.message
    r = run(http_check.check(T("http", url="http://127.0.0.1:1/", timeoutSec=2)))
    assert not r.ok and "Verbindung fehlgeschlagen" in r.message


# --- SNMP -------------------------------------------------------------------

def _snmp_target(sensor_type: str, **settings) -> Target:
    cfg = env("NEXUS_TEST_SNMP")
    if not cfg:
        pytest.skip("NEXUS_TEST_SNMP nicht gesetzt")
    host, port, community = cfg
    return T(sensor_type, host=host, protocol="SNMP v2c", credentials={"community": community, "port": int(port)}, **settings)


@pytest.mark.parametrize("sensor_type,settings", [
    ("cpu-load", {}), ("memory-usage", {}), ("disk-usage", {"path": "/"}), ("linux-load", {}),
    ("interface-status", {"interface": "lo"}),
])
def test_snmp_values(sensor_type, settings):
    r = run(run_check(_snmp_target(sensor_type, **settings)))
    assert r.ok and not r.unknown, r.message
    assert r.value is not None


def test_snmp_traffic_needs_two_samples():
    t = _snmp_target("snmp-traffic", interface="lo")

    async def twice():
        first = await snmp.traffic(t)
        await asyncio.sleep(1.1)
        return first, await snmp.traffic(t)

    first, second = run(twice())
    assert first.skip
    assert second.ok and second.value is not None and second.value >= 0 and "Ein" in second.message


def test_snmp_unknown_interface_and_wrong_community():
    r = run(run_check(_snmp_target("interface-status", interface="gibtsnicht0")))
    assert r.unknown and "nicht gefunden" in r.message
    t = _snmp_target("cpu-load")
    t.credentials = {**t.credentials, "community": "falsch"}
    r = run(run_check(t))
    assert not r.ok and not r.unknown and "Keine SNMP-Antwort" in r.message


def test_snmp_without_profile():
    r = run(run_check(T("cpu-load", protocol="SNMP v2c")))
    assert r.unknown and "Community" in r.message


def test_traffic_counter_wrap():
    """Zählerüberlauf (32 Bit) wird korrekt berechnet."""
    import time as _time

    t = T("snmp-traffic", protocol="SNMP v2c", interface="x")
    wrap = 2**32
    t.state["counters"] = (_time.monotonic() - 10, (wrap - 1000, wrap - 500), 32)

    class Fake(snmp.Snmp):
        def __init__(self, *_a, **_k):
            self.t = t

        async def get(self, *oids):
            if oids[0].startswith(snmp.IF_HC_IN):
                return {oids[0]: None, oids[1]: None}
            return {oids[0]: 124000, oids[1]: 1000}

        async def walk(self, oid, limit=5000):
            return {"1": "x"}

    orig = snmp.Snmp
    snmp.Snmp = Fake
    try:
        r = run(snmp.traffic(t))
    finally:
        snmp.Snmp = orig
    # Eingang: 1000 + 124000 Byte in ~10 s -> ~0,1 Mbit/s
    assert r.ok and 0.05 < r.value < 0.2


# --- SSH --------------------------------------------------------------------

def _ssh_target(sensor_type: str, **settings) -> Target:
    cfg = env("NEXUS_TEST_SSH")
    if not cfg:
        pytest.skip("NEXUS_TEST_SSH nicht gesetzt")
    host, port, user, password = cfg
    return T(sensor_type, host=host, protocol="SSH",
             credentials={"username": user, "password": password, "port": int(port)}, **settings)


@pytest.mark.parametrize("sensor_type", ["linux-load", "cpu-load", "memory-usage", "disk-usage"])
def test_ssh_values(sensor_type):
    async def go():
        try:
            return await run_check(_ssh_target(sensor_type, path="/"))
        finally:
            await ssh.close_all()

    r = run(go())
    assert r.ok, r.message
    assert r.value is not None


def test_ssh_wrong_password_is_config_error():
    t = _ssh_target("cpu-load")
    t.credentials = {**t.credentials, "password": "falsch"}

    async def go():
        try:
            return await run_check(t)
        finally:
            await ssh.close_all()

    r = run(go())
    assert r.unknown and "abgelehnt" in r.message


# --- DNS --------------------------------------------------------------------

def test_dns_resolves():
    cfg = env("NEXUS_TEST_DNS")
    if not cfg:
        pytest.skip("NEXUS_TEST_DNS nicht gesetzt")
    server, port, name, ip = cfg
    r = run(dns.check(T("dns", host=server, name=name, server=f"{server}:{port}")))
    assert r.ok and ip in r.message


def test_dns_timeout():
    # Port ohne DNS-Server -> keine Antwort
    r = run(dns.check(T("dns", name="example.org", server="127.0.0.1:9", timeoutSec=1)))
    assert not r.ok


# --- WMI über WinRM (nachgebildet) ------------------------------------------

class _FakeResponse:
    def __init__(self, out: str, status: int = 0, err: str = ""):
        self.std_out = out.encode()
        self.std_err = err.encode()
        self.status_code = status


class _FakeSession:
    def __init__(self, answers):
        self.answers = answers
        self.scripts = []

    def run_ps(self, script):
        self.scripts.append(script)
        for key, resp in self.answers.items():
            if key in script:
                return resp
        raise AssertionError(f"Unerwartetes Skript: {script}")


def _wmi_target(sensor_type: str, answers: dict, **settings) -> Target:
    t = T(sensor_type, host="srv01.example.org", protocol="WMI",
          credentials={"username": "LAB\\mon", "password": "pw"}, **settings)
    t.state["winrm"] = _FakeSession(answers)
    return t


def test_wmi_cpu_memory_disk():
    r = run(wmi.cpu(_wmi_target("cpu-load", {"Win32_Processor": _FakeResponse("23.5")})))
    assert r.ok and r.value == 23.5
    mem = '{"TotalVisibleMemorySize":8388608,"FreePhysicalMemory":2097152}'
    r = run(wmi.memory(_wmi_target("memory-usage", {"Win32_OperatingSystem": _FakeResponse(mem)})))
    assert r.ok and r.value == 75.0 and "von 8,0 GB" in r.message
    t = _wmi_target("disk-usage", {"Win32_LogicalDisk": _FakeResponse('{"Size":100000000000,"FreeSpace":10000000000}')}, path="d:")
    r = run(wmi.disk(t))
    assert r.ok and r.value == 90.0
    assert "DeviceID='D:'" in t.state["winrm"].scripts[0]


def test_wmi_disk_rejects_injection():
    t = _wmi_target("disk-usage", {}, path="C:'; Remove-Item x")
    r = run(run_check(t))
    assert r.unknown and "ungültig" in r.message


def test_wmi_services_default_and_excludes():
    data = ('[{"Name":"W32Time","DisplayName":"Windows-Zeitgeber","State":"Running","StartMode":"Auto"},'
            '{"Name":"Spooler","DisplayName":"Druckwarteschlange","State":"Stopped","StartMode":"Auto"},'
            '{"Name":"gupdate","DisplayName":"Google Update","State":"Stopped","StartMode":"Auto"},'
            '{"Name":"OneSyncSvc_1a2b","DisplayName":"Sync","State":"Stopped","StartMode":"Auto"}]')
    r = run(wmi.services(_wmi_target("windows-services", {"Win32_Service": _FakeResponse(data)})))
    assert r.value == 1 and "Druckwarteschlange" in r.message and r.display_value == "1 von 2 Diensten laufen"
    r = run(wmi.services(_wmi_target("windows-services", {"Win32_Service": _FakeResponse(data)}, exclude=["Spooler"])))
    assert r.value == 0 and r.display_value == "1 von 1 Diensten laufen"


def test_wmi_services_explicit_list_reports_missing():
    data = '{"Name":"W32Time","DisplayName":"Windows-Zeitgeber","State":"Running","StartMode":"Auto"}'
    t = _wmi_target("windows-services", {"Win32_Service": _FakeResponse(data)}, services=["W32Time", "NTDS"])
    r = run(wmi.services(t))
    assert r.value == 1 and "NTDS (nicht vorhanden)" in r.message
    assert "'W32Time','NTDS'" in t.state["winrm"].scripts[0]


def test_wmi_access_denied_is_config_error():
    t = _wmi_target("cpu-load", {"Win32_Processor": _FakeResponse("", 1, "Get-CimInstance : Access is denied.")})
    r = run(run_check(t))
    assert r.unknown and "verweigert" in r.message


def test_wmi_without_profile():
    r = run(run_check(T("cpu-load", host="srv", protocol="WMI")))
    assert r.unknown and "Zugangsprofil" in r.message


def test_unsupported_combination():
    r = run(run_check(T("windows-services", protocol="SSH")))
    assert r.unknown and "nicht unterstützt" in r.message
