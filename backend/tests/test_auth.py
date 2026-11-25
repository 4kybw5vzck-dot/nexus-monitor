from conftest import ADMIN_PASSWORD, login

from app.security import hash_password, verify_password

PROTECTED = [
    "/api/summary", "/api/sites", "/api/devices", "/api/sensors", "/api/alerts", "/api/events",
    "/api/links", "/api/collectors", "/api/users", "/api/notification-rules", "/api/reports",
    "/api/availability", "/api/metrics/aggregate?metric=cpu",
]


def test_password_hash_roundtrip():
    h = hash_password("geheim!")
    assert h.startswith("scrypt$") and "geheim" not in h
    assert verify_password("geheim!", h)
    assert not verify_password("Geheim!", h)
    assert not verify_password("geheim!", None)
    assert hash_password("geheim!") != h  # Salz je Hash


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["database"] == "ok"


def test_endpoints_require_login(client):
    for path in PROTECTED:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers={"Authorization": "Bearer falsch"}).status_code == 401, path


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"login": "admin", "password": "falsch"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Benutzername oder Passwort falsch"


def test_unknown_user_same_message(client):
    r = client.post("/api/auth/login", json={"login": "gibt-es-nicht", "password": "x"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Benutzername oder Passwort falsch"


def test_demo_users_cannot_log_in(client):
    # Demo-Benutzer haben kein Passwort
    r = client.post("/api/auth/login", json={"login": "m.berger", "password": ""})
    assert r.status_code == 422
    r = client.post("/api/auth/login", json={"login": "m.berger", "password": "irgendwas"})
    assert r.status_code == 401


def test_lockout_after_repeated_failures(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"login": "admin", "password": "falsch"})
    r = client.post("/api/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    assert r.status_code == 429


def test_login_me_logout(client):
    headers = login(client, "admin", ADMIN_PASSWORD)
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["login"] == "admin" and me.json()["role"] == "Administrator"
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_login_response_shape(client):
    r = client.post("/api/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    body = r.json()
    assert set(body) == {"token", "expiresAt", "user"}
    assert body["expiresAt"].endswith("Z")
    assert "passwordHash" not in body["user"] and "password_hash" not in body["user"]
