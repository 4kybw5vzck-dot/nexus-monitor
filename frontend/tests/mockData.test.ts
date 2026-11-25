import { describe, expect, it } from 'vitest';
import { buildDataset, sensorHistory } from '../src/mock/buildDataset';
import { MockDataSource } from '../src/api/mockDataSource';
import { worstStatus } from '../src/utils/status';

const NOW = Date.UTC(2026, 10, 25, 11, 0, 0);

describe('Mock-Datenbestand', () => {
  const ds = buildDataset(NOW);

  it('erfüllt die Mindestmengen aus dem Entwicklungsauftrag', () => {
    expect(ds.devices.length).toBeGreaterThanOrEqual(20);
    expect(ds.sensors.length).toBeGreaterThanOrEqual(60);
    expect(ds.sites.length).toBeGreaterThanOrEqual(3);
    expect(ds.alerts.some((a) => a.severity === 'critical')).toBe(true);
    expect(ds.alerts.some((a) => a.severity === 'warning')).toBe(true);
  });

  it('deckt alle geforderten Sensortypen ab', () => {
    const types = new Set(ds.sensors.map((s) => s.type));
    for (const t of ['ping', 'snmp-traffic', 'cpu-load', 'memory-usage', 'disk-usage', 'windows-services', 'linux-load', 'interface-status', 'http', 'dns']) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  it('ist deterministisch (gleicher Zeitpunkt => gleiche Daten)', () => {
    const again = buildDataset(NOW);
    expect(again.sensors.map((s) => s.value)).toEqual(ds.sensors.map((s) => s.value));
  });

  it('verwendet ausschließlich Dokumentations-IP-Bereiche (RFC 5737)', () => {
    for (const d of ds.devices) {
      expect(d.ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    }
  });

  it('hält Referenzen konsistent', () => {
    const deviceIds = new Set(ds.devices.map((d) => d.id));
    const siteIds = new Set(ds.sites.map((s) => s.id));
    const sensorIds = new Set(ds.sensors.map((s) => s.id));
    ds.devices.forEach((d) => expect(siteIds.has(d.siteId)).toBe(true));
    ds.sensors.forEach((s) => expect(deviceIds.has(s.deviceId)).toBe(true));
    ds.alerts.forEach((a) => {
      expect(deviceIds.has(a.deviceId)).toBe(true);
      expect(sensorIds.has(a.sensorId)).toBe(true);
    });
    ds.links.forEach((l) => {
      expect(deviceIds.has(l.from)).toBe(true);
      expect(deviceIds.has(l.to)).toBe(true);
    });
  });

  it('leitet Gerätestatus und Sensoranzahl aus den Sensoren ab', () => {
    for (const d of ds.devices) {
      const own = ds.sensors.filter((s) => s.deviceId === d.id);
      expect(d.sensorCount).toBe(own.length);
      expect(d.status).toBe(worstStatus(own.map((s) => s.status)));
    }
  });

  it('erzeugt für jeden Warn-/Fehlersensor einen offenen Alarm', () => {
    const bad = ds.sensors.filter((s) => s.status === 'warning' || s.status === 'critical');
    const open = ds.alerts.filter((a) => a.state !== 'resolved');
    expect(open.length).toBe(bad.length);
  });

  it('liefert Verläufe, die beim aktuellen Wert enden', () => {
    const sensor = ds.sensors.find((s) => s.type === 'cpu-load' && s.status === 'ok')!;
    const h = sensorHistory(ds, sensor.id, 24);
    expect(h.length).toBe(24 * 12 + 1);
    expect(h[h.length - 1].v).toBe(sensor.value);
  });
});

describe('MockDataSource', () => {
  it('bestätigt Alarme und benachrichtigt Abonnenten', async () => {
    const src = new MockDataSource({ now: NOW, latencyMs: 0 });
    let notified = 0;
    src.subscribe(() => notified++);
    const open = (await src.getAlerts()).find((a) => a.state === 'active')!;
    const result = await src.acknowledgeAlert(open.id, 'tester');
    expect(result.state).toBe('acknowledged');
    expect(result.acknowledgedBy).toBe('tester');
    expect(notified).toBe(1);
    const reloaded = (await src.getAlerts()).find((a) => a.id === open.id)!;
    expect(reloaded.state).toBe('acknowledged');
  });

  it('liefert Kopien – Änderungen an Ergebnissen verändern die Quelle nicht', async () => {
    const src = new MockDataSource({ now: NOW, latencyMs: 0 });
    const devices = await src.getDevices();
    devices[0].name = 'manipuliert';
    expect((await src.getDevices())[0].name).not.toBe('manipuliert');
  });

  it('meldet die Zusammenfassung passend zu den Sensoren', async () => {
    const src = new MockDataSource({ now: NOW, latencyMs: 0 });
    const [summary, sensors] = await Promise.all([src.getSummary(), src.getSensors()]);
    const total = Object.values(summary.byStatus).reduce((a, b) => a + b, 0);
    expect(total).toBe(sensors.length);
    expect(summary.availability).toBeGreaterThan(90);
    expect(summary.availability).toBeLessThanOrEqual(100);
  });
});
