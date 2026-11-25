"""Puffer und Ablaufsteuerung (ohne Zentrale)."""

from __future__ import annotations

import asyncio

from nexus_collector.buffer import ResultBuffer
from nexus_collector.config import Settings
from nexus_collector.engine import Engine


def settings(tmp_path) -> Settings:
    return Settings(core_url="http://127.0.0.1:9", token="x" * 32, buffer_dir=str(tmp_path), verify_tls=True,
                    config_refresh_sec=60, send_interval_sec=5, max_parallel=5, max_buffer_rows=100, log_level="INFO")


def test_buffer_fifo_and_limit(tmp_path):
    b = ResultBuffer(str(tmp_path), max_rows=5)
    b.add_many([{"n": i} for i in range(8)])
    assert b.count() == 5 and b.dropped == 3
    items = b.peek(3)
    assert [p["n"] for _, p in items] == [3, 4, 5]
    b.remove_upto(items[-1][0])
    assert [p["n"] for _, p in b.peek(10)] == [6, 7]
    b.close()
    # bleibt nach Neustart erhalten
    b2 = ResultBuffer(str(tmp_path), max_rows=5)
    assert b2.count() == 2
    b2.close()


CFG = {"devices": [{
    "id": "dev-1", "name": "SW1", "host": "10.0.0.1", "protocol": "SNMP v2c", "credentials": {"community": "c"},
    "sensors": [{"id": "sen-1", "type": "snmp-traffic", "name": "Uplink", "intervalSec": 60, "settings": {"interface": "ge1"}},
                {"id": "sen-2", "type": "ping", "name": "Ping", "intervalSec": 30, "settings": {}}],
}]}


def test_apply_config_keeps_state_until_change(tmp_path):
    async def go():
        e = Engine(settings(tmp_path))
        e.apply_config(CFG)
        assert set(e.targets) == {"sen-1", "sen-2"}
        e.targets["sen-1"].state["counters"] = "alt"
        e.apply_config(CFG)
        assert e.targets["sen-1"].state["counters"] == "alt"  # unverändert -> Zustand bleibt
        changed = {"devices": [{**CFG["devices"][0], "credentials": {"community": "neu"}}]}
        e.apply_config(changed)
        assert e.targets["sen-1"].state == {}  # Zugang geändert -> neu beginnen
        e.apply_config({"devices": []})
        assert e.targets == {} and e.next_due == {}
        await e.client.aclose()
        e.buffer.close()

    asyncio.run(go())


def test_status_report(tmp_path):
    async def go():
        e = Engine(settings(tmp_path))
        st = e.status()
        assert st["queueLength"] == 0 and "version" in st
        await e.client.aclose()
        e.buffer.close()

    asyncio.run(go())
