"""API-Tests gegen den Demo-Datensatz. Die erwarteten Zahlen entsprechen dem
Frontend-Mock (frontend/src/mock), aus dem der Datensatz exportiert wird."""

from datetime import datetime

import pytest


def parse(ts: str) -> datetime:
    assert ts.endswith("Z"), ts
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def test_summary_matches_mock(client, reader):
    s = client.get("/api/summary", headers=reader).json()
    assert s["devices"] == 24
    assert s["sensors"] == 115
    assert s["byStatus"] == {"ok": 103, "warning": 6, "critical": 4, "unknown": 1, "paused": 1}
    assert s["activeAlerts"] == 10
    assert 99.0 < s["availability"] < 100


def test_sites(client, reader):
    sites = client.get("/api/sites", headers=reader).json()
    assert {x["id"] for x in sites} == {"site-ma", "site-lu", "site-hd"}
    one = client.get("/api/sites/site-ma", headers=reader).json()
    assert one["collectorId"] == "col-ma"
    assert client.get("/api/sites/nope", headers=reader).status_code == 404


def test_devices_and_derived_status(client, reader):
    devices = client.get("/api/devices", headers=reader).json()
    assert len(devices) == 24
    fs = next(d for d in devices if d["id"] == "dev-ma-fs-01")
    assert fs["status"] == "critical"  # schlechtester Sensorstatus (Datenträger D:)
    assert fs["sensorCount"] == 6
    assert fs["config"]["credentialProfile"].startswith("Profil")
    assert fs["uptimeDays"] > 0
    parse(fs["lastContact"])
    single = client.get("/api/devices/dev-ma-fs-01", headers=reader).json()
    assert single == fs
    assert client.get("/api/devices/nope", headers=reader).status_code == 404


def test_device_status_is_worst_of_sensors(client, reader):
    rank = {"paused": 0, "ok": 1, "unknown": 2, "warning": 3, "critical": 4}
    sensors = client.get("/api/sensors", headers=reader).json()
    for d in client.get("/api/devices", headers=reader).json():
        own = [s["status"] for s in sensors if s["deviceId"] == d["id"]]
        assert d["status"] == max(own, key=rank.get), d["id"]


def test_sensors_filter_and_shape(client, reader):
    all_sensors = client.get("/api/sensors", headers=reader).json()
    assert len(all_sensors) == 115
    own = client.get("/api/sensors", params={"device_id": "dev-ma-fs-01"}, headers=reader).json()
    assert len(own) == 6 and all(s["deviceId"] == "dev-ma-fs-01" for s in own)
    ping = client.get("/api/sensors/sen-ma-fw-01-ping", headers=reader).json()
    assert ping["thresholds"] == {"warning": 50.0, "critical": 200.0, "inverted": False}
    assert client.get("/api/sensors/nope", headers=reader).status_code == 404


@pytest.mark.parametrize("hours,step_min,min_points", [(24, 5, 280), (168, 30, 330), (720, 120, 350)])
def test_sensor_history_resolution(client, reader, hours, step_min, min_points):
    pts = client.get(f"/api/sensors/sen-ma-fw-01-cpu/history?hours={hours}", headers=reader).json()
    if not pts:  # Firewall ohne CPU-Sensor -> anderen Sensor nehmen
        pts = client.get(f"/api/sensors/sen-ma-fw-01-ping/history?hours={hours}", headers=reader).json()
    assert len(pts) >= min_points
    times = [parse(p["t"]) for p in pts]
    assert times == sorted(times)
    gaps = {int((b - a).total_seconds() // 60) for a, b in zip(times, times[1:])}
    assert step_min in gaps


def test_history_validates_hours(client, reader):
    assert client.get("/api/sensors/sen-ma-fw-01-ping/history?hours=0", headers=reader).status_code == 422
    assert client.get("/api/sensors/sen-ma-fw-01-ping/history?hours=99999", headers=reader).status_code == 422


@pytest.mark.parametrize("metric", ["traffic-in", "traffic-out", "cpu", "memory"])
def test_aggregate_series(client, reader, metric):
    pts = client.get(f"/api/metrics/aggregate?metric={metric}&hours=24", headers=reader).json()
    assert len(pts) >= 280
    assert all(p["v"] >= 0 for p in pts)
    if metric in ("cpu", "memory"):
        assert all(p["v"] <= 100 for p in pts)


def test_aggregate_rejects_unknown_metric(client, reader):
    assert client.get("/api/metrics/aggregate?metric=disk", headers=reader).status_code == 422


def test_availability(client, reader):
    av = client.get("/api/availability?hours=24", headers=reader).json()
    assert len(av) == 24
    by_id = {a["deviceId"]: a["availability"] for a in av}
    # Szenarien aus dem Mock: Ausfälle an den Firewalls Heidelberg und Ludwigshafen
    assert 95 < by_id["dev-hd-fw-01"] < 100
    assert 95 < by_id["dev-lu-fw-01"] < 100
    assert by_id["dev-ma-fw-01"] == 100


def test_alerts_sorted_and_site_derived(client, reader):
    alerts = client.get("/api/alerts", headers=reader).json()
    assert len(alerts) == 18
    raised = [a["raisedAt"] for a in alerts]
    assert raised == sorted(raised, reverse=True)
    fs = next(a for a in alerts if a["deviceId"] == "dev-ma-fs-01")
    assert fs["siteId"] == "site-ma"


def test_acknowledge_requires_operator(client, reader):
    alert = next(a for a in client.get("/api/alerts", headers=reader).json() if a["state"] == "active")
    r = client.post(f"/api/alerts/{alert['id']}/acknowledge", headers=reader)
    assert r.status_code == 403


def test_acknowledge_flow(client, operator):
    alerts = client.get("/api/alerts", headers=operator).json()
    alert = next(a for a in alerts if a["state"] == "active")
    r = client.post(f"/api/alerts/{alert['id']}/acknowledge", headers=operator)
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "acknowledged" and body["acknowledgedBy"] == "operator"
    parse(body["acknowledgedAt"])
    # Ereignis wurde geschrieben
    events = client.get(f"/api/devices/{alert['deviceId']}/events", headers=operator).json()
    assert any("Alarm bestätigt von operator" in e["message"] for e in events)
    # Zweites Bestätigen ändert nichts
    again = client.post(f"/api/alerts/{alert['id']}/acknowledge", headers=operator).json()
    assert again["acknowledgedAt"] == body["acknowledgedAt"]
    # Zusammenfassung: bestätigte Alarme bleiben aktiv (nicht behoben)
    assert client.get("/api/summary", headers=operator).json()["activeAlerts"] == 10
    assert client.post("/api/alerts/nope/acknowledge", headers=operator).status_code == 404


def test_events(client, reader):
    events = client.get("/api/events?limit=5", headers=reader).json()
    assert len(events) == 5
    at = [e["at"] for e in events]
    assert at == sorted(at, reverse=True)


def test_links_use_from_to(client, reader):
    links = client.get("/api/links", headers=reader).json()
    assert len(links) == 23
    assert {"from", "to", "bandwidth", "utilization", "status", "kind"} <= set(links[0])


def test_collectors_sensor_counts(client, reader):
    cols = {c["id"]: c for c in client.get("/api/collectors", headers=reader).json()}
    assert cols["col-core"]["sensorCount"] == 115
    assert cols["col-core"]["siteId"] is None
    assert sum(c["sensorCount"] for c in cols.values() if c["role"] == "remote") == 115


def test_users_rules_reports(client, reader):
    users = client.get("/api/users", headers=reader).json()
    assert {"admin", "m.berger", "operator", "leser"} <= {u["login"] for u in users}
    assert all("passwordHash" not in u for u in users)
    assert len(client.get("/api/notification-rules", headers=reader).json()) == 4
    assert len(client.get("/api/reports", headers=reader).json()) == 5


def test_discovery_simulated(client, operator, reader):
    r = client.post("/api/discovery", json={"range": "192.0.2.0/24"}, headers=operator)
    assert r.status_code == 200
    results = r.json()
    known = [x for x in results if x["alreadyMonitored"]]
    new = [x for x in results if not x["alreadyMonitored"]]
    assert known and len(new) == 5
    assert all(x["ip"].startswith("192.0.2.") for x in results)
    assert client.post("/api/discovery", json={"range": "10.0.0.0/8"}, headers=operator).status_code == 422
    assert client.post("/api/discovery", json={"range": "kein-netz"}, headers=operator).status_code == 422
    assert client.post("/api/discovery", json={"range": "192.0.2.0/24"}, headers=reader).status_code == 403


def test_camel_case_everywhere(client, reader):
    for path in ["/api/devices", "/api/sensors", "/api/alerts", "/api/collectors", "/api/users", "/api/events"]:
        item = client.get(path, headers=reader).json()[0]
        assert not [k for k in item if "_" in k], (path, item.keys())
