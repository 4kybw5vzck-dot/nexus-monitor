/**
 * Domänenmodell von NEXUS Monitor.
 *
 * Diese Typen sind der Vertrag zwischen Oberfläche und Datenquelle. Das spätere
 * FastAPI-Backend liefert dieselben Strukturen als JSON (siehe docs/ARCHITEKTUR.md).
 * Zeitstempel sind ISO-8601-Strings in UTC.
 */

export type Status = 'ok' | 'warning' | 'critical' | 'unknown' | 'paused';

export type DeviceType =
  | 'windows-server'
  | 'linux-server'
  | 'switch'
  | 'router'
  | 'firewall'
  | 'hypervisor-vmware'
  | 'hypervisor-hyperv'
  | 'storage'
  | 'backup'
  | 'ups';

export type SensorType =
  | 'ping'
  | 'snmp-traffic'
  | 'cpu-load'
  | 'memory-usage'
  | 'disk-usage'
  | 'windows-services'
  | 'linux-load'
  | 'interface-status'
  | 'http'
  | 'dns';

export interface Site {
  id: string;
  name: string;
  city: string;
  address: string;
  /** Beispiel-Netz (Dokumentationsbereich nach RFC 5737) */
  subnet: string;
  collectorId: string;
  contact: string;
}

export interface Device {
  id: string;
  name: string;
  /** Ausschließlich Beispieladressen aus RFC 5737 */
  ip: string;
  type: DeviceType;
  vendor: string;
  model: string;
  os: string;
  siteId: string;
  /** Aggregierter Status (schlechtester Sensorstatus) */
  status: Status;
  sensorCount: number;
  lastContact: string;
  uptimeDays: number;
  tags: string[];
  description: string;
  /** Monitoring-Konfiguration (wird später vom Backend verwaltet) */
  config: DeviceConfig;
}

export interface DeviceConfig {
  pollingIntervalSec: number;
  protocol: 'SNMP v3' | 'SNMP v2c' | 'WMI' | 'SSH' | 'ICMP' | 'API';
  /** Verweis auf hinterlegte Zugangsdaten – niemals die Zugangsdaten selbst */
  credentialProfile: string;
  notificationGroup: string;
  maintenanceWindow: string | null;
}

export interface Thresholds {
  warning: number;
  critical: number;
  /** true: Werte UNTER dem Schwellwert sind schlecht (z. B. Verfügbarkeit) */
  inverted?: boolean;
}

export interface Sensor {
  id: string;
  deviceId: string;
  name: string;
  type: SensorType;
  status: Status;
  value: number;
  unit: string;
  /** Lesbarer Messwert, z. B. "3 von 42 Diensten gestoppt" */
  displayValue?: string;
  lastCheck: string;
  intervalSec: number;
  thresholds?: Thresholds;
  message: string;
}

export interface MetricPoint {
  t: string;
  v: number;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertState = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  state: AlertState;
  deviceId: string;
  sensorId: string;
  siteId: string;
  title: string;
  description: string;
  raisedAt: string;
  resolvedAt?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export interface EventLogEntry {
  id: string;
  at: string;
  level: 'critical' | 'warning' | 'info' | 'ok';
  deviceId?: string;
  sensorId?: string;
  message: string;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  /** Bandbreite in Mbit/s */
  bandwidth: number;
  /** Auslastung in Prozent */
  utilization: number;
  status: Status;
  kind: 'lan' | 'uplink' | 'wan' | 'storage';
}

export interface Collector {
  id: string;
  name: string;
  siteId: string | null;
  role: 'central' | 'remote';
  version: string;
  status: Status;
  lastHeartbeat: string;
  sensorCount: number;
  cpu: number;
  memory: number;
  queueLength: number;
}

export interface User {
  id: string;
  name: string;
  login: string;
  role: 'Administrator' | 'Operator' | 'Nur Lesen';
  email: string;
  lastLogin: string;
  active: boolean;
}

export interface NotificationRule {
  id: string;
  name: string;
  trigger: string;
  channel: 'E-Mail' | 'SMS' | 'Webhook' | 'Microsoft Teams';
  target: string;
  enabled: boolean;
}

export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  period: 'Täglich' | 'Wöchentlich' | 'Monatlich';
  lastRun: string;
  format: 'PDF' | 'CSV' | 'HTML';
}

export interface DiscoveryResult {
  ip: string;
  hostname: string;
  vendorGuess: string;
  typeGuess: DeviceType;
  openServices: string[];
  alreadyMonitored: boolean;
}

export interface StatusSummary {
  devices: number;
  sensors: number;
  byStatus: Record<Status, number>;
  /** Verfügbarkeit aller Ping-Sensoren der letzten 24 h in Prozent */
  availability: number;
  activeAlerts: number;
}
