/**
 * Sensor-Vorlagen je Gerätetyp. Eine Vorlage beschreibt, welche Sensoren ein
 * Gerät dieses Typs erhält und in welchem Wertebereich sich der Normalbetrieb
 * bewegt. Später werden diese Vorlagen zu echten "Device Templates" im Backend.
 */
import type { DeviceType, SensorType, Thresholds } from '../api/types';
import type { DeviceFixture } from './fixtures';

export type Pattern = 'diurnal' | 'flat' | 'growth' | 'binary' | 'count';

export interface SensorSpec {
  key: string;
  name: string;
  type: SensorType;
  unit: string;
  thresholds?: Thresholds;
  /** Wertebereich im Normalbetrieb */
  base: [number, number];
  intervalSec: number;
  pattern: Pattern;
  /** Bandbreite für Traffic-Sensoren (Mbit/s) */
  bandwidth?: number;
  /** Text für zweiwertige Sensoren / Zähler */
  display?: (value: number) => string;
}

const PCT_CPU: Thresholds = { warning: 80, critical: 95 };
const PCT_MEM: Thresholds = { warning: 85, critical: 95 };
const PCT_DISK: Thresholds = { warning: 85, critical: 95 };
const IFACE: Thresholds = { warning: 0.5, critical: 0.5, inverted: true };

const ping = (): SensorSpec => ({ key: 'ping', name: 'Ping', type: 'ping', unit: 'ms', thresholds: { warning: 50, critical: 200 }, base: [0.4, 2.8], intervalSec: 60, pattern: 'flat' });
const cpu = (base: [number, number] = [8, 42]): SensorSpec => ({ key: 'cpu', name: 'CPU-Last', type: 'cpu-load', unit: '%', thresholds: PCT_CPU, base, intervalSec: 60, pattern: 'diurnal' });
const mem = (base: [number, number] = [38, 72]): SensorSpec => ({ key: 'mem', name: 'Arbeitsspeicher', type: 'memory-usage', unit: '%', thresholds: PCT_MEM, base, intervalSec: 60, pattern: 'flat' });
const disk = (key: string, name: string, base: [number, number] = [32, 70]): SensorSpec => ({ key, name, type: 'disk-usage', unit: '%', thresholds: PCT_DISK, base, intervalSec: 300, pattern: 'growth' });
const traffic = (name: string, bandwidth: number, base: [number, number] = [0.08, 0.35]): SensorSpec => ({
  key: 'traffic', name, type: 'snmp-traffic', unit: 'Mbit/s', base: [bandwidth * base[0], bandwidth * base[1]], intervalSec: 60, pattern: 'diurnal', bandwidth,
});
const iface = (name: string, speed: string): SensorSpec => ({
  key: 'iface', name, type: 'interface-status', unit: '', thresholds: IFACE, base: [1, 1], intervalSec: 60, pattern: 'binary',
  display: (v) => (v >= 0.5 ? `Up (${speed})` : 'Down'),
});
const services = (total: number): SensorSpec => ({
  key: 'services', name: 'Windows-Dienste', type: 'windows-services', unit: '', thresholds: { warning: 1, critical: 2 }, base: [0, 0], intervalSec: 120, pattern: 'count',
  display: (v) => `${total - v} von ${total} Diensten laufen`,
});
const linuxLoad = (): SensorSpec => ({ key: 'load', name: 'System Load (1 Min.)', type: 'linux-load', unit: '', thresholds: { warning: 4, critical: 8 }, base: [0.2, 1.6], intervalSec: 60, pattern: 'diurnal' });
const http = (name: string): SensorSpec => ({ key: 'http', name, type: 'http', unit: 'ms', thresholds: { warning: 800, critical: 2000 }, base: [70, 240], intervalSec: 60, pattern: 'flat' });
const dns = (): SensorSpec => ({ key: 'dns', name: 'DNS-Auflösung', type: 'dns', unit: 'ms', thresholds: { warning: 100, critical: 500 }, base: [2, 12], intervalSec: 120, pattern: 'flat' });

const WAN_BANDWIDTH: Record<string, number> = { 'site-ma': 1000, 'site-lu': 500, 'site-hd': 100 };

const TEMPLATES: Record<DeviceType, (d: DeviceFixture) => SensorSpec[]> = {
  firewall: (d) => [ping(), cpu([10, 38]), mem([40, 65]), traffic('Traffic WAN', WAN_BANDWIDTH[d.siteId]), iface('Interface WAN', `${WAN_BANDWIDTH[d.siteId]} Mbit/s`)],
  router: () => [ping(), cpu([5, 25]), traffic('Traffic MPLS', 1000), iface('Interface MPLS', '1 Gbit/s')],
  switch: () => [ping(), cpu([4, 22]), mem([30, 55]), traffic('Traffic Uplink', 10000, [0.02, 0.18]), iface('Interface Uplink', '10 Gbit/s')],
  'windows-server': () => [ping(), cpu(), mem(), disk('disk-sys', 'Datenträger C:'), services(42)],
  'linux-server': () => [ping(), linuxLoad(), mem([25, 60]), disk('disk-sys', 'Dateisystem /')],
  'hypervisor-vmware': () => [ping(), cpu([30, 62]), mem([55, 78]), disk('disk-ds', 'Datastore DS-PROD-01', [55, 78])],
  'hypervisor-hyperv': () => [ping(), cpu([25, 55]), mem([50, 75]), disk('disk-ds', 'CSV-Volume Volume1', [50, 72])],
  storage: () => [ping(), disk('volume', 'Volume vol_data', [55, 80]), traffic('Traffic Storage-LAN', 10000, [0.05, 0.25]), iface('Interface Storage', '10 Gbit/s')],
  backup: () => [ping(), cpu([5, 30]), services(38), disk('repo', 'Backup-Repository R:', [55, 75])],
  ups: () => [ping(), iface('Netzwerkkarte NMC', '1 Gbit/s')],
};

const EXTRAS: Record<'dns' | 'http' | 'disk-data', (d: DeviceFixture) => SensorSpec> = {
  dns: () => dns(),
  http: (d) => http(d.type === 'firewall' ? 'HTTPS Admin-Portal' : d.siteId === 'site-lu' ? 'HTTPS MES-Portal' : 'HTTP Intranet'),
  'disk-data': () => disk('disk-data', 'Datenträger D:', [45, 75]),
};

export function sensorSpecsFor(device: DeviceFixture): SensorSpec[] {
  const specs = TEMPLATES[device.type](device);
  for (const extra of device.extra ?? []) specs.push(EXTRAS[extra](device));
  return specs;
}
