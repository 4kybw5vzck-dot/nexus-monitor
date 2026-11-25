# Remote-Collector (Phase 3 – noch nicht umgesetzt)

Ein Collector läuft je Standort als Docker-Container und führt die Messungen lokal aus
(ICMP, SNMP v2c/v3, WMI, SSH, HTTP, DNS, später weitere).

Vorgaben:

- Verbindung wird vom Collector zur Zentrale aufgebaut (HTTPS, Token aus `NEXUS_COLLECTOR_TOKEN`)
- Lokaler Puffer (Volume) für den Betrieb bei WAN-Ausfall
- Zugangsdaten erhält der Collector verschlüsselt aus der Zentrale, sie werden nicht lokal konfiguriert
- Healthcheck und Heartbeat an die Zentrale
