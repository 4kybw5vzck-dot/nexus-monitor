"""Konfiguration des Collectors – ausschließlich über Umgebungsvariablen."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None or v == "" else v.strip().lower() in ("1", "true", "yes", "ja", "on")


def _int(name: str, default: int) -> int:
    v = os.environ.get(name, "").strip()
    return int(v) if v else default


@dataclass(frozen=True)
class Settings:
    # Adresse der Zentrale (Backend). Zentral im Compose: http://backend:8000,
    # Remote-Collector: https://<server>/ (über den Proxy der Oberfläche)
    core_url: str
    token: str
    buffer_dir: str
    verify_tls: bool
    config_refresh_sec: int
    send_interval_sec: int
    max_parallel: int
    max_buffer_rows: int
    log_level: str

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            core_url=os.environ.get("NEXUS_CORE_URL", "http://backend:8000").rstrip("/"),
            token=os.environ.get("NEXUS_COLLECTOR_TOKEN", ""),
            buffer_dir=os.environ.get("NEXUS_BUFFER_DIR", "/var/lib/nexus-collector"),
            verify_tls=_bool("NEXUS_VERIFY_TLS", True),
            config_refresh_sec=_int("NEXUS_CONFIG_REFRESH_SEC", 60),
            send_interval_sec=_int("NEXUS_SEND_INTERVAL_SEC", 5),
            max_parallel=_int("NEXUS_MAX_PARALLEL", 50),
            max_buffer_rows=_int("NEXUS_MAX_BUFFER_ROWS", 500_000),
            log_level=os.environ.get("NEXUS_LOG_LEVEL", "INFO"),
        )
