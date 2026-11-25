"""Kompletter Ablauf: Gerät anlegen -> Collector holt Konfiguration -> Ergebnisse ->
Status, Messwerte, Alarm, Behebung, veraltete Sensoren."""

from datetime import datetime, timedelta, timezone

from conftest import COLLECTOR

from app.collector_api import mark_stale
from app.db import session_scope


def ts(minutes_ago: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def test_collector_needs_token(client):
    assert client.get("/api/collector/config").status_code == 401
    assert client.get("/api/collector/config", headers={"X-Collector-Token": "falsch"}).status_code == 401


def test_full_cycle(client, admin, operator, reader):
    prof = client.post("/api/credential-profiles", json={"name": "WMI Labor", "protocol": "WMI",
                       "credentials": {"username": "LAB\\\\monitor", "password": "Pw-123456"}}, headers=admin).json()
    dev = client.post("/api/devices", json={"name": "SRV-LAB-01", "ip": "srv-lab-01.example.org", "type": "windows-server",
                      "siteId": "site-ma", "protocol": "WMI", "credentialProfileId": prof["id"]}, headers=operator).json()

    cfg = client.get("/api/collector/config", headers=COLLECTOR).json()
    assert cfg["collectorId"] == "col-central"
    mine = [d for d in cfg["devices"] if d["id"] == dev["id"]]
    assert len(mine) == 1
    assert mine[0]["credentials"]["password"] == "Pw-123456"  # nur der Collector erhält Klartext
    assert not any(d["id"].startswith("dev-ma-") for d in cfg["devices"])  # Demo-Geräte nie abfragen
    sensors = {s["type"]: s["id"] for s in mine[0]["sensors"]}

    # 1) alles OK
    r = client.post("/api/collector/results", headers=COLLECTOR, json={
        "status": {"version": "0.3.0", "cpu": 3, "memory": 20, "queueLength": 0},
        "results": [
            {"sensorId": sensors["ping"], "time": ts(2), "ok": True, "value": 1.2},
            {"sensorId": sensors["cpu-load"], "time": ts(2), "ok": True, "value": 30},
            {"sensorId": sensors["disk-usage"], "time": ts(2), "ok": True, "value": 50},
            {"sensorId": sensors["windows-services"], "time": ts(2), "ok": True, "value": 0, "displayValue": "80 von 80 Diensten laufen"},
            {"sensorId": "sen-gibt-es-nicht", "time": ts(2), "ok": True, "value": 1},
        ]})
    assert r.json() == {"accepted": 4, "received": 5}
    d = client.get(f"/api/devices/{dev['id']}", headers=reader).json()
    assert d["sensorCount"] == 5
    s_map = {s["type"]: s for s in client.get(f"/api/sensors?device_id={dev['id']}", headers=reader).json()}
    assert s_map["ping"]["status"] == "ok" and s_map["ping"]["value"] == 1.2
    assert s_map["windows-services"]["displayValue"] == "80 von 80 Diensten laufen"
    assert s_map["memory-usage"]["status"] == "unknown"  # noch keine Messung

    # 2) Datenträger kritisch -> Alarm + Ereignis
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["disk-usage"], "time": ts(1), "ok": True, "value": 97, "message": "Nur noch 3 GB frei"}]})
    alerts = [a for a in client.get("/api/alerts", headers=reader).json() if a["sensorId"] == sensors["disk-usage"]]
    assert len(alerts) == 1 and alerts[0]["state"] == "active" and alerts[0]["severity"] == "critical"
    assert alerts[0]["description"] == "Nur noch 3 GB frei"
    # wiederholte kritische Werte erzeugen keinen zweiten Alarm
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["disk-usage"], "time": ts(0.5), "ok": True, "value": 98}]})
    assert len([a for a in client.get("/api/alerts", headers=reader).json() if a["sensorId"] == sensors["disk-usage"]]) == 1

    # 3) Ping-Ausfall -> kritisch, Messpunkt zählt für die Verfügbarkeit
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["ping"], "time": ts(0.4), "ok": False, "message": "Keine Antwort (100 % Verlust)"}]})
    ping = client.get(f"/api/sensors/{sensors['ping']}", headers=reader).json()
    assert ping["status"] == "critical" and "Keine Antwort" in ping["message"]
    avail = {a["deviceId"]: a["availability"] for a in client.get("/api/availability?hours=24", headers=reader).json()}
    assert avail[dev["id"]] < 100

    # 4) Erholung -> Alarme behoben
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["disk-usage"], "time": ts(0.2), "ok": True, "value": 60},
        {"sensorId": sensors["ping"], "time": ts(0.2), "ok": True, "value": 0.9}]})
    alerts = [a for a in client.get("/api/alerts", headers=reader).json() if a["deviceId"] == dev["id"]]
    assert alerts and all(a["state"] == "resolved" for a in alerts)
    events = client.get(f"/api/devices/{dev['id']}/events", headers=reader).json()
    assert any("wieder normal" in e["message"] for e in events)

    # 5) Älteres, gepuffertes Ergebnis ändert den aktuellen Zustand nicht, landet aber im Verlauf
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["cpu-load"], "time": ts(10), "ok": True, "value": 99}]})
    cpu = client.get(f"/api/sensors/{sensors['cpu-load']}", headers=reader).json()
    assert cpu["value"] == 30 and cpu["status"] == "ok"
    assert any(p["v"] == 99 for p in client.get(f"/api/sensors/{sensors['cpu-load']}/history?hours=1", headers=reader).json())
    # doppelte Übertragung ist unschädlich
    r = client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["cpu-load"], "time": ts(10), "ok": True, "value": 99}]})
    assert r.status_code == 200

    # 6) Zugangsdaten-Problem -> unknown, kein Alarm
    client.post("/api/collector/results", headers=COLLECTOR, json={"results": [
        {"sensorId": sensors["memory-usage"], "time": ts(0.1), "ok": False, "unknown": True, "message": "WinRM: Zugriff verweigert"}]})
    mem = client.get(f"/api/sensors/{sensors['memory-usage']}", headers=reader).json()
    assert mem["status"] == "unknown" and "Zugriff verweigert" in mem["message"]
    assert not [a for a in client.get("/api/alerts", headers=reader).json() if a["sensorId"] == sensors["memory-usage"]]

    # 7) Collector-Lebenszeichen
    central = next(c for c in client.get("/api/collectors", headers=reader).json() if c["id"] == "col-central")
    assert central["status"] == "ok" and central["version"] == "0.3.0" and central["sensorCount"] >= 5

    # 8) Veraltete Sensoren -> unknown
    with session_scope() as db:
        changed = mark_stale(db, now=datetime.now(timezone.utc) + timedelta(hours=1))
    assert changed >= 4
    ping = client.get(f"/api/sensors/{sensors['ping']}", headers=reader).json()
    assert ping["status"] == "unknown" and "Keine aktuellen Messwerte" in ping["message"]
    # Demo-Sensoren bleiben unberührt
    assert client.get("/api/summary", headers=reader).json()["byStatus"]["critical"] >= 4

    # 9) Pausierter Sensor wird nicht mehr ausgeliefert
    client.patch(f"/api/sensors/{sensors['cpu-load']}", json={"paused": True}, headers=operator)
    cfg = client.get("/api/collector/config", headers=COLLECTOR).json()
    mine = next(d for d in cfg["devices"] if d["id"] == dev["id"])
    assert sensors["cpu-load"] not in [s["id"] for s in mine["sensors"]]
    client.delete(f"/api/devices/{dev['id']}", headers=operator)
