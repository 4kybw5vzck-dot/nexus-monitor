/**
 * Exportiert den Mock-Datenbestand des Frontends als Demo-Datensatz für das Backend.
 *
 *   npm run export:demo
 *
 * Ergebnis: backend/app/seed/demo_data.json.gz
 *
 * Das Backend lädt diese Datei beim ersten Start in eine leere Datenbank, wenn
 * NEXUS_SEED_DEMO=true gesetzt ist. Alle Zeitstempel beziehen sich auf
 * `exportedAt`; beim Einspielen verschiebt das Backend sie auf den aktuellen
 * Zeitpunkt. Der Export ist deterministisch (fester Bezugszeitpunkt).
 *
 * Verlauf je Sensor in drei Auflösungen (wie im Mock):
 *   - letzte 24 h      alle 5 Minuten
 *   - 24 h bis 7 Tage  alle 30 Minuten
 *   - 7 bis 30 Tage    alle 2 Stunden
 */
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildDataset, sensorHistory } from '../src/mock/buildDataset';
import { NOTIFICATION_RULES, REPORTS, USERS } from '../src/mock/fixtures';

const EXPORTED_AT = Date.UTC(2026, 10, 2, 10, 0, 0); // fester Bezugszeitpunkt (Montag, 10:00 UTC)
const HOUR = 3_600_000;

const ds = buildDataset(EXPORTED_AT);

type Tier = { stepMin: number; values: number[] };

/** Werte eines Verlaufs, die älter als `olderThanH` Stunden sind (chronologisch, endend bei `untilH`). */
function tier(sensorId: string, hours: number, olderThanH: number): Tier & { endsHoursAgo: number } {
  const points = sensorHistory(ds, sensorId, hours);
  const cutoff = EXPORTED_AT - olderThanH * HOUR;
  const older = points.filter((p) => Date.parse(p.t) < cutoff);
  const step = points.length > 1 ? (Date.parse(points[1].t) - Date.parse(points[0].t)) / 60_000 : 5;
  const last = older.length ? Date.parse(older[older.length - 1].t) : cutoff;
  return { stepMin: step, values: older.map((p) => p.v), endsHoursAgo: (EXPORTED_AT - last) / HOUR };
}

const measurements = Object.fromEntries(
  ds.sensors.map((s) => [
    s.id,
    [
      // jeweils: Schrittweite, Ende (Stunden vor exportedAt), Werte chronologisch
      tier(s.id, 720, 168),
      tier(s.id, 168, 24),
      { ...tier(s.id, 24, -1) },
    ],
  ]),
);

const iso = (ms: number) => new Date(ms).toISOString();

const data = {
  format: 'nexus-demo-v1',
  exportedAt: iso(EXPORTED_AT),
  sites: ds.sites,
  collectors: ds.collectors,
  devices: ds.devices.map(({ status: _s, sensorCount: _c, lastContact: _l, ...d }) => d),
  sensors: ds.sensors,
  links: ds.links,
  alerts: ds.alerts,
  events: ds.events,
  users: USERS.map((u, i) => ({ ...u, lastLogin: iso(EXPORTED_AT - (i * 7 + 1) * HOUR * (u.active ? 1 : 40)) })),
  notificationRules: NOTIFICATION_RULES,
  reports: REPORTS.map((r, i) => ({ ...r, lastRun: iso(EXPORTED_AT - (i + 1) * 9 * HOUR) })),
  measurements,
};

const out = resolve(process.cwd(), '../backend/app/seed/demo_data.json.gz');
mkdirSync(dirname(out), { recursive: true });
const gz = gzipSync(JSON.stringify(data), { level: 9 });
writeFileSync(out, gz);
const points = Object.values(measurements).reduce((n, tiers) => n + tiers.reduce((m, t) => m + t.values.length, 0), 0);
console.log(`Demo-Datensatz geschrieben: ${out}`);
console.log(`  ${data.devices.length} Geräte, ${data.sensors.length} Sensoren, ${data.alerts.length} Alarme, ${points} Messwerte, ${(gz.length / 1024).toFixed(0)} KiB`);
