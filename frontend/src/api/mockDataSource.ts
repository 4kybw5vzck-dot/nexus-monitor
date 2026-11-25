import { buildDataset, sensorHistory, availabilityOf, stepMinutesFor, type Dataset } from '../mock/buildDataset';
import { NOTIFICATION_RULES, REPORTS, USERS } from '../mock/fixtures';
import { createRng, hashString } from '../mock/random';
import type { MonitoringDataSource } from './dataSource';
import type { Alert, DiscoveryResult, MetricPoint, Status, StatusSummary } from './types';

const delay = <T,>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

/**
 * Datenquelle für den Mock-Modus. Hält einen deterministisch erzeugten Datenbestand
 * im Speicher. Änderungen (z. B. Alarmbestätigungen) leben nur bis zum Neuladen
 * der Seite – es gibt bewusst keine Persistenz und keine Netzwerkzugriffe.
 */
export class MockDataSource implements MonitoringDataSource {
  readonly kind = 'mock' as const;
  private ds: Dataset;
  private listeners = new Set<() => void>();
  private latencyMs: number;

  constructor(options: { now?: number; latencyMs?: number } = {}) {
    this.ds = buildDataset(options.now);
    this.latencyMs = options.latencyMs ?? 120;
  }

  private respond<T>(value: T) {
    return delay(value, this.latencyMs);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSummary(): Promise<StatusSummary> {
    const byStatus: Record<Status, number> = { ok: 0, warning: 0, critical: 0, unknown: 0, paused: 0 };
    this.ds.sensors.forEach((s) => byStatus[s.status]++);
    const pings = this.ds.sensors.filter((s) => s.type === 'ping');
    const availability = pings.reduce((sum, s) => sum + availabilityOf(this.ds, s.id), 0) / Math.max(1, pings.length);
    return this.respond({
      devices: this.ds.devices.length,
      sensors: this.ds.sensors.length,
      byStatus,
      availability: Math.round(availability * 100) / 100,
      activeAlerts: this.ds.alerts.filter((a) => a.state !== 'resolved').length,
    });
  }

  getSites() { return this.respond(this.ds.sites); }
  getSite(id: string) { return this.respond(this.ds.sites.find((s) => s.id === id)); }
  getDevices() { return this.respond(this.ds.devices); }
  getDevice(id: string) { return this.respond(this.ds.devices.find((d) => d.id === id)); }

  getSensors(filter?: { deviceId?: string }) {
    const list = filter?.deviceId ? this.ds.sensors.filter((s) => s.deviceId === filter.deviceId) : this.ds.sensors;
    return this.respond(list);
  }
  getSensor(id: string) { return this.respond(this.ds.sensors.find((s) => s.id === id)); }
  getSensorHistory(sensorId: string, hours: number) { return this.respond(sensorHistory(this.ds, sensorId, hours)); }

  async getAggregateSeries(metric: 'traffic-in' | 'traffic-out' | 'cpu' | 'memory', hours: number): Promise<MetricPoint[]> {
    const pick =
      metric === 'cpu'
        ? this.ds.sensors.filter((s) => s.type === 'cpu-load' && s.status !== 'unknown')
        : metric === 'memory'
          ? this.ds.sensors.filter((s) => s.type === 'memory-usage')
          : this.ds.sensors.filter((s) => s.type === 'snmp-traffic' && s.name === 'Traffic WAN');
    const series = pick.map((s) => sensorHistory(this.ds, s.id, hours));
    if (!series.length) return this.respond([]);
    const share = metric === 'traffic-in' ? 0.68 : metric === 'traffic-out' ? 0.32 : 1;
    const seed = hashString(metric);
    const result = series[0].map((p, i) => {
      const values = series.map((s) => s[i]?.v ?? 0);
      const total = values.reduce((a, b) => a + b, 0);
      const jitter = share === 1 ? 1 : 1 + (createRng(seed + i).next() - 0.5) * 0.12;
      const v = share === 1 ? total / values.length : total * share * jitter;
      return { t: p.t, v: Math.round(v * 10) / 10 };
    });
    return this.respond(result);
  }

  getAvailability(hours: number) {
    const result = this.ds.devices.map((d) => {
      const ping = this.ds.sensors.find((s) => s.deviceId === d.id && s.type === 'ping');
      return { deviceId: d.id, siteId: d.siteId, availability: ping ? availabilityOf(this.ds, ping.id, hours) : 100 };
    });
    return this.respond(result);
  }

  getAlerts() {
    const sorted = [...this.ds.alerts].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
    return this.respond(sorted);
  }

  async acknowledgeAlert(id: string, user: string): Promise<Alert> {
    const alert = this.ds.alerts.find((a) => a.id === id);
    if (!alert) throw new Error(`Alarm ${id} nicht gefunden`);
    if (alert.state === 'active') {
      alert.state = 'acknowledged';
      alert.acknowledgedBy = user;
      alert.acknowledgedAt = new Date().toISOString();
      const device = this.ds.devices.find((d) => d.id === alert.deviceId);
      this.ds.events.unshift({
        id: `evt-${alert.id}-ack-${Date.now()}`,
        at: alert.acknowledgedAt,
        level: 'info',
        deviceId: alert.deviceId,
        sensorId: alert.sensorId,
        message: `${device?.name ?? alert.deviceId} – Alarm bestätigt von ${user}`,
      });
      this.emit();
    }
    return this.respond(alert);
  }

  getEvents(limit = 50) { return this.respond(this.ds.events.slice(0, limit)); }
  getDeviceEvents(deviceId: string) { return this.respond(this.ds.events.filter((e) => e.deviceId === deviceId)); }
  getLinks() { return this.respond(this.ds.links); }
  getCollectors() { return this.respond(this.ds.collectors); }

  getUsers() {
    const now = this.ds.now;
    return this.respond(USERS.map((u, i) => ({ ...u, lastLogin: new Date(now - (i * 7 + 1) * 3_600_000 * (u.active ? 1 : 40)).toISOString() })));
  }
  getNotificationRules() { return this.respond(NOTIFICATION_RULES); }
  getReports() {
    const now = this.ds.now;
    return this.respond(REPORTS.map((r, i) => ({ ...r, lastRun: new Date(now - (i + 1) * 9 * 3_600_000).toISOString() })));
  }

  /** Simulierte Discovery: erzeugt plausible Treffer aus dem Bereich – ohne jeden Netzwerkzugriff. */
  async runDiscovery(range: string, onProgress?: (pct: number) => void): Promise<DiscoveryResult[]> {
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, Math.max(30, this.latencyMs * 1.5)));
      onProgress?.(Math.round((i / steps) * 100));
    }
    const prefix = range.split('/')[0].split('.').slice(0, 3).join('.');
    const known = new Set(this.ds.devices.map((d) => d.ip));
    const rng = createRng(hashString(range));
    const candidates: Array<Omit<DiscoveryResult, 'ip' | 'alreadyMonitored'>> = [
      { hostname: 'drucker-eg-01', vendorGuess: 'Kyocera', typeGuess: 'linux-server', openServices: ['HTTP', 'SNMP', 'IPP'] },
      { hostname: 'ap-lager-02', vendorGuess: 'Huawei', typeGuess: 'switch', openServices: ['SNMP', 'SSH'] },
      { hostname: 'srv-test-07', vendorGuess: 'Microsoft', typeGuess: 'windows-server', openServices: ['RDP', 'WMI', 'SMB'] },
      { hostname: 'kamera-tor-1', vendorGuess: 'Axis', typeGuess: 'linux-server', openServices: ['HTTP', 'RTSP'] },
      { hostname: 'sw-halle-3', vendorGuess: 'Huawei', typeGuess: 'switch', openServices: ['SNMP', 'SSH', 'LLDP'] },
    ];
    const results: DiscoveryResult[] = this.ds.devices
      .filter((d) => d.ip.startsWith(`${prefix}.`))
      .map((d) => ({ ip: d.ip, hostname: d.name.toLowerCase(), vendorGuess: d.vendor, typeGuess: d.type, openServices: ['ICMP', d.config.protocol.split(' ')[0]], alreadyMonitored: true }));
    for (const c of candidates) {
      let ip: string;
      do ip = `${prefix}.${rng.int(100, 230)}`; while (known.has(ip));
      known.add(ip);
      results.push({ ...c, ip, alreadyMonitored: false });
    }
    results.sort((a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]));
    return structuredClone(results);
  }

  /** Datenstand neu erzeugen (Aktualisieren-Knopf). Bestätigungen bleiben erhalten. */
  refresh() {
    const acks = new Map(this.ds.alerts.filter((a) => a.acknowledgedBy).map((a) => [a.id, a]));
    this.ds = buildDataset();
    for (const a of this.ds.alerts) {
      const prev = acks.get(a.id);
      if (prev && a.state === 'active') {
        a.state = 'acknowledged';
        a.acknowledgedBy = prev.acknowledgedBy;
        a.acknowledgedAt = prev.acknowledgedAt;
      }
    }
    this.emit();
  }

  get dataTimestamp() {
    return this.ds.now;
  }

  /** Nur für die Anzeige der Granularität */
  static stepMinutes(hours: number) {
    return stepMinutesFor(hours);
  }
}
