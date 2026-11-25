"""HTTP(S)-Abruf: Antwortzeit, Statuscode, optional Suchbegriff im Inhalt."""

from __future__ import annotations

import time

import httpx

from .base import Result, Target

MAX_BODY = 2 * 1024 * 1024  # für die Suche nach dem Schlüsselwort


async def check(t: Target) -> Result:
    url = str(t.settings.get("url") or "")
    timeout = float(t.settings.get("timeoutSec", 10))
    keyword = str(t.settings.get("keyword") or "")
    verify = bool(t.settings.get("verifyTls", True))
    if not url:
        return Result.config_error("Keine URL eingetragen")
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(verify=verify, timeout=timeout, follow_redirects=True,
                                     headers={"User-Agent": "NEXUS-Monitor-Collector"}) as client:
            async with client.stream("GET", url) as resp:
                body = b""
                if keyword:
                    async for chunk in resp.aiter_bytes():
                        body += chunk
                        if len(body) >= MAX_BODY:
                            break
                else:
                    await resp.aread()
                elapsed = (time.perf_counter() - start) * 1000
    except httpx.TimeoutException:
        return Result.fail(f"Zeitüberschreitung nach {timeout:.0f} s", value=timeout * 1000)
    except httpx.ConnectError as exc:
        text = str(exc)
        if "CERTIFICATE_VERIFY_FAILED" in text or "certificate" in text.lower():
            return Result.fail("TLS-Zertifikat ungültig (oder Prüfung im Sensor abschalten)")
        return Result.fail(f"Verbindung fehlgeschlagen: {text[:200]}")
    except httpx.HTTPError as exc:
        return Result.fail(f"HTTP-Fehler: {str(exc)[:200]}")

    elapsed = round(elapsed, 1)
    if resp.status_code >= 400:
        return Result.fail(f"HTTP {resp.status_code} {resp.reason_phrase}", value=elapsed)
    if keyword and keyword.encode() not in body:
        return Result.fail(f"Suchbegriff „{keyword}“ nicht gefunden (HTTP {resp.status_code})", value=elapsed)
    return Result(ok=True, value=elapsed, message=f"HTTP {resp.status_code}")
