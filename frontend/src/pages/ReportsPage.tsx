import { useMemo, useState, type ReactNode } from 'react';
import { dataSource, type ReportDefinition } from '../api';
import { Link, updateQuery, useLocation } from '../app/router';
import { BarChart } from '../components/charts/SmallCharts';
import { Card, PageHeader, Segment, SeverityBadge, Skeleton, StatusBadge, UsageBar } from '../components/ui';
import { Icon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatBandwidth, formatDateTime, formatDuration, formatNumber, formatRelative } from '../utils/format';

type Range = '24' | '168' | '720';

/** Erzeugt eine CSV-Datei im Browser (keine Serveranfrage). */
function downloadCsv(name: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const head = Object.keys(rows[0]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [head.map(esc).join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage() {
  const { query } = useLocation();
  const active = query.get('report') ?? 'rep-1';
  const [range, setRange] = useState<Range>('24');
  const reports = useData(() => dataSource.getReports());
  const report = reports.data?.find((r) => r.id === active);

  return (
    <>
      <PageHeader title="Reports" description="Auswertungen auf Basis der Monitoringdaten – Export als CSV direkt im Browser" />
      <div className="grid grid-main-side" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 3fr)', alignItems: 'start' }}>
        <Card title="Berichte" flush>
          <div className="list">
            {(reports.data ?? []).map((r) => (
              <a
                key={r.id}
                href={`#/reports?report=${r.id}`}
                onClick={(e) => { e.preventDefault(); updateQuery({ report: r.id }); }}
                className="list-item"
                style={{ color: 'var(--text)', background: r.id === active ? 'var(--accent-soft)' : undefined, textDecoration: 'none' }}
              >
                <Icon name="reports" size={17} />
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="meta">{r.period} · {r.format} · zuletzt {formatRelative(r.lastRun)}</div>
                </div>
              </a>
            ))}
          </div>
        </Card>
        <div className="vstack" style={{ gap: 16 }}>
          {report ? <ReportView report={report} range={range} setRange={setRange} /> : <Skeleton height={300} />}
        </div>
      </div>
    </>
  );
}

function ReportView({ report, range, setRange }: { report: ReportDefinition; range: Range; setRange: (r: Range) => void }) {
  const hours = Number(range);
  const sites = useData(() => dataSource.getSites());
  const devices = useData(() => dataSource.getDevices());
  const sensors = useData(() => dataSource.getSensors());
  const links = useData(() => dataSource.getLinks());
  const alerts = useData(() => dataSource.getAlerts());
  const avail = useData(() => dataSource.getAvailability(hours), [hours]);
  const devById = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d])), [devices.data]);
  const senById = useMemo(() => new Map((sensors.data ?? []).map((s) => [s.id, s])), [sensors.data]);
  const siteName = new Map((sites.data ?? []).map((s) => [s.id, s.name]));
  const ready = sites.data && devices.data && sensors.data && links.data && alerts.data && avail.data;

  let body: ReactNode = <Skeleton height={260} />;
  let csv: Array<Record<string, string | number>> = [];

  if (ready) {
    if (report.id === 'rep-1' || report.id === 'rep-5') {
      const rows = avail.data!.filter((a) => report.id === 'rep-1' || devById.get(a.deviceId)?.tags.includes('produktion'));
      const bySite = sites.data!
        .map((s) => ({ site: s, r: rows.filter((a) => a.siteId === s.id) }))
        .filter((x) => x.r.length > 0)
        .map((x) => ({ label: x.site.city, value: x.r.reduce((sum, a) => sum + a.availability, 0) / x.r.length }));
      csv = rows.map((a) => ({ Gerät: devById.get(a.deviceId)!.name, Standort: siteName.get(a.siteId)!, 'Verfügbarkeit %': formatNumber(a.availability, 2) }));
      body = (
        <>
          <Card title={report.id === 'rep-5' ? 'SLA-Verfügbarkeit Produktion' : 'Verfügbarkeit je Standort'} sub="Anteil erfolgreicher Ping-Messungen">
            <BarChart data={bySite.map((s) => ({ ...s, color: s.value >= 99.9 ? 'var(--ok)' : s.value >= 99 ? 'var(--warning)' : 'var(--critical)' }))} max={100} format={(v) => `${formatNumber(v, 2)} %`} />
          </Card>
          <Card title="Geräte mit der geringsten Verfügbarkeit" flush>
            <table className="table">
              <thead><tr><th>Gerät</th><th>Standort</th><th className="num">Verfügbarkeit</th><th style={{ width: '30%' }} /></tr></thead>
              <tbody>
                {[...rows].sort((a, b) => a.availability - b.availability).slice(0, 10).map((a) => (
                  <tr key={a.deviceId}>
                    <td><Link to={`/devices/${a.deviceId}`}>{devById.get(a.deviceId)?.name}</Link></td>
                    <td>{siteName.get(a.siteId)}</td>
                    <td className="num">{formatNumber(a.availability, 2)} %</td>
                    <td><UsageBar value={a.availability} status={a.availability >= 99.9 ? 'ok' : a.availability >= 99 ? 'warning' : 'critical'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      );
    } else if (report.id === 'rep-2') {
      const rows = [...links.data!].sort((a, b) => b.utilization - a.utilization).slice(0, 10);
      csv = rows.map((l) => ({ Von: devById.get(l.from)!.name, Nach: devById.get(l.to)!.name, Bandbreite: formatBandwidth(l.bandwidth), 'Auslastung %': formatNumber(l.utilization) }));
      body = (
        <Card title="Top 10 Verbindungen nach Auslastung" flush>
          <table className="table">
            <thead><tr><th>Verbindung</th><th>Art</th><th className="num">Bandbreite</th><th className="num">Auslastung</th><th style={{ width: '28%' }} /></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>{devById.get(l.from)?.name} ↔ {devById.get(l.to)?.name}</td>
                  <td className="muted">{l.kind.toUpperCase()}</td>
                  <td className="num">{formatBandwidth(l.bandwidth)}</td>
                  <td className="num">{formatNumber(l.utilization)} %</td>
                  <td><UsageBar value={l.utilization} status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      );
    } else if (report.id === 'rep-3') {
      const rows = sensors.data!.filter((s) => s.type === 'disk-usage').sort((a, b) => b.value - a.value);
      csv = rows.map((s) => ({ Gerät: devById.get(s.deviceId)!.name, Datenträger: s.name, 'Belegung %': formatNumber(s.value), Status: s.status }));
      body = (
        <Card title="Speicherkapazität aller Datenträger" flush>
          <table className="table">
            <thead><tr><th>Status</th><th>Gerät</th><th>Datenträger</th><th className="num">Belegung</th><th style={{ width: '30%' }} /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><StatusBadge status={s.status} /></td>
                  <td><Link to={`/devices/${s.deviceId}?tab=sensors&sensor=${s.id}`}>{devById.get(s.deviceId)?.name}</Link></td>
                  <td>{s.name}</td>
                  <td className="num">{formatNumber(s.value)} %</td>
                  <td><UsageBar value={s.value} status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      );
    } else {
      const rows = alerts.data!;
      csv = rows.map((a) => ({ Schwere: a.severity, Gerät: devById.get(a.deviceId)!.name, Sensor: senById.get(a.sensorId)?.name ?? '', Beschreibung: a.description, Ausgelöst: formatDateTime(a.raisedAt), Dauer: formatDuration(a.raisedAt, a.resolvedAt), Zustand: a.state }));
      const perSite = sites.data!.map((s) => ({ label: s.city, value: rows.filter((a) => a.siteId === s.id).length, color: 'var(--series-1)' }));
      body = (
        <>
          <Card title="Alarme je Standort"><BarChart data={perSite} format={(v) => formatNumber(v, 0)} /></Card>
          <Card title="Alarmhistorie" flush>
            <table className="table">
              <thead><tr><th>Schwere</th><th>Gerät</th><th>Beschreibung</th><th>Ausgelöst</th><th className="num">Dauer</th><th>Zustand</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td><SeverityBadge severity={a.severity} /></td>
                    <td>{devById.get(a.deviceId)?.name}</td>
                    <td>{a.description}</td>
                    <td className="muted">{formatDateTime(a.raisedAt)}</td>
                    <td className="num">{formatDuration(a.raisedAt, a.resolvedAt)}</td>
                    <td>{a.state === 'resolved' ? 'Normalisiert' : a.state === 'acknowledged' ? 'Bestätigt' : 'Offen'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      );
    }
  }

  return (
    <>
      <Card
        title={report.name}
        sub={report.description}
        actions={
          <div className="hstack">
            <Segment options={[{ id: '24', label: '24 Std.' }, { id: '168', label: '7 Tage' }, { id: '720', label: '30 Tage' }]} value={range} onChange={setRange} />
            <button className="btn" disabled={!csv.length} onClick={() => downloadCsv(report.name.replace(/\s+/g, '_'), csv)}>
              <Icon name="download" size={15} /> CSV
            </button>
          </div>
        }
      >
        <div className="muted small">Zeitraum: letzte {range === '24' ? '24 Stunden' : range === '168' ? '7 Tage' : '30 Tage'} · Zeitplan: {report.period} · Standardformat: {report.format}</div>
      </Card>
      {body}
    </>
  );
}
