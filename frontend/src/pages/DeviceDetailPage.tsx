import { useEffect, useState } from 'react';
import { dataSource, type Alert, type Device, type Sensor } from '../api';
import { Link, updateQuery, useLocation } from '../app/router';
import { Sparkline } from '../components/charts/SmallCharts';
import { SensorDetail } from '../components/SensorDetail';
import { AlertList, EventList, sensorValueText } from '../components/shared';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Card, Empty, PageHeader, SeverityBadge, Skeleton, StatusBadge, StatusDot, Tabs } from '../components/ui';
import { Icon, deviceIcon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatDateTime, formatDuration, formatRelative } from '../utils/format';
import { DEVICE_TYPE_LABEL, SENSOR_TYPE_LABEL, STATUS_ORDER, statusSeverity } from '../utils/status';

type Tab = 'overview' | 'sensors' | 'history' | 'config';

export function DeviceDetailPage({ id }: { id: string }) {
  const { query } = useLocation();
  const tab = (query.get('tab') as Tab) || 'overview';
  const device = useData(() => dataSource.getDevice(id), [id]);
  const sensors = useData(() => dataSource.getSensors({ deviceId: id }), [id]);
  const site = useData(() => (device.data ? dataSource.getSite(device.data.siteId) : Promise.resolve(undefined)), [device.data?.siteId]);
  const alerts = useData(() => dataSource.getAlerts(), []);
  const deviceAlerts = (alerts.data ?? []).filter((a) => a.deviceId === id);

  if (device.loading && !device.data) return <Skeleton height={400} />;
  if (!device.data) {
    return (
      <>
        <PageHeader title="Gerät nicht gefunden" breadcrumb={[{ label: 'Devices', to: '/devices' }]} />
        <Empty>Es gibt kein Gerät mit der Kennung „{id}“.</Empty>
      </>
    );
  }
  const d = device.data;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Devices', to: '/devices' }, { label: site.data?.name ?? '…', to: `/devices?site=${d.siteId}` }, { label: d.name }]}
        title={
          <span className="device-hero">
            <span className="device-icon"><Icon name={deviceIcon(d.type)} size={24} /></span>
            <span>
              <span className="hstack" style={{ gap: 10 }}>{d.name} <StatusBadge status={d.status} /></span>
              <span className="muted small" style={{ fontWeight: 400 }}>
                <span className="mono">{d.ip}</span> · {DEVICE_TYPE_LABEL[d.type]} · {d.vendor} {d.model}
              </span>
            </span>
          </span>
        }
      />
      <Tabs<Tab>
        active={tab}
        onChange={(t) => updateQuery({ tab: t === 'overview' ? null : t, sensor: null })}
        tabs={[
          { id: 'overview', label: 'Übersicht' },
          { id: 'sensors', label: 'Sensoren', count: d.sensorCount },
          { id: 'history', label: 'Historie' },
          { id: 'config', label: 'Konfiguration' },
        ]}
      />
      {tab === 'overview' && <Overview device={d} sensors={sensors.data ?? []} siteName={site.data?.name} openAlerts={deviceAlerts.filter((a) => a.state !== 'resolved')} />}
      {tab === 'sensors' && <SensorsTab device={d} sensors={sensors.data} selected={query.get('sensor')} />}
      {tab === 'history' && <HistoryTab device={d} />}
      {tab === 'config' && <ConfigTab device={d} />}
    </>
  );

}

function Overview({ device, sensors, siteName, openAlerts }: { device: Device; sensors: Sensor[]; siteName?: string; openAlerts: Alert[] }) {
  const counts = STATUS_ORDER.map((s) => ({ s, n: sensors.filter((x) => x.status === s).length })).filter((x) => x.n > 0);
  return (
    <div className="grid grid-main-side">
      <div className="vstack" style={{ gap: 16 }}>
        <Card title="Sensoren auf einen Blick" actions={<Link to={`/devices/${device.id}?tab=sensors`} className="small">Alle Sensoren</Link>} flush>
          <div className="list">
            {[...sensors].sort((a, b) => statusSeverity(b.status) - statusSeverity(a.status)).map((s) => (
              <Link key={s.id} to={`/devices/${device.id}?tab=sensors&sensor=${s.id}`} className="list-item" style={{ color: 'var(--text)', alignItems: 'center' }}>
                <StatusDot status={s.status} />
                <div className="grow">
                  <div className="title">{s.name}</div>
                  <div className="meta">{s.message}</div>
                </div>
                <SensorSpark sensor={s} />
                <b className={`tabular text-${s.status}`} style={{ minWidth: 110, textAlign: 'right' }}>{sensorValueText(s)}</b>
              </Link>
            ))}
          </div>
        </Card>
        <Card title="Offene Alarme" flush>
          <AlertList alerts={openAlerts} devices={[device]} sensors={sensors} />
        </Card>
      </div>
      <Card title="Gerätedaten">
        <dl className="kv">
          <dt>Funktion</dt><dd>{device.description}</dd>
          <dt>Standort</dt><dd><Link to={`/sites?site=${device.siteId}`}>{siteName}</Link></dd>
          <dt>IP-Adresse</dt><dd className="mono">{device.ip}</dd>
          <dt>Betriebssystem</dt><dd>{device.os}</dd>
          <dt>Hersteller / Modell</dt><dd>{device.vendor} {device.model}</dd>
          <dt>Laufzeit</dt><dd>{device.uptimeDays} Tage</dd>
          <dt>Letzter Kontakt</dt><dd title={formatDateTime(device.lastContact)}>{formatRelative(device.lastContact)}</dd>
          <dt>Sensorstatus</dt>
          <dd className="hstack" style={{ flexWrap: 'wrap' }}>{counts.map((c) => <span key={c.s} className="hstack" style={{ gap: 5 }}><StatusDot status={c.s} />{c.n}</span>)}</dd>
          <dt>Tags</dt><dd>{device.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</dd>
        </dl>
      </Card>
    </div>
  );
}

function SensorSpark({ sensor }: { sensor: Sensor }) {
  const h = useData(() => dataSource.getSensorHistory(sensor.id, 6), [sensor.id]);
  const color = sensor.status === 'critical' ? 'var(--critical)' : sensor.status === 'warning' ? 'var(--warning)' : 'var(--series-1)';
  return h.data && sensor.status !== 'unknown' ? <Sparkline points={h.data} color={color} zeroBased={sensor.unit === '%' || sensor.unit === 'ms'} /> : <span style={{ width: 110 }} />;
}

function SensorsTab({ device, sensors, selected }: { device: Device; sensors?: Sensor[]; selected: string | null }) {
  const current = sensors?.find((s) => s.id === selected);
  const columns: Column<Sensor>[] = [
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} />, sortValue: (s) => -statusSeverity(s.status), width: 120 },
    { key: 'name', header: 'Sensor', render: (s) => <b>{s.name}</b>, sortValue: (s) => s.name },
    { key: 'type', header: 'Typ', render: (s) => SENSOR_TYPE_LABEL[s.type], sortValue: (s) => s.type },
    { key: 'value', header: 'Messwert', render: (s) => <span className="tabular">{sensorValueText(s)}</span>, sortValue: (s) => s.value, align: 'right' },
    { key: 'msg', header: 'Meldung', render: (s) => <span className="muted">{s.message}</span> },
    { key: 'last', header: 'Letzte Messung', render: (s) => <span className="muted">{formatRelative(s.lastCheck)}</span>, sortValue: (s) => s.lastCheck },
  ];
  return (
    <>
      {current && <SensorDetail sensor={current} onClose={() => updateQuery({ sensor: null })} />}
      <Card flush>
        {sensors ? (
          <DataTable rows={sensors} columns={columns} rowKey={(s) => s.id} onRowClick={(s) => updateQuery({ sensor: s.id })} initialSort={{ key: 'status', dir: 'asc' }} />
        ) : <Skeleton height={200} />}
      </Card>
      {!current && <div className="muted small">Tipp: Sensor anklicken, um Verlauf und Schwellwerte zu sehen. ({device.name})</div>}
    </>
  );
}

function HistoryTab({ device }: { device: Device }) {
  const events = useData(() => dataSource.getDeviceEvents(device.id), [device.id]);
  const alerts = useData(() => dataSource.getAlerts());
  const sensors = useData(() => dataSource.getSensors({ deviceId: device.id }), [device.id]);
  const senName = new Map((sensors.data ?? []).map((s) => [s.id, s.name]));
  const own = (alerts.data ?? []).filter((a) => a.deviceId === device.id);
  return (
    <div className="grid grid-main-side">
      <Card title="Alarmhistorie" sub="Aktive, bestätigte und normalisierte Alarme" flush>
        {own.length === 0 ? <div className="empty">Für dieses Gerät gibt es keine Alarme.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Schwere</th><th>Sensor</th><th>Beschreibung</th><th>Ausgelöst</th><th>Dauer</th><th>Zustand</th></tr></thead>
              <tbody>
                {own.map((a) => (
                  <tr key={a.id}>
                    <td><SeverityBadge severity={a.severity} /></td>
                    <td>{senName.get(a.sensorId)}</td>
                    <td>{a.description}</td>
                    <td className="muted">{formatDateTime(a.raisedAt)}</td>
                    <td className="tabular">{formatDuration(a.raisedAt, a.resolvedAt)}</td>
                    <td>{a.state === 'resolved' ? <span className="text-ok">Normalisiert</span> : a.state === 'acknowledged' ? `Bestätigt (${a.acknowledgedBy})` : <span className="text-critical">Offen</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Ereignisprotokoll" flush>
        {events.data ? <EventList events={events.data} /> : <Skeleton height={200} />}
      </Card>
    </div>
  );
}

function ConfigTab({ device }: { device: Device }) {
  const [cfg, setCfg] = useState(device.config);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3500);
    return () => clearTimeout(t);
  }, [saved]);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(device.config);
  return (
    <div className="grid grid-main-side">
      <Card title="Monitoring-Konfiguration">
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="cfg-interval">Abfrageintervall</label>
            <select id="cfg-interval" className="select" value={cfg.pollingIntervalSec} onChange={(e) => setCfg({ ...cfg, pollingIntervalSec: Number(e.target.value) })}>
              {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>{s < 60 ? `${s} Sekunden` : `${s / 60} Minute${s > 60 ? 'n' : ''}`}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cfg-proto">Protokoll</label>
            <select id="cfg-proto" className="select" value={cfg.protocol} onChange={(e) => setCfg({ ...cfg, protocol: e.target.value as typeof cfg.protocol })}>
              {['SNMP v3', 'SNMP v2c', 'WMI', 'SSH', 'ICMP', 'API'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cfg-cred">Zugangsprofil</label>
            <input id="cfg-cred" className="input" value={cfg.credentialProfile} onChange={(e) => setCfg({ ...cfg, credentialProfile: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cfg-notify">Benachrichtigungsgruppe</label>
            <input id="cfg-notify" className="input" value={cfg.notificationGroup} onChange={(e) => setCfg({ ...cfg, notificationGroup: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cfg-maint">Wartungsfenster</label>
            <input id="cfg-maint" className="input" placeholder="Kein Wartungsfenster" value={cfg.maintenanceWindow ?? ''} onChange={(e) => setCfg({ ...cfg, maintenanceWindow: e.target.value || null })} />
          </div>
        </div>
        <div className="hstack" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={!dirty} onClick={() => setSaved(true)}>Speichern</button>
          <button className="btn" disabled={!dirty} onClick={() => setCfg(device.config)}>Verwerfen</button>
          {saved && <span className="text-ok small">Übernommen (Demo – wird in Phase 1 nicht gespeichert)</span>}
        </div>
      </Card>
      <div className="vstack" style={{ gap: 16 }}>
        <div className="notice">
          <Icon name="key" size={18} />
          <div>Zugangsdaten werden nie im Gerät gespeichert, sondern nur als <b>Zugangsprofil</b> referenziert. Die Profile verwaltet später das Backend verschlüsselt.</div>
        </div>
        <Card title="Technische Kennung">
          <dl className="kv">
            <dt>Geräte-ID</dt><dd className="mono">{device.id}</dd>
            <dt>Collector</dt><dd>Standort-Collector</dd>
            <dt>Sensoren</dt><dd>{device.sensorCount}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
