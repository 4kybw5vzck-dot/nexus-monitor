from conftest import COLLECTOR

from app import models as m
from app.db import session_scope


def _profile(client, admin, **kw):
    body = {"name": "SNMP Test", "protocol": "SNMP v2c", "credentials": {"community": "geheim-123"}} | kw
    r = client.post("/api/credential-profiles", json=body, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def test_credential_profile_encrypted_and_never_returned(client, admin, operator):
    p = _profile(client, admin, name="SNMP Verschlüsselt")
    assert p["hasSecret"] and p["readable"]
    assert p["fields"] == {"community": True, "port": 161}
    with session_scope() as db:
        raw = db.get(m.CredentialProfile, p["id"]).secret_ciphertext
        assert b"geheim-123" not in raw
    listed = client.get("/api/credential-profiles", headers=operator).json()
    assert "geheim-123" not in str(listed)
    # Operator darf nicht ändern
    assert client.post("/api/credential-profiles", json={"name": "x", "protocol": "SSH"}, headers=operator).status_code == 403
    # Leeres Geheimnis behält den bisherigen Wert, Port wird geändert
    r = client.patch(f"/api/credential-profiles/{p['id']}", json={"credentials": {"community": "", "port": 1161}}, headers=admin)
    assert r.status_code == 200 and r.json()["fields"] == {"community": True, "port": 1161}
    # Pflichtfeld fehlt
    bad = client.post("/api/credential-profiles", json={"name": "WMI ohne PW", "protocol": "WMI", "credentials": {"username": "x"}}, headers=admin)
    assert bad.status_code == 422 and "Passwort" in bad.json()["detail"]
    # SSH braucht Passwort oder Schlüssel
    bad = client.post("/api/credential-profiles", json={"name": "SSH leer", "protocol": "SSH", "credentials": {"username": "x"}}, headers=admin)
    assert bad.status_code == 422


def test_device_with_default_sensors_and_sensor_rules(client, admin, operator, reader):
    prof = _profile(client, admin, name="SNMP Geräte")
    body = {"name": "SW-TEST-01", "ip": "10.0.0.5", "type": "switch", "siteId": "site-ma",
            "protocol": "SNMP v2c", "credentialProfileId": prof["id"]}
    assert client.post("/api/devices", json=body, headers=reader).status_code == 403
    r = client.post("/api/devices", json=body, headers=operator)
    assert r.status_code == 201, r.text
    dev = r.json()
    assert dev["isDemo"] is False and dev["status"] == "unknown" and dev["sensorCount"] == 3
    sensors = client.get(f"/api/sensors?device_id={dev['id']}", headers=reader).json()
    assert sorted(s["type"] for s in sensors) == ["cpu-load", "memory-usage", "ping"]
    # Windows-Dienste passen nicht zu SNMP
    r = client.post(f"/api/devices/{dev['id']}/sensors", json={"type": "windows-services"}, headers=operator)
    assert r.status_code == 422 and "WMI" in r.json()["detail"]
    # Traffic braucht ein Interface
    r = client.post(f"/api/devices/{dev['id']}/sensors", json={"type": "snmp-traffic"}, headers=operator)
    assert r.status_code == 422
    r = client.post(f"/api/devices/{dev['id']}/sensors", json={"type": "snmp-traffic", "name": "Uplink", "settings": {"interface": "GE0/0/1"}}, headers=operator)
    assert r.status_code == 201 and r.json()["unit"] == "Mbit/s"
    # HTTP mit ungültiger URL
    r = client.post(f"/api/devices/{dev['id']}/sensors", json={"type": "http", "settings": {"url": "ftp://x"}}, headers=operator)
    assert r.status_code == 422
    # Profil mit falschem Protokoll
    ssh = client.post("/api/credential-profiles", json={"name": "SSH Test", "protocol": "SSH", "credentials": {"username": "u", "password": "p"}}, headers=admin).json()
    assert client.patch(f"/api/devices/{dev['id']}", json={"credentialProfileId": ssh["id"]}, headers=operator).status_code == 422
    # Profil in Benutzung kann nicht gelöscht werden
    assert client.delete(f"/api/credential-profiles/{prof['id']}", headers=admin).status_code == 409
    # Pausieren
    r = client.patch(f"/api/devices/{dev['id']}", json={"paused": True}, headers=operator)
    assert r.json()["paused"] is True and r.json()["status"] == "paused"
    client.patch(f"/api/devices/{dev['id']}", json={"paused": False}, headers=operator)
    # Löschen
    assert client.delete(f"/api/devices/{dev['id']}", headers=operator).status_code == 204
    assert client.get(f"/api/devices/{dev['id']}", headers=reader).status_code == 404


def test_sites_crud(client, admin, operator):
    r = client.post("/api/sites", json={"name": "Testlabor", "city": "Mannheim"}, headers=admin)
    assert r.status_code == 201
    site = r.json()
    assert client.post("/api/sites", json={"name": "X"}, headers=operator).status_code == 403
    r = client.patch(f"/api/sites/{site['id']}", json={"contact": "IT"}, headers=admin)
    assert r.json()["contact"] == "IT"
    assert client.delete("/api/sites/site-ma", headers=admin).status_code == 409  # hat Geräte
    assert client.delete(f"/api/sites/{site['id']}", headers=admin).status_code == 204


def test_catalog(client, reader):
    cat = client.get("/api/catalog", headers=reader).json()
    assert cat["protocolMethod"]["WMI"] == "wmi"
    assert [s["type"] for s in cat["defaultSensors"]["WMI"]] == ["ping", "cpu-load", "memory-usage", "disk-usage", "windows-services"]
    assert cat["credentialFields"]["SNMP v2c"][0]["secret"] is True


def test_remote_collector_token(client, admin):
    r = client.post("/api/collectors", json={"name": "COL-TEST", "siteId": "site-lu"}, headers=admin)
    assert r.status_code == 201
    created = r.json()
    token = created["token"]
    assert len(token) > 30
    assert client.get("/api/collector/config", headers={"X-Collector-Token": token}).status_code == 200
    renewed = client.post(f"/api/collectors/{created['collector']['id']}/token", headers=admin).json()
    assert client.get("/api/collector/config", headers={"X-Collector-Token": token}).status_code == 401
    assert client.get("/api/collector/config", headers={"X-Collector-Token": renewed["token"]}).status_code == 200
    assert client.delete("/api/collectors/col-central", headers=admin).status_code == 409
    assert client.delete(f"/api/collectors/{created['collector']['id']}", headers=admin).status_code == 204
    assert client.get("/api/collector/config", headers=COLLECTOR).status_code == 200
