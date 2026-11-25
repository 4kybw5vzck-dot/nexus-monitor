/**
 * Szenarien: gezielte Störungen, damit die Mock-Daten wie ein echter
 * Betriebstag aussehen. Schlüssel = "<deviceId>:<sensorKey>".
 */
import type { Status } from '../api/types';

export interface ActiveScenario {
  value: number;
  /** Ohne Angabe wird der Status über die Schwellwerte ermittelt */
  status?: Status;
  message: string;
  display?: string;
  /** Seit wann der Zustand besteht (Minuten). Ohne Angabe: schleichender Verlauf */
  sinceMin?: number;
  /** Für Alarme mit schleichendem Verlauf: wann der Alarm ausgelöst wurde */
  alertSinceMin?: number;
  ackBy?: string;
  ackAfterMin?: number;
}

export const ACTIVE_SCENARIOS: Record<string, ActiveScenario> = {
  'dev-ma-fs-01:disk-data': { value: 96.4, message: 'Nur noch 18 GB von 500 GB frei', alertSinceMin: 95 },
  'dev-ma-sql-01:mem': { value: 89.2, message: 'Arbeitsspeicher über 85 % (SQL Server Buffer Pool)', alertSinceMin: 180, ackBy: 'm.berger', ackAfterMin: 25 },
  'dev-lu-app-01:http': { value: 10000, status: 'critical', display: 'Timeout', message: 'Zeitüberschreitung nach 10 s (HTTP 504 Gateway Timeout)', sinceMin: 38 },
  'dev-hd-fw-01:ping': { value: 86, message: 'Erhöhte Latenz über VPN-Tunnel zur Zentrale', sinceMin: 55 },
  'dev-lu-sw-02:iface': { value: 0, status: 'critical', display: 'Down', message: 'Uplink XGE0/0/2 down – Betrieb über redundanten Port', sinceMin: 22 },
  'dev-ma-esx-02:cpu': { value: 86.5, message: 'CPU-Last über 80 % (Ready-Zeit erhöht)', sinceMin: 25, ackBy: 'j.keller', ackAfterMin: 8 },
  'dev-ma-bkp-01:services': { value: 1, status: 'critical', display: '37 von 38 Diensten laufen', message: 'Dienst „Veeam Backup Service“ gestoppt', sinceMin: 70 },
  'dev-hd-srv-01:load': { value: 5.3, message: 'Load über Schwellwert (4 CPU-Kerne)', sinceMin: 15 },
  'dev-lu-nas-01:volume': { value: 87.9, message: 'Volume1 zu 87,9 % belegt', alertSinceMin: 600 },
  'dev-ma-web-01:http': { value: 1240, message: 'Antwortzeit über 800 ms', sinceMin: 12 },
  'dev-ma-usv-01:iface': { value: 1, status: 'paused', message: 'Pausiert – Wartungsfenster Netzwerkkarte' },
  'dev-hd-sw-01:cpu': { value: 0, status: 'unknown', message: 'Keine SNMP-Antwort (OID nicht verfügbar)' },
};

export interface ResolvedIncident {
  key: string;
  value: number;
  fromMin: number;
  toMin: number;
  severity: 'critical' | 'warning';
  title: string;
}

export const RESOLVED_INCIDENTS: ResolvedIncident[] = [
  { key: 'dev-lu-fw-01:ping', value: 1000, fromMin: 190, toMin: 176, severity: 'critical', title: 'Standort Ludwigshafen nicht erreichbar' },
  { key: 'dev-ma-core-01:cpu', value: 91, fromMin: 620, toMin: 590, severity: 'warning', title: 'CPU-Last über 80 %' },
  { key: 'dev-ma-dc-01:services', value: 1, fromMin: 300, toMin: 291, severity: 'warning', title: 'Dienst „DFS Replication“ gestoppt' },
  { key: 'dev-hd-fw-01:ping', value: 1000, fromMin: 900, toMin: 868, severity: 'critical', title: 'VPN-Tunnel zur Zentrale getrennt' },
  { key: 'dev-ma-web-01:http', value: 3200, fromMin: 450, toMin: 441, severity: 'critical', title: 'Antwortzeit über 2000 ms' },
  { key: 'dev-lu-hv-01:mem', value: 90, fromMin: 1000, toMin: 940, severity: 'warning', title: 'Arbeitsspeicher über 85 %' },
  { key: 'dev-ma-rt-01:iface', value: 0, fromMin: 1300, toMin: 1291, severity: 'critical', title: 'Interface MPLS down' },
  { key: 'dev-ma-acc-01:cpu', value: 84, fromMin: 1180, toMin: 1165, severity: 'warning', title: 'CPU-Last über 80 %' },
];

/** Allgemeine Systemereignisse (Minuten in der Vergangenheit) */
export const SYSTEM_EVENTS: Array<{ min: number; level: 'info' | 'warning'; message: string; deviceId?: string }> = [
  { min: 5, level: 'info', message: 'Konfiguration von MA-CORE-01 gesichert', deviceId: 'dev-ma-core-01' },
  { min: 32, level: 'warning', message: 'Collector COL-HD-01: Warteschlange über 300 Einträge' },
  { min: 140, level: 'info', message: 'j.keller hat ein Wartungsfenster für MA-USV-01 angelegt', deviceId: 'dev-ma-usv-01' },
  { min: 400, level: 'info', message: 'Discovery 192.0.2.0/24 abgeschlossen – 2 neue Geräte gefunden' },
  { min: 720, level: 'info', message: 'Collector COL-LU-01 auf Version 0.9.3 aktualisiert' },
  { min: 1100, level: 'info', message: 'Benutzer s.aydin hat Schwellwerte für „Datenträger D:“ angepasst', deviceId: 'dev-ma-fs-01' },
];
