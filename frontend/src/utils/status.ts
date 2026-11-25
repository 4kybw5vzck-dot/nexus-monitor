import type { AlertSeverity, DeviceType, SensorType, Status, Thresholds } from '../api/types';

/** Rangfolge: höherer Wert = schlechterer Zustand */
const STATUS_RANK: Record<Status, number> = {
  paused: 0,
  ok: 1,
  unknown: 2,
  warning: 3,
  critical: 4,
};

export const STATUS_ORDER: Status[] = ['critical', 'warning', 'unknown', 'ok', 'paused'];

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'OK',
  warning: 'Warnung',
  critical: 'Kritisch',
  unknown: 'Unbekannt',
  paused: 'Pausiert',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Kritisch',
  warning: 'Warnung',
  info: 'Info',
};

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  'windows-server': 'Windows-Server',
  'linux-server': 'Linux-Server',
  switch: 'Switch',
  router: 'Router',
  firewall: 'Firewall',
  'hypervisor-vmware': 'VMware ESXi',
  'hypervisor-hyperv': 'Hyper-V',
  storage: 'Speichersystem',
  backup: 'Backup-System',
  ups: 'USV',
};

export const SENSOR_TYPE_LABEL: Record<SensorType, string> = {
  ping: 'Ping',
  'snmp-traffic': 'SNMP Traffic',
  'cpu-load': 'CPU Load',
  'memory-usage': 'Memory Usage',
  'disk-usage': 'Disk Usage',
  'windows-services': 'Windows Services',
  'linux-load': 'Linux System Load',
  'interface-status': 'Interface Status',
  http: 'HTTP',
  dns: 'DNS',
};

/** Liefert den schlechteren von zwei Zuständen. */
export function worseStatus(a: Status, b: Status): Status {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** Schlechtester Zustand einer Liste; leere Liste => unknown */
export function worstStatus(list: Status[]): Status {
  if (list.length === 0) return 'unknown';
  return list.reduce(worseStatus);
}

/** Bewertet einen Messwert anhand von Schwellwerten. */
export function evaluateStatus(value: number, t?: Thresholds): Status {
  if (!t) return 'ok';
  if (t.inverted) {
    if (value <= t.critical) return 'critical';
    if (value <= t.warning) return 'warning';
    return 'ok';
  }
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return 'ok';
}

export function compareStatus(a: Status, b: Status): number {
  return STATUS_RANK[b] - STATUS_RANK[a];
}

/** Schweregrad als Zahl (für Sortierungen): kritisch = 4 … pausiert = 0 */
export function statusSeverity(s: Status): number {
  return STATUS_RANK[s];
}
