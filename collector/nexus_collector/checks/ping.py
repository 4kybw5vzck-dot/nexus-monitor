"""ICMP-Ping (icmplib, ohne Root: benötigt net.ipv4.ping_group_range im Container)."""

from __future__ import annotations

from icmplib import async_ping
from icmplib.exceptions import ICMPLibError, NameLookupError, SocketPermissionError

from .base import Result, Target


async def check(t: Target) -> Result:
    count = int(t.settings.get("count", 3))
    timeout = int(t.settings.get("timeoutSec", 2))
    try:
        host = await async_ping(t.host, count=count, interval=0.2, timeout=timeout, privileged=False)
    except NameLookupError:
        return Result.fail(f"Name „{t.host}“ nicht auflösbar", value=timeout * 1000)
    except SocketPermissionError:
        return Result.config_error(
            "Ping ohne Root-Rechte nicht erlaubt – im Container net.ipv4.ping_group_range setzen (siehe docker-compose.yml)"
        )
    except ICMPLibError as exc:
        return Result.fail(f"Ping fehlgeschlagen: {exc}", value=timeout * 1000)

    if not host.is_alive:
        return Result.fail("Keine Antwort (100 % Verlust)", value=timeout * 1000)
    loss = round(host.packet_loss * 100)
    message = "OK" if loss == 0 else f"{loss} % Paketverlust"
    return Result(ok=True, value=round(host.avg_rtt, 2), message=message)
