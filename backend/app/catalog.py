"""Katalog: Sensortypen, Standardwerte, Zuordnung zu Geräteprotokollen,
Standard-Sensoren je Gerätetyp und Felder der Zugangsprofile.

Wird von der API (Prüfung beim Anlegen) und vom Frontend (GET /api/catalog)
genutzt, damit Formulare und Prüfregeln nicht doppelt gepflegt werden.
"""

from __future__ import annotations

from typing import Any

# Prüfverfahren je Geräteprotokoll
PROTOCOL_METHOD = {
    "SNMP v2c": "snmp",
    "SNMP v3": "snmp",
    "WMI": "wmi",
    "SSH": "ssh",
    "ICMP": None,
    "API": None,
}

# Sensortyp -> Standardwerte und erlaubte Verfahren (None = unabhängig vom Geräteprotokoll)
SENSOR_TYPES: dict[str, dict[str, Any]] = {
    "ping": {
        "label": "Ping", "name": "Ping", "unit": "ms", "intervalSec": 60,
        "thresholds": {"warning": 50, "critical": 200}, "methods": None,
        "settings": {"count": 3, "timeoutSec": 2},
    },
    "cpu-load": {
        "label": "CPU-Last", "name": "CPU-Last", "unit": "%", "intervalSec": 60,
        "thresholds": {"warning": 80, "critical": 95}, "methods": ["snmp", "wmi", "ssh"], "settings": {},
    },
    "memory-usage": {
        "label": "Arbeitsspeicher", "name": "Arbeitsspeicher", "unit": "%", "intervalSec": 60,
        "thresholds": {"warning": 85, "critical": 95}, "methods": ["snmp", "wmi", "ssh"], "settings": {},
    },
    "disk-usage": {
        "label": "Datenträger", "name": "Datenträger", "unit": "%", "intervalSec": 300,
        "thresholds": {"warning": 85, "critical": 95}, "methods": ["snmp", "wmi", "ssh"],
        "settings": {"path": ""}, "required": ["path"],
    },
    "snmp-traffic": {
        "label": "SNMP Traffic", "name": "Traffic", "unit": "Mbit/s", "intervalSec": 60,
        "thresholds": None, "methods": ["snmp"], "settings": {"interface": ""}, "required": ["interface"],
    },
    "interface-status": {
        "label": "Interface-Status", "name": "Interface", "unit": "", "intervalSec": 60,
        "thresholds": {"warning": 0.5, "critical": 0.5, "inverted": True}, "methods": ["snmp"],
        "settings": {"interface": ""}, "required": ["interface"],
    },
    "windows-services": {
        "label": "Windows-Dienste", "name": "Windows-Dienste", "unit": "", "intervalSec": 120,
        "thresholds": {"warning": 1, "critical": 2}, "methods": ["wmi"],
        # services leer = alle automatisch startenden Dienste; exclude = Ausnahmen
        "settings": {"services": [], "exclude": []},
    },
    "linux-load": {
        "label": "Linux System Load", "name": "System Load (1 Min.)", "unit": "", "intervalSec": 60,
        "thresholds": {"warning": 4, "critical": 8}, "methods": ["ssh", "snmp"], "settings": {},
    },
    "http": {
        "label": "HTTP", "name": "HTTP", "unit": "ms", "intervalSec": 60,
        "thresholds": {"warning": 800, "critical": 2000}, "methods": None,
        "settings": {"url": "", "timeoutSec": 10, "keyword": "", "verifyTls": True}, "required": ["url"],
    },
    "dns": {
        "label": "DNS", "name": "DNS-Auflösung", "unit": "ms", "intervalSec": 120,
        "thresholds": {"warning": 100, "critical": 500}, "methods": None,
        # server leer = IP-Adresse des Geräts (Gerät ist der DNS-Server)
        "settings": {"name": "", "recordType": "A", "server": ""}, "required": ["name"],
    },
}

DNS_RECORD_TYPES = ("A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT")

# Standard-Sensoren beim Anlegen eines Geräts (zusätzlich zu Ping)
_DEFAULTS_BY_METHOD: dict[str | None, list[tuple[str, str, dict]]] = {
    "snmp": [("cpu-load", "CPU-Last", {}), ("memory-usage", "Arbeitsspeicher", {})],
    "wmi": [
        ("cpu-load", "CPU-Last", {}),
        ("memory-usage", "Arbeitsspeicher", {}),
        ("disk-usage", "Datenträger C:", {"path": "C:"}),
        ("windows-services", "Windows-Dienste", {"services": [], "exclude": []}),
    ],
    "ssh": [
        ("linux-load", "System Load (1 Min.)", {}),
        ("cpu-load", "CPU-Last", {}),
        ("memory-usage", "Arbeitsspeicher", {}),
        ("disk-usage", "Dateisystem /", {"path": "/"}),
    ],
    None: [],
}


def default_sensors(protocol: str) -> list[tuple[str, str, dict]]:
    """(Typ, Name, Einstellungen) der Standard-Sensoren für ein Geräteprotokoll."""
    method = PROTOCOL_METHOD.get(protocol)
    return [("ping", "Ping", dict(SENSOR_TYPES["ping"]["settings"]))] + _DEFAULTS_BY_METHOD.get(method, [])


def check_sensor_compatible(sensor_type: str, protocol: str) -> str | None:
    """Fehlermeldung, wenn der Sensortyp mit dem Geräteprotokoll nicht abgefragt werden kann."""
    methods = SENSOR_TYPES[sensor_type]["methods"]
    if methods is None:
        return None
    method = PROTOCOL_METHOD.get(protocol)
    if method not in methods:
        allowed = ", ".join(p for p, mt in PROTOCOL_METHOD.items() if mt in methods)
        return f"Sensortyp „{SENSOR_TYPES[sensor_type]['label']}“ braucht ein Gerät mit Protokoll {allowed}"
    return None


def validate_settings(sensor_type: str, settings: dict) -> dict:
    """Ergänzt Standardwerte, prüft Pflichtfelder und Typen. Wirft ValueError mit deutscher Meldung."""
    spec = SENSOR_TYPES[sensor_type]
    merged = {**spec["settings"], **(settings or {})}
    unknown = set(merged) - set(spec["settings"])
    if unknown:
        raise ValueError(f"Unbekannte Einstellung(en): {', '.join(sorted(unknown))}")
    for key in spec.get("required", []):
        if not str(merged.get(key) or "").strip():
            raise ValueError(f"Einstellung „{key}“ ist erforderlich")
    if sensor_type == "http":
        url = str(merged["url"]).strip()
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("URL muss mit http:// oder https:// beginnen")
        merged["url"] = url
    if sensor_type == "dns" and merged["recordType"] not in DNS_RECORD_TYPES:
        raise ValueError(f"Unbekannter DNS-Eintragstyp (erlaubt: {', '.join(DNS_RECORD_TYPES)})")
    if sensor_type == "windows-services":
        for key in ("services", "exclude"):
            value = merged[key]
            if isinstance(value, str):
                value = [v.strip() for v in value.replace(";", ",").split(",") if v.strip()]
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise ValueError(f"Einstellung „{key}“ muss eine Liste von Dienstnamen sein")
            merged[key] = value
    for key in ("count", "timeoutSec"):
        if key in merged:
            try:
                merged[key] = int(merged[key])
            except (TypeError, ValueError):
                raise ValueError(f"Einstellung „{key}“ muss eine Zahl sein") from None
            if not 1 <= merged[key] <= 60:
                raise ValueError(f"Einstellung „{key}“ muss zwischen 1 und 60 liegen")
    return merged


# Felder der Zugangsprofile je Protokoll. secret=True: wird nie zurückgegeben.
CREDENTIAL_FIELDS: dict[str, list[dict[str, Any]]] = {
    "SNMP v2c": [
        {"key": "community", "label": "Community", "secret": True, "required": True},
        {"key": "port", "label": "Port", "default": 161},
    ],
    "SNMP v3": [
        {"key": "username", "label": "Benutzer", "required": True},
        {"key": "authProtocol", "label": "Authentifizierung", "default": "SHA", "options": ["none", "MD5", "SHA", "SHA256", "SHA512"]},
        {"key": "authPassword", "label": "Auth-Passwort", "secret": True},
        {"key": "privProtocol", "label": "Verschlüsselung", "default": "AES", "options": ["none", "DES", "AES", "AES256"]},
        {"key": "privPassword", "label": "Priv-Passwort", "secret": True},
        {"key": "port", "label": "Port", "default": 161},
    ],
    "WMI": [
        {"key": "username", "label": "Benutzer (DOMÄNE\\name oder name@domäne)", "required": True},
        {"key": "password", "label": "Passwort", "secret": True, "required": True},
        {"key": "transport", "label": "WinRM-Transport", "default": "http", "options": ["http", "https"]},
        {"key": "port", "label": "Port (leer = 5985/5986)", "default": None},
        {"key": "verifyTls", "label": "TLS-Zertifikat prüfen (https)", "default": True, "type": "bool"},
    ],
    "SSH": [
        {"key": "username", "label": "Benutzer", "required": True},
        {"key": "password", "label": "Passwort", "secret": True},
        {"key": "privateKey", "label": "Privater Schlüssel (OpenSSH-Format)", "secret": True, "multiline": True},
        {"key": "passphrase", "label": "Schlüssel-Passphrase", "secret": True},
        {"key": "port", "label": "Port", "default": 22},
    ],
    "API": [
        {"key": "username", "label": "Benutzer", "required": True},
        {"key": "password", "label": "Passwort", "secret": True, "required": True},
    ],
}


def normalize_credentials(protocol: str, new: dict, old: dict | None = None) -> dict:
    """Übernimmt bekannte Felder. Leere geheime Felder behalten den bisherigen Wert
    (Formular zeigt Geheimnisse nie an). Wirft ValueError bei fehlenden Pflichtfeldern."""
    fields = CREDENTIAL_FIELDS.get(protocol)
    if fields is None:
        raise ValueError(f"Für Protokoll {protocol} werden keine Zugangsdaten benötigt")
    old = old or {}
    result: dict[str, Any] = {}
    for f in fields:
        key = f["key"]
        value = new.get(key)
        # Nicht übermittelt oder (bei Geheimnissen) leer gelassen: bisherigen Wert behalten
        if value in (None, "") and (f.get("secret") or key not in new):
            value = old.get(key)
        if value in (None, "") and f.get("default") is not None:
            value = f["default"]
        if f.get("options") and value not in (None, "") and value not in f["options"]:
            raise ValueError(f"{f['label']}: ungültiger Wert")
        if key == "port" and value not in (None, ""):
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise ValueError("Port muss eine Zahl sein") from None
            if not 1 <= value <= 65535:
                raise ValueError("Port muss zwischen 1 und 65535 liegen")
        if f.get("type") == "bool":
            value = bool(value) if not isinstance(value, str) else value.lower() in ("1", "true", "ja", "on")
        if f.get("required") and value in (None, ""):
            raise ValueError(f"{f['label']} ist erforderlich")
        if value not in (None, ""):
            result[key] = value
    if protocol == "SSH" and not (result.get("password") or result.get("privateKey")):
        raise ValueError("SSH: Passwort oder privater Schlüssel ist erforderlich")
    return result


def public_credentials(protocol: str, data: dict) -> dict:
    """Nicht geheime Felder (z. B. Benutzer, Port) für die Anzeige; geheime nur als 'gesetzt'."""
    out: dict[str, Any] = {}
    for f in CREDENTIAL_FIELDS.get(protocol, []):
        if f.get("secret"):
            out[f["key"]] = bool(data.get(f["key"]))
        elif f["key"] in data:
            out[f["key"]] = data[f["key"]]
    return out


def catalog_for_frontend() -> dict:
    return {
        "sensorTypes": {
            k: {key: v[key] for key in ("label", "name", "unit", "intervalSec", "thresholds", "methods", "settings")}
            | {"required": v.get("required", [])}
            for k, v in SENSOR_TYPES.items()
        },
        "protocolMethod": PROTOCOL_METHOD,
        "credentialFields": CREDENTIAL_FIELDS,
        "dnsRecordTypes": list(DNS_RECORD_TYPES),
        "defaultSensors": {p: [{"type": t, "name": n} for t, n, _ in default_sensors(p)] for p in PROTOCOL_METHOD},
    }
