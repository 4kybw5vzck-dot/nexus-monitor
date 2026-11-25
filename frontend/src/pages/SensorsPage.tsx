import { useMemo } from 'react';
import { dataSource, type Sensor, type SensorType, type Status } from '../api';
import { Link, updateQuery, useLocation } from '../app/router';
import { SensorDetail } from '../components/SensorDetail';
import { sensorValueText } from '../components/shared';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Card, PageHeader, Select, Skeleton, StatusBadge, StatusDot } from '../components/ui';
import { useData } from '../hooks/useData';
import { formatRelative } from '../utils/format';
import { SENSOR_TYPE_LABEL, STATUS_LABEL, STATUS_ORDER, statusSeverity } from '../utils/status';

export function SensorsPage() {
  const { query } = useLocation();
  const q = query.get('q') ?? '';
  const type = (query.get('type') ?? '') as SensorType | '';
  const status = (query.get('status') ?? '') as Status | '';
  const site = query.get('site') ?? '';
  const selected = query.get('sensor');

  const sensors = useData(() => dataSource.getSensors());
  const devices = useData(() => dataSource.getDevices());
  const sites = useData(() => dataSource.getSites());
  const devById = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d])), [devices.data]);

  const rows = useMemo(() => {
    const term = q.toLowerCase();
    return (sensors.data ?? []).filter((s) => {
      const dev = devById.get(s.deviceId);
      return (
        (!term || `${s.name} ${dev?.name} ${s.message}`.toLowerCase().includes(term)) &&
        (!type || s.type === type) &&
        (!status || s.status === status) &&
        (!site || dev?.siteId === site)
      );
    });
  }, [sensors.data, devById, q, type, status, site]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { ok: 0, warning: 0, critical: 0, unknown: 0, paused: 0 };
    (sensors.data ?? []).forEach((s) => c[s.status]++);
    return c;
  }, [sensors.data]);

  const current = sensors.data?.find((s) => s.id === selected);

  const columns: Column<Sensor>[] = [
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} />, sortValue: (s) => -statusSeverity(s.status), width: 120 },
    { key: 'name', header: 'Sensor', render: (s) => <b>{s.name}</b>, sortValue: (s) => s.name },
    {
      key: 'device', header: 'Gerät', sortValue: (s) => devById.get(s.deviceId)?.name ?? '',
      render: (s) => <Link to={`/devices/${s.deviceId}`} onClick={(e) => e.stopPropagation()}>{devById.get(s.deviceId)?.name}</Link>,
    },
    { key: 'type', header: 'Typ', render: (s) => SENSOR_TYPE_LABEL[s.type], sortValue: (s) => SENSOR_TYPE_LABEL[s.type] },
    { key: 'value', header: 'Messwert', render: (s) => <span className={`tabular text-${s.status}`}>{sensorValueText(s)}</span>, sortValue: (s) => s.value, align: 'right' },
    { key: 'msg', header: 'Meldung', render: (s) => <span className="muted">{s.message}</span> },
    { key: 'last', header: 'Letzte Messung', render: (s) => <span className="muted">{formatRelative(s.lastCheck)}</span>, sortValue: (s) => s.lastCheck },
  ];

  return (
    <>
      <PageHeader title="Sensors" description={sensors.data ? `${rows.length} von ${sensors.data.length} Sensoren` : 'Sensorübersicht'} />
      <div className="toolbar">
        {STATUS_ORDER.map((st) => (
          <button key={st} className={`btn small ${status === st ? 'primary' : ''}`} onClick={() => updateQuery({ status: status === st ? null : st })}>
            <StatusDot status={st} /> {STATUS_LABEL[st]} <b className="tabular">{counts[st]}</b>
          </button>
        ))}
      </div>
      {current && (
        <SensorDetail sensor={current} deviceName={devById.get(current.deviceId)?.name} onClose={() => updateQuery({ sensor: null })} />
      )}
      <Card flush>
        <div className="toolbar" style={{ padding: '4px 14px 12px' }}>
          <div className="grow">
            <input className="input" placeholder="Sensor, Gerät oder Meldung …" value={q} aria-label="Sensoren durchsuchen" onChange={(e) => updateQuery({ q: e.target.value })} />
          </div>
          <Select label="Sensortyp" value={type} onChange={(v) => updateQuery({ type: v })} options={[{ value: '' as SensorType | '', label: 'Alle Sensortypen' }, ...Object.entries(SENSOR_TYPE_LABEL).map(([value, label]) => ({ value: value as SensorType, label }))]} />
          <Select label="Standort" value={site} onChange={(v) => updateQuery({ site: v })} options={[{ value: '', label: 'Alle Standorte' }, ...(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
          {(q || type || status || site) && <button className="btn ghost" onClick={() => updateQuery({ q: null, type: null, status: null, site: null })}>Filter zurücksetzen</button>}
        </div>
        {sensors.data && devices.data ? (
          <DataTable rows={rows} columns={columns} rowKey={(s) => s.id} onRowClick={(s) => { updateQuery({ sensor: s.id }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} initialSort={{ key: 'status', dir: 'asc' }} pageSize={30} />
        ) : <div style={{ padding: 16 }}><Skeleton height={300} /></div>}
      </Card>
    </>
  );
}
