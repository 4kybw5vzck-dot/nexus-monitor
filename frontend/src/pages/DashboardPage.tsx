import { useState } from 'react';
import { dataSource } from '../api';
import { Link, navigate } from '../app/router';
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart';
import { DonutChart, Gauge } from '../components/charts/SmallCharts';
import { AlertList, EventList } from '../components/shared';
import { Card, KpiTile, PageHeader, Segment, Skeleton, StatusDot, UsageBar } from '../components/ui';
import { useData } from '../hooks/useData';
import { formatBandwidth, formatNumber } from '../utils/format';
import { STATUS_LABEL, STATUS_ORDER, worstStatus } from '../utils/status';

type Range = '6' | '24' | '168';
const RANGES: Array<{ id: Range; label: string }> = [
  { id: '6', label: '6 Std.' },
  { id: '24', label: '24 Std.' },
  { id: '168', label: '7 Tage' },
];

const STATUS_COLOR = {
  ok: 'var(--ok)',
  warning: 'var(--warning)',
  critical: 'var(--critical)',
  unknown: 'var(--unknown)',
  paused: 'var(--paused)',
} as const;

export function DashboardPage() {
  const [range, setRange] = useState<Range>('24');
  const hours = Number(range);

  const summary = useData(() => dataSource.getSummary());
  const devices = useData(() => dataSource.getDevices());
  const sensors = useData(() => dataSource.getSensors());
  const sites = useData(() => dataSource.getSites());
  const alerts = useData(() => dataSource.getAlerts());
  const events = useData(() => dataSource.getEvents(12));
  const trafficIn = useData(() => dataSource.getAggregateSeries('traffic-in', hours), [hours]);
  const trafficOut = useData(() => dataSource.getAggregateSeries('traffic-out', hours), [hours]);
  const cpu = useData(() => dataSource.getAggregateSeries('cpu', hours), [hours]);
  const mem = useData(() => dataSource.getAggregateSeries('memory', hours), [hours]);

  const s = summary.data;
  const openAlerts = (alerts.data ?? []).filter((a) => a.state !== 'resolved');
  const storage = (sensors.data ?? [])
    .filter((x) => x.type === 'disk-usage')
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);
  const devName = new Map((devices.data ?? []).map((d) => [d.id, d.name]));
  const avgCpu = cpu.data?.length ? cpu.data[cpu.data.length - 1].v : 0;
  const avgMem = mem.data?.length ? mem.data[mem.data.length - 1].v : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Gesamtzustand aller überwachten Standorte"
        actions={<Segment options={RANGES} value={range} onChange={setRange} />}
      />

      <div className="grid grid-kpi">
        {s ? (
          <>
            <KpiTile label="Geräte" value={s.devices} foot={`${sites.data?.length ?? 0} Standorte`} to="/devices" color="var(--accent)" />
            <KpiTile label="Sensoren" value={s.sensors} foot={`${s.byStatus.paused} pausiert · ${s.byStatus.unknown} unbekannt`} to="/sensors" color="var(--series-2)" />
            <KpiTile label="Sensoren OK" value={s.byStatus.ok} foot={`${formatNumber((s.byStatus.ok / s.sensors) * 100)} % aller Sensoren`} to="/sensors?status=ok" color="var(--ok)" />
            <KpiTile label="Warnungen" value={<span className="text-warning">{s.byStatus.warning}</span>} foot="Sensoren mit Warnung" to="/sensors?status=warning" color="var(--warning)" />
            <KpiTile label="Kritisch" value={<span className="text-critical">{s.byStatus.critical}</span>} foot="Sensoren mit Fehler" to="/sensors?status=critical" color="var(--critical)" />
            <KpiTile label="Verfügbarkeit (24 Std.)" value={`${formatNumber(s.availability, 2)} %`} foot="Mittel aller Ping-Sensoren" to="/reports" color="var(--ok)" />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={96} />)
        )}
      </div>

      <div className="grid grid-main-side">
        <Card title="Netzwerk-Traffic WAN" sub="Summe aller Standort-Firewalls" >
          {trafficIn.data && trafficOut.data ? (
            <TimeSeriesChart
              area
              height={250}
              format={formatBandwidth}
              series={[
                { name: 'Eingehend', color: 'var(--series-1)', points: trafficIn.data },
                { name: 'Ausgehend', color: 'var(--series-2)', points: trafficOut.data },
              ]}
            />
          ) : <Skeleton height={250} />}
        </Card>
        <Card title="Sensorstatus" sub="Klick auf ein Segment filtert die Sensorliste">
          {s ? (
            <div className="hstack" style={{ gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
              <DonutChart
                size={170}
                center={{ value: String(s.sensors), label: 'Sensoren' }}
                segments={STATUS_ORDER.map((st) => ({
                  label: STATUS_LABEL[st],
                  value: s.byStatus[st],
                  color: STATUS_COLOR[st],
                  onClick: () => navigate(`/sensors?status=${st}`),
                }))}
              />
              <div className="vstack" style={{ minWidth: 150 }}>
                {STATUS_ORDER.map((st) => (
                  <Link key={st} to={`/sensors?status=${st}`} className="between" style={{ color: 'var(--text-2)' }}>
                    <span className="hstack"><StatusDot status={st} />{STATUS_LABEL[st]}</span>
                    <b className="tabular" style={{ color: 'var(--text)' }}>{s.byStatus[st]}</b>
                  </Link>
                ))}
                <div className="hstack muted small" style={{ marginTop: 6 }}>
                  {s.activeAlerts} offene Alarme
                </div>
              </div>
            </div>
          ) : <Skeleton height={170} />}
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="CPU-Auslastung" sub={`Mittelwert aller Systeme · aktuell ${formatNumber(avgCpu)} %`}>
          {cpu.data ? <TimeSeriesChart area height={215} yMax={100} format={(v) => `${formatNumber(v, 0)} %`} series={[{ name: 'CPU', color: 'var(--series-3)', points: cpu.data }]} thresholds={[{ value: 80, color: 'var(--warning)', label: 'Warnung 80 %' }]} /> : <Skeleton height={215} />}
        </Card>
        <Card title="RAM-Auslastung" sub={`Mittelwert aller Systeme · aktuell ${formatNumber(avgMem)} %`}>
          {mem.data ? <TimeSeriesChart area height={215} yMax={100} format={(v) => `${formatNumber(v, 0)} %`} series={[{ name: 'RAM', color: 'var(--series-4)', points: mem.data }]} thresholds={[{ value: 85, color: 'var(--warning)', label: 'Warnung 85 %' }]} /> : <Skeleton height={170} />}
        </Card>
        <Card title="Speicherverbrauch" sub="Am stärksten belegte Datenträger und Volumes" actions={<Link to="/sensors?type=disk-usage" className="small">Alle</Link>}>
          <div className="vstack" style={{ gap: 11 }}>
            {storage.map((x) => (
              <div key={x.id}>
                <div className="between small" style={{ marginBottom: 4 }}>
                  <Link to={`/devices/${x.deviceId}?tab=sensors&sensor=${x.id}`} style={{ color: 'var(--text-2)' }}>
                    {devName.get(x.deviceId)} · {x.name}
                  </Link>
                  <b className={`tabular text-${x.status}`}>{formatNumber(x.value)} %</b>
                </div>
                <UsageBar value={x.value} status={x.status} />
              </div>
            ))}
            {!storage.length && <Skeleton height={150} />}
          </div>
        </Card>
      </div>

      <div className="grid grid-4">
        {(sites.data ?? []).map((site) => {
          const devs = (devices.data ?? []).filter((d) => d.siteId === site.id);
          const st = worstStatus(devs.map((d) => d.status));
          const bad = devs.filter((d) => d.status === 'critical' || d.status === 'warning').length;
          return (
            <Link key={site.id} to={`/sites?site=${site.id}`} className="card kpi" style={{ ['--kpi-color' as string]: STATUS_COLOR[st] }}>
              <div className="kpi-label">{site.city}</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{site.name}</div>
              <div className="kpi-foot">
                <StatusDot status={st} /> {devs.length} Geräte · {bad ? `${bad} mit Problemen` : 'alles in Ordnung'}
              </div>
            </Link>
          );
        })}
        {s && (
          <div className="card" style={{ display: 'grid', placeItems: 'center', padding: '6px 0' }}>
            <Gauge value={s.availability} label="Verfügbarkeit 24 Std." warning={99.9} critical={99} inverted />
          </div>
        )}
      </div>

      <div className="grid grid-main-side">
        <Card title="Aktuelle Alarme" sub={`${openAlerts.length} offen`} actions={<Link to="/alerts" className="small">Alarmübersicht</Link>} flush>
          {alerts.data && devices.data && sensors.data ? (
            <AlertList alerts={openAlerts} devices={devices.data} sensors={sensors.data} limit={8} />
          ) : <div style={{ padding: 16 }}><Skeleton height={200} /></div>}
        </Card>
        <Card title="Letzte Ereignisse" flush>
          {events.data ? <EventList events={events.data} devices={devices.data} /> : <div style={{ padding: 16 }}><Skeleton height={200} /></div>}
        </Card>
      </div>
    </>
  );
}
