"""Ablaufsteuerung: Konfiguration holen, Sensoren im Intervall prüfen, Ergebnisse senden."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from datetime import datetime, timezone

import httpx

from . import __version__
from .buffer import ResultBuffer
from .checks import run_check, ssh
from .checks.base import Target
from .config import Settings

log = logging.getLogger("nexus.collector")

SEND_BATCH = 1000


class CoreError(Exception):
    pass


class Engine:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.buffer = ResultBuffer(settings.buffer_dir, settings.max_buffer_rows)
        self.targets: dict[str, Target] = {}
        self.next_due: dict[str, float] = {}
        self.running: set[str] = set()
        self.sem = asyncio.Semaphore(settings.max_parallel)
        self.stop_event = asyncio.Event()
        self.last_error: str | None = None
        self.client = httpx.AsyncClient(
            base_url=settings.core_url, verify=settings.verify_tls, timeout=30,
            headers={"X-Collector-Token": settings.token, "User-Agent": f"NEXUS-Collector/{__version__}"},
        )
        self._cpu_sample = (time.monotonic(), time.process_time())
        self.config_loaded = asyncio.Event()

    # ---------- Zentrale ----------

    async def fetch_config(self) -> None:
        try:
            r = await self.client.get("/api/collector/config")
        except httpx.HTTPError as exc:
            raise CoreError(f"Zentrale nicht erreichbar ({self.s.core_url}): {type(exc).__name__}") from None
        if r.status_code == 401:
            raise CoreError("Zentrale lehnt den Collector-Token ab (NEXUS_COLLECTOR_TOKEN prüfen)")
        if r.status_code != 200:
            raise CoreError(f"Zentrale antwortet mit HTTP {r.status_code}")
        self.apply_config(r.json())

    def apply_config(self, cfg: dict) -> None:
        """Übernimmt die Konfiguration; Zustand (Zähler, Sitzungen) bleibt je Sensor erhalten,
        solange sich Gerät/Zugang nicht ändern."""
        new: dict[str, Target] = {}
        now = time.monotonic()
        for d in cfg.get("devices", []):
            for sen in d.get("sensors", []):
                t = Target(
                    device_id=d["id"], device_name=d["name"], host=d["host"], protocol=d["protocol"],
                    credentials=d.get("credentials") or {}, credential_error=d.get("credentialError"),
                    sensor_id=sen["id"], sensor_type=sen["type"], sensor_name=sen["name"],
                    interval_sec=max(10, int(sen["intervalSec"])), settings=sen.get("settings") or {},
                )
                old = self.targets.get(t.sensor_id)
                if old and (old.host, old.protocol, old.credentials, old.settings) == (t.host, t.protocol, t.credentials, t.settings):
                    t.state = old.state
                new[t.sensor_id] = t
                if t.sensor_id not in self.next_due:
                    # Erste Messung über das Intervall verteilen (keine Lastspitze beim Start)
                    self.next_due[t.sensor_id] = now + random.uniform(0, min(t.interval_sec, 30))
        for gone in set(self.next_due) - set(new):
            self.next_due.pop(gone, None)
        if len(new) != len(self.targets):
            log.info("Konfiguration: %d Geräte, %d Sensoren", len(cfg.get("devices", [])), len(new))
        self.targets = new
        self.config_loaded.set()

    def status(self) -> dict:
        now = (time.monotonic(), time.process_time())
        dt = now[0] - self._cpu_sample[0]
        cpu = 100 * (now[1] - self._cpu_sample[1]) / dt / (os.cpu_count() or 1) if dt > 0 else 0
        self._cpu_sample = now
        mem = 0.0
        try:
            with open("/proc/self/status") as fh:
                rss = next(int(line.split()[1]) for line in fh if line.startswith("VmRSS:"))
            with open("/proc/meminfo") as fh:
                total = next(int(line.split()[1]) for line in fh if line.startswith("MemTotal:"))
            mem = 100 * rss / total
        except (OSError, StopIteration, ValueError):
            pass
        return {"version": __version__, "cpu": round(cpu, 1), "memory": round(mem, 1),
                "queueLength": self.buffer.count(), "lastError": self.last_error}

    async def send_once(self) -> int:
        """Sendet bis zu SEND_BATCH gepufferte Ergebnisse. Gibt die Anzahl zurück."""
        items = self.buffer.peek(SEND_BATCH)
        body = {"status": self.status(), "results": [p for _, p in items]}
        try:
            r = await self.client.post("/api/collector/results", json=body)
        except httpx.HTTPError as exc:
            raise CoreError(f"Senden fehlgeschlagen: {type(exc).__name__}") from None
        if r.status_code == 401:
            raise CoreError("Zentrale lehnt den Collector-Token ab (NEXUS_COLLECTOR_TOKEN prüfen)")
        if r.status_code == 422:
            # Fehlerhafte Einträge nicht endlos wiederholen
            log.error("Zentrale lehnt %d Ergebnisse ab (422) – werden verworfen", len(items))
        elif r.status_code != 200:
            raise CoreError(f"Zentrale antwortet beim Senden mit HTTP {r.status_code}")
        if items:
            self.buffer.remove_upto(items[-1][0])
        return len(items)

    # ---------- Messen ----------

    async def _measure(self, t: Target) -> None:
        try:
            async with self.sem:
                started = datetime.now(timezone.utc)
                result = await run_check(t)
        finally:
            self.running.discard(t.sensor_id)
        if result.skip:
            return
        self.buffer.add_many([{
            "sensorId": t.sensor_id, "time": started.isoformat(), "ok": result.ok, "value": result.value,
            "message": result.message[:2000], "displayValue": result.display_value, "unknown": result.unknown,
        }])
        if not result.ok:
            log.debug("%s / %s: %s", t.device_name, t.sensor_name, result.message)

    async def scheduler_loop(self) -> None:
        tasks: set[asyncio.Task] = set()
        while not self.stop_event.is_set():
            now = time.monotonic()
            for sid, t in list(self.targets.items()):
                due = self.next_due.get(sid, now)
                if due <= now and sid not in self.running:
                    self.running.add(sid)
                    self.next_due[sid] = max(due + t.interval_sec, now)  # kein Aufholen nach Pausen
                    task = asyncio.create_task(self._measure(t))
                    tasks.add(task)
                    task.add_done_callback(tasks.discard)
            await self._sleep(0.5)
        for task in tasks:
            task.cancel()

    async def config_loop(self) -> None:
        delay = 5
        while not self.stop_event.is_set():
            try:
                await self.fetch_config()
                self.last_error = None
                delay = self.s.config_refresh_sec
            except CoreError as exc:
                self.last_error = str(exc)
                log.warning("%s – nächster Versuch in %d s (Messungen laufen mit letzter Konfiguration weiter)", exc, delay)
                delay = min(max(delay * 2, 5), self.s.config_refresh_sec)
            await self._sleep(delay)

    async def send_loop(self) -> None:
        backoff = self.s.send_interval_sec
        failing = False
        while not self.stop_event.is_set():
            try:
                sent = total = await self.send_once()
                while sent == SEND_BATCH and not self.stop_event.is_set():  # Rückstau abbauen
                    sent = await self.send_once()
                    total += sent
                if failing:
                    log.info("Verbindung zur Zentrale wiederhergestellt – %d Ergebnisse nachgesendet", total)
                    failing = False
                    self.last_error = None
                backoff = self.s.send_interval_sec
            except CoreError as exc:
                self.last_error = str(exc)
                log.warning("%s – %d Ergebnisse im Puffer", exc, self.buffer.count())
                failing = True
                backoff = min(backoff * 2, 60)
            await self._sleep(backoff)

    async def _sleep(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self.stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def run(self) -> None:
        log.info("NEXUS Collector %s startet – Zentrale %s, Puffer %s", __version__, self.s.core_url, self.buffer.path)
        try:
            await asyncio.gather(self.config_loop(), self.scheduler_loop(), self.send_loop())
        finally:
            try:
                await asyncio.wait_for(self.send_once(), timeout=10)  # letzte Ergebnisse noch senden
            except (CoreError, asyncio.TimeoutError):
                pass
            await ssh.close_all()
            await self.client.aclose()
            self.buffer.close()
            log.info("Collector beendet")
