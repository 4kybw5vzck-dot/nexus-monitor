from conftest import ADMIN_PASSWORD, login


def test_create_update_password_delete(client, admin, reader):
    body = {"login": "neu.user", "name": "Neuer Benutzer", "email": "neu@example.org", "role": "Operator"}
    assert client.post("/api/users", json=body, headers=reader).status_code == 403
    r = client.post("/api/users", json=body, headers=admin)
    assert r.status_code == 201, r.text
    user = r.json()
    assert user["hasPassword"] is False and user["active"] is True
    # doppelter Login (Groß-/Kleinschreibung egal)
    assert client.post("/api/users", json={**body, "login": "NEU.user"}, headers=admin).status_code == 409
    # ohne Passwort keine Anmeldung
    assert client.post("/api/auth/login", json={"login": "neu.user", "password": "irgendwas-langes"}).status_code == 401
    # Passwort: zu kurz, dann gültig
    assert client.post(f"/api/users/{user['id']}/password", json={"password": "kurz"}, headers=admin).status_code == 422
    assert client.post(f"/api/users/{user['id']}/password", json={"password": "Startpasswort-1"}, headers=admin).status_code == 204
    h = login(client, "neu.user", "Startpasswort-1")
    # Rolle ändern
    r = client.patch(f"/api/users/{user['id']}", json={"role": "Nur Lesen", "name": "Umbenannt"}, headers=admin)
    assert r.json()["role"] == "Nur Lesen" and r.json()["name"] == "Umbenannt"
    # Deaktivieren beendet Sitzungen
    client.patch(f"/api/users/{user['id']}", json={"active": False}, headers=admin)
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert client.delete(f"/api/users/{user['id']}", headers=admin).status_code == 204
    assert client.delete(f"/api/users/{user['id']}", headers=admin).status_code == 404


def test_invalid_login_name(client, admin):
    r = client.post("/api/users", json={"login": "mit leerzeichen", "name": "X", "role": "Operator"}, headers=admin)
    assert r.status_code == 422


def test_cannot_lock_out_self(client, admin):
    me = client.get("/api/auth/me", headers=admin).json()
    assert client.patch(f"/api/users/{me['id']}", json={"role": "Operator"}, headers=admin).status_code == 409
    assert client.patch(f"/api/users/{me['id']}", json={"active": False}, headers=admin).status_code == 409
    assert client.delete(f"/api/users/{me['id']}", headers=admin).status_code == 409


def test_change_own_password(client):
    h1 = login(client, "admin", ADMIN_PASSWORD)
    h2 = login(client, "admin", ADMIN_PASSWORD)
    bad = client.post("/api/auth/password", json={"currentPassword": "falsch", "newPassword": "Neues-Passwort-9"}, headers=h1)
    assert bad.status_code == 403
    same = client.post("/api/auth/password", json={"currentPassword": ADMIN_PASSWORD, "newPassword": ADMIN_PASSWORD}, headers=h1)
    assert same.status_code == 422
    ok = client.post("/api/auth/password", json={"currentPassword": ADMIN_PASSWORD, "newPassword": "Neues-Passwort-9"}, headers=h1)
    assert ok.status_code == 204
    assert client.get("/api/auth/me", headers=h1).status_code == 200   # aktuelle Sitzung bleibt
    assert client.get("/api/auth/me", headers=h2).status_code == 401   # andere Sitzungen beendet
    # zurücksetzen für andere Tests
    client.post("/api/auth/password", json={"currentPassword": "Neues-Passwort-9", "newPassword": ADMIN_PASSWORD}, headers=h1)
