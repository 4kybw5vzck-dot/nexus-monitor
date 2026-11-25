# NEXUS Monitor – Collector

Führt die Messungen aus und sendet die Ergebnisse an die Zentrale (Backend).
Python 3.12, asyncio. Ein Image für den zentralen Collector (im Compose der Zentrale)
und für Remote-Collectoren an Standorten (`docker-compose.remote.yml`).

## Ablauf

1. Konfiguration holen: `GET /api/collector/config` (Header `X-Collector-Token`), alle 60 s.
   Enthält Geräte, Sensoren und die entschlüsselten Zugangsdaten – nur im Arbeitsspeicher.
2. Jeden Sensor im eingestellten Intervall prüfen (höchstens `NEXUS_MAX_PARALLEL` gleichzeitig).
3. Ergebnisse zuerst in den lokalen Puffer (SQLite im Volume), dann gebündelt an
   `POST /api/collector/results`. Erst nach Bestätigung werden sie aus dem Puffer gelöscht –
   bei WAN-Ausfall oder Neustart gehen keine Messwerte verloren.

## Prüfungen

| Sensortyp | SNMP v2c/v3 | WMI (WinRM) | SSH | unabhängig |
|---|---|---|---|---|
| Ping | | | | ICMP (icmplib, ohne Root) |
| CPU-Last | Huawei, Cisco, HOST-RESOURCES, UCD | Win32_Processor | /proc/stat | |
| Arbeitsspeicher | Huawei, Cisco, HOST-RESOURCES | Win32_OperatingSystem | /proc/meminfo | |
| Datenträger | hrStorage | Win32_LogicalDisk | df | |
| System Load | UCD laLoad | | /proc/loadavg | |
| Interface-Status | ifOperStatus (Name, Beschreibung oder Index) | | | |
| Traffic | ifHCIn/OutOctets (sonst 32 Bit) | | | |
| Windows-Dienste | | Win32_Service | | |
| HTTP | | | | Antwortzeit, Status, Suchbegriff |
| DNS | | | | Auflösung gegen bestimmten Server |

Ergebnisarten: **ok=false** (Gerät antwortet nicht) → Zentrale: kritisch.
**unknown** (Zugangsdaten fehlen/abgelehnt, Wert nicht unterstützt) → Zentrale: unbekannt, kein Alarm.

**WMI** wird über WinRM abgefragt (WS-Management, 5985/5986, NTLM), nicht über DCOM.
Voraussetzung am Server: WinRM aktiv; Benutzer in „Remoteverwaltungsbenutzer“ und
„Leistungsüberwachungsbenutzer“ (oder Administrator).

**SSH:** Der Host-Schlüssel wird beim ersten Kontakt übernommen und für die Laufzeit
des Collectors festgehalten; ändert er sich, schlägt die Prüfung fehl.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `NEXUS_CORE_URL` | `http://backend:8000` | Zentrale |
| `NEXUS_COLLECTOR_TOKEN` | – | Pflicht, mindestens 20 Zeichen |
| `NEXUS_VERIFY_TLS` | `true` | TLS-Zertifikat der Zentrale prüfen |
| `NEXUS_BUFFER_DIR` | `/var/lib/nexus-collector` | Puffer (Volume) |
| `NEXUS_CONFIG_REFRESH_SEC` | `60` | Konfiguration neu laden |
| `NEXUS_SEND_INTERVAL_SEC` | `5` | Ergebnisse senden |
| `NEXUS_MAX_PARALLEL` | `50` | gleichzeitige Prüfungen |
| `NEXUS_MAX_BUFFER_ROWS` | `500000` | danach werden die ältesten Ergebnisse verworfen |

## Entwicklung und Tests

```bash
cd collector
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Prüfungen gegen echte Dienste, wenn angegeben (sonst übersprungen):

```bash
NEXUS_TEST_SNMP=127.0.0.1:161:public \
NEXUS_TEST_SSH=127.0.0.1:22:benutzer:passwort \
NEXUS_TEST_DNS=127.0.0.1:53:name.firma.local:10.0.0.5 pytest
```

WMI/WinRM wird mit einer nachgebildeten WinRM-Sitzung getestet.

Abhängigkeiten aktualisieren: wie im Backend (`requirements.lock` aus einer leeren Umgebung erzeugen, siehe `backend/README.md`).
