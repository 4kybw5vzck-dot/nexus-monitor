/**
 * Erzeugt aus Stammdaten, Sensor-Vorlagen und Szenarien einen vollständigen,
 * in sich konsistenten Datenbestand. Alle Zahlen werden deterministisch
 * abgeleitet: Gerätestatus = schlechtester Sensorstatus, Alarme entstehen aus
 * Sensorzuständen, Ereignisse aus Alarmen usw.
 */
import type {
  Alert,
  Collector,
  Device,
  EventLogEntry,
  Link,
  MetricPoint,
  Sensor,
  Site,
  Status,
} from '../api/types';
import { evaluateStatus, worstStatus } from '../utils/status';
import { DEVICES, LINK_FIXTURES, SITES, type DeviceFixture } from './fixtures';
import { createRng, hashString } from './random';
import { ACTIVE_SCENARIOS, RESOLVED_INCIDENTS, SYSTEM_EVENTS } from './scenarios';
import { sensorSpecsFor, type SensorSpec } from './sensorTemplates';

const MIN = 60_000;

export interface Dataset {
  now: number;
  sites: Site[];
  devices: Device[];
  sensors: Sensor[];
  specs: Map<string, SensorSpec>;
  /** Normalwert je Sensor (Basis der Verlaufskurven) */
  normal: Map<string, number>;
  alerts: Alert[];
  events: EventLogEntry[];
  links: Link[];
  collectors: Collector[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function buildDataset(now: number = Date.now()): Dataset {
  const sensors: Sensor[] = [];
  const specs = new Map<string, SensorSpec>();
  const normal = new Map<string, number>();
  const alerts: Alert[] = [];
  const events: EventLogEntry[] = [];

  const deviceById = new Map<string, DeviceFixture>(DEVICES.map((d) => [d.id, d]));

  // ---------- Sensoren ----------
  for (const dev of DEVICES) {
    for (const spec of sensorSpecsFor(dev)) {
      const id = `sen-${dev.id.slice(4)}-${spec.key}`;
      const rng = createRng(hashString(id));
      const normalValue = round(rng.range(spec.base[0], spec.base[1]), spec.unit === '' ? 2 : 1);
      const scenario = ACTIVE_SCENARIOS[`${dev.id}:${spec.key}`];

      let value = normalValue;
      if (spec.pattern === 'binary') value = 1;
      if (spec.pattern === 'count') value = 0;
      if (scenario) value = scenario.value;

      const status: Status = scenario?.status ?? evaluateStatus(value, spec.thresholds);
      const display =
        scenario?.display ??
        (spec.display ? spec.display(value) : undefined);

      specs.set(id, spec);
      normal.set(id, scenario && scenario.sinceMin === undefined ? value : spec.pattern === 'binary' ? 1 : spec.pattern === 'count' ? 0 : normalValue);

      sensors.push({
        id,
        deviceId: dev.id,
        name: spec.name,
        type: spec.type,
        status,
        value,
        unit: spec.unit,
        displayValue: display,
        lastCheck: iso(now - rng.int(2, spec.intervalSec) * 1000),
        intervalSec: spec.intervalSec,
        thresholds: spec.thresholds,
        message: scenario?.message ?? 'OK',
      });

      // ---------- Aktive Alarme ----------
      if (scenario && (status === 'warning' || status === 'critical')) {
        const since = scenario.sinceMin ?? scenario.alertSinceMin ?? 30;
        const alert: Alert = {
          id: `alr-${id.slice(4)}`,
          severity: status,
          state: scenario.ackBy ? 'acknowledged' : 'active',
          deviceId: dev.id,
          sensorId: id,
          siteId: dev.siteId,
          title: `${spec.name}: ${status === 'critical' ? 'Kritisch' : 'Warnung'}`,
          description: scenario.message,
          raisedAt: iso(now - since * MIN),
        };
        if (scenario.ackBy) {
          alert.acknowledgedBy = scenario.ackBy;
          alert.acknowledgedAt = iso(now - (since - (scenario.ackAfterMin ?? 5)) * MIN);
        }
        alerts.push(alert);
      }
    }
  }

  // ---------- Behobene Alarme ----------
  for (const inc of RESOLVED_INCIDENTS) {
    const [deviceId, key] = inc.key.split(':');
    const sensorId = `sen-${deviceId.slice(4)}-${key}`;
    const sensor = sensors.find((s) => s.id === sensorId);
    const dev = deviceById.get(deviceId);
    if (!sensor || !dev) continue;
    alerts.push({
      id: `alr-r-${sensorId.slice(4)}-${inc.fromMin}`,
      severity: inc.severity,
      state: 'resolved',
      deviceId,
      sensorId,
      siteId: dev.siteId,
      title: `${sensor.name}: ${inc.severity === 'critical' ? 'Kritisch' : 'Warnung'}`,
      description: inc.title,
      raisedAt: iso(now - inc.fromMin * MIN),
      resolvedAt: iso(now - inc.toMin * MIN),
    });
  }

  // ---------- Geräte ----------
  const devices: Device[] = DEVICES.map((d) => {
    const own = sensors.filter((s) => s.deviceId === d.id);
    const rng = createRng(hashString(d.id));
    const lastContact = own.reduce((max, s) => Math.max(max, new Date(s.lastCheck).getTime()), 0);
    return {
      id: d.id,
      name: d.name,
      ip: d.ip,
      type: d.type,
      vendor: d.vendor,
      model: d.model,
      os: d.os,
      siteId: d.siteId,
      status: worstStatus(own.map((s) => s.status)),
      sensorCount: own.length,
      lastContact: iso(lastContact || now),
      uptimeDays: rng.int(3, 190),
      tags: d.tags,
      description: d.role,
      config: {
        pollingIntervalSec: 60,
        protocol: d.protocol,
        credentialProfile: `Profil „${d.protocol === 'WMI' ? 'Windows-Dienstkonto' : d.protocol === 'SSH' ? 'Linux-Monitoring' : d.protocol === 'API' ? 'vCenter-Lesezugriff' : 'SNMP-Netzwerk'}“`,
        notificationGroup: d.tags.includes('produktion') ? 'Werks-IT LU' : 'IT-Betrieb',
        maintenanceWindow: d.id === 'dev-ma-usv-01' ? 'Heute 12:00–16:00' : d.type === 'windows-server' ? 'Sonntag 02:00–05:00' : null,
      },
    };
  });

  // ---------- Ereignisse ----------
  const devName = (id: string) => deviceById.get(id)?.name ?? id;
  for (const a of alerts) {
    events.push({
      id: `evt-${a.id}-raised`,
      at: a.raisedAt,
      level: a.severity === 'critical' ? 'critical' : 'warning',
      deviceId: a.deviceId,
      sensorId: a.sensorId,
      message: `${devName(a.deviceId)} – ${a.description}`,
    });
    if (a.acknowledgedAt) {
      events.push({
        id: `evt-${a.id}-ack`,
        at: a.acknowledgedAt,
        level: 'info',
        deviceId: a.deviceId,
        sensorId: a.sensorId,
        message: `${devName(a.deviceId)} – Alarm bestätigt von ${a.acknowledgedBy}`,
      });
    }
    if (a.resolvedAt) {
      events.push({
        id: `evt-${a.id}-ok`,
        at: a.resolvedAt,
        level: 'ok',
        deviceId: a.deviceId,
        sensorId: a.sensorId,
        message: `${devName(a.deviceId)} – ${a.title.split(':')[0]} wieder normal`,
      });
    }
  }
  for (const e of SYSTEM_EVENTS) {
    events.push({ id: `evt-sys-${e.min}`, at: iso(now - e.min * MIN), level: e.level, deviceId: e.deviceId, message: e.message });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  // ---------- Verbindungen ----------
  const sensorOf = (deviceId: string, key: string) => sensors.find((s) => s.id === `sen-${deviceId.slice(4)}-${key}`);
  const links: Link[] = LINK_FIXTURES.map((l, i) => {
    const rng = createRng(hashString(`${l.from}->${l.to}`));
    const utilization = l.kind === 'wan' ? round(rng.range(35, 82)) : round(rng.range(3, 45));
    let status: Status = utilization >= 90 ? 'critical' : utilization >= 75 ? 'warning' : 'ok';
    for (const end of [l.from, l.to]) {
      const ifs = sensorOf(end, 'iface');
      if (ifs && ifs.status === 'critical' && l.kind === 'uplink') status = 'warning';
    }
    const hdPing = sensorOf('dev-hd-fw-01', 'ping');
    if (l.to === 'dev-hd-fw-01' && hdPing && hdPing.status !== 'ok') status = hdPing.status;
    return { id: `lnk-${i + 1}`, from: l.from, to: l.to, bandwidth: l.bandwidth, utilization, status, kind: l.kind };
  });

  // ---------- Collectors ----------
  const sensorsAtSite = (siteId: string) => sensors.filter((s) => deviceById.get(s.deviceId)?.siteId === siteId).length;
  const collectors: Collector[] = [
    { id: 'col-core', name: 'NEXUS Core', siteId: null, role: 'central', version: '0.9.3', status: 'ok', lastHeartbeat: iso(now - 4000), sensorCount: 0, cpu: 18, memory: 41, queueLength: 0 },
    { id: 'col-ma', name: 'COL-MA-01', siteId: 'site-ma', role: 'remote', version: '0.9.3', status: 'ok', lastHeartbeat: iso(now - 9000), sensorCount: sensorsAtSite('site-ma'), cpu: 23, memory: 37, queueLength: 4 },
    { id: 'col-lu', name: 'COL-LU-01', siteId: 'site-lu', role: 'remote', version: '0.9.3', status: 'ok', lastHeartbeat: iso(now - 14000), sensorCount: sensorsAtSite('site-lu'), cpu: 15, memory: 29, queueLength: 2 },
    { id: 'col-hd', name: 'COL-HD-01', siteId: 'site-hd', role: 'remote', version: '0.9.2', status: 'warning', lastHeartbeat: iso(now - 52000), sensorCount: sensorsAtSite('site-hd'), cpu: 61, memory: 72, queueLength: 342 },
  ];
  collectors[0].sensorCount = sensors.length;

  return { now, sites: SITES, devices, sensors, specs, normal, alerts, events, links, collectors };
}

// ---------------------------------------------------------------------------
// Verlaufsdaten
// ---------------------------------------------------------------------------

/** Tageslastkurve: nachts niedrig, Arbeitszeit hoch */
function workload(ms: number): number {
  const d = new Date(ms);
  const h = d.getHours() + d.getMinutes() / 60;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const day = h >= 6 && h <= 19 ? Math.sin((Math.PI * (h - 6)) / 13) : 0;
  return 0.3 + (weekend ? 0.25 : 0.7) * day;
}

function noise(seed: number, bucket: number): number {
  return createRng((seed ^ Math.imul(bucket, 2654435761)) >>> 0).next() * 2 - 1;
}

export function stepMinutesFor(hours: number): number {
  if (hours <= 24) return 5;
  if (hours <= 24 * 7) return 30;
  return 120;
}

/**
 * Verlauf eines Sensors. Endet exakt beim aktuellen Messwert und enthält
 * aktive sowie behobene Störungen aus den Szenarien.
 */
export function sensorHistory(ds: Dataset, sensorId: string, hours: number): MetricPoint[] {
  const sensor = ds.sensors.find((s) => s.id === sensorId);
  const spec = ds.specs.get(sensorId);
  if (!sensor || !spec) return [];
  const base = ds.normal.get(sensorId) ?? sensor.value;
  const seed = hashString(sensorId);
  const step = stepMinutesFor(hours);
  const count = Math.floor((hours * 60) / step) + 1;
  const deviceKey = `${sensor.deviceId}:${spec.key}`;
  const active = ACTIVE_SCENARIOS[deviceKey];
  const incidents = RESOLVED_INCIDENTS.filter((i) => i.key === deviceKey);
  const isPct = spec.unit === '%';
  const nowFactor = workload(ds.now);
  const points: MetricPoint[] = [];

  for (let i = 0; i < count; i++) {
    const minAgo = (count - 1 - i) * step;
    const t = ds.now - minAgo * MIN;
    const bucket = Math.floor(t / (step * MIN));
    const n = noise(seed, bucket);
    let v: number;
    switch (spec.pattern) {
      case 'diurnal':
        v = base * (workload(t) / nowFactor) * (1 + n * 0.1);
        break;
      case 'growth':
        v = base - (minAgo / 60) * 0.025 + n * 0.15;
        break;
      case 'binary':
        v = 1;
        break;
      case 'count':
        v = 0;
        break;
      default:
        v = base * (1 + n * 0.15);
    }
    if (active?.sinceMin !== undefined && minAgo <= active.sinceMin && active.status !== 'unknown') {
      v = spec.pattern === 'binary' || spec.pattern === 'count' || active.value >= 1000 ? active.value : active.value * (1 + n * 0.04);
    }
    for (const inc of incidents) {
      if (minAgo <= inc.fromMin && minAgo >= inc.toMin) v = inc.value;
    }
    if (isPct) v = Math.min(100, Math.max(0, v));
    else v = Math.max(0, v);
    points.push({ t: iso(t), v: round(v, spec.unit === '' ? 2 : 1) });
  }
  if (points.length && sensor.status !== 'unknown') points[points.length - 1].v = sensor.value;
  return points;
}

/** Verfügbarkeit eines Sensors in Prozent (Anteil nicht-kritischer Messpunkte). */
export function availabilityOf(ds: Dataset, sensorId: string, hours = 24): number {
  const spec = ds.specs.get(sensorId);
  const hist = sensorHistory(ds, sensorId, hours);
  if (!hist.length || !spec) return 100;
  const down = hist.filter((p) => evaluateStatus(p.v, spec.thresholds) === 'critical').length;
  return round(100 - (down / hist.length) * 100, 2);
}
