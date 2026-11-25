"""DNS-Auflösung gegen einen bestimmten DNS-Server (Standard: das Gerät selbst)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time

import dns.asyncresolver
import dns.exception
import dns.resolver

from .base import Result, Target


async def _server_ip(host: str) -> str:
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 53, type=socket.SOCK_DGRAM)
        return infos[0][4][0]


async def check(t: Target) -> Result:
    name = str(t.settings.get("name") or "").strip()
    rtype = str(t.settings.get("recordType") or "A")
    server = str(t.settings.get("server") or "").strip() or t.host
    timeout = float(t.settings.get("timeoutSec", 5))
    if not name:
        return Result.config_error("Kein Name zum Auflösen eingetragen")
    port = 53
    if server.count(":") == 1 and not server.startswith("["):  # host:port
        server, p = server.rsplit(":", 1)
        port = int(p)
    try:
        ip = await _server_ip(server)
    except OSError:
        return Result.config_error(f"DNS-Server „{server}“ nicht auflösbar")
    resolver = dns.asyncresolver.Resolver(configure=False)
    resolver.nameservers = [ip]
    resolver.port = port
    resolver.lifetime = timeout
    start = time.perf_counter()
    try:
        answer = await resolver.resolve(name, rtype, raise_on_no_answer=True)
    except dns.resolver.NXDOMAIN:
        return Result.fail(f"{name}: Name existiert nicht (NXDOMAIN)", value=(time.perf_counter() - start) * 1000)
    except dns.resolver.NoAnswer:
        return Result.fail(f"{name}: kein {rtype}-Eintrag", value=(time.perf_counter() - start) * 1000)
    except dns.exception.Timeout:
        return Result.fail(f"Keine Antwort von DNS-Server {server} ({timeout:.0f} s)", value=timeout * 1000)
    except (dns.resolver.NoNameservers, dns.exception.DNSException) as exc:
        return Result.fail(f"DNS-Fehler: {str(exc)[:200]}")
    elapsed = round((time.perf_counter() - start) * 1000, 1)
    records = [r.to_text() for r in answer]
    shown = ", ".join(records[:3]) + (f" (+{len(records) - 3})" if len(records) > 3 else "")
    return Result(ok=True, value=elapsed, message=f"{name} → {shown}"[:300])
