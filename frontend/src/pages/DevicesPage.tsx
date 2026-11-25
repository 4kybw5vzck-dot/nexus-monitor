import { useMemo, useState } from 'react';
import { dataSource, management, type Device, type DeviceType, type Status } from '../api';
import { usePermissions } from '../app/session';
import { DeviceDialog } from '../components/manage/DeviceForms';
import { navigate, updateQuery, useLocation } from '../app/router';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Card, PageHeader, Select, Skeleton, StatusBadge } from '../components/ui';
import { Icon, deviceIcon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatRelative } from '../utils/format';
import { statusSeverity, DEVICE_TYPE_LABEL, STATUS_LABEL, STATUS_ORDER } from '../utils/status';

export function DevicesPage() {
  const { query } = useLocation();
  const q = query.get('q') ?? '';
  const site = query.get('site') ?? '';
  const type = (query.get('type') ?? '') as DeviceType | '';
  const status = (query.get('status') ?? '') as Status | '';

  const devices = useData(() => dataSource.getDevices());
  const { canEdit } = usePermissions();
  const [adding, setAdding] = useState(false);
  const sites = useData(() => dataSource.getSites());
  const siteName = new Map((sites.data ?? []).map((s) => [s.id, s.name]));

  const rows = useMemo(() => {
    const term = q.toLowerCase();
    return (devices.data ?? []).filter(
      (d) =>
        (!term || [d.name, d.ip, d.vendor, d.model, d.description, ...d.tags].some((v) => v.toLowerCase().includes(term))) &&
        (!site || d.siteId === site) &&
        (!type || d.type === type) &&
        (!status || d.status === status),
    );
  }, [devices.data, q, site, type, status]);

  const columns: Column<Device>[] = [
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} />, sortValue: (d) => -statusSeverity(d.status), width: 120 },
    {
      key: 'name', header: 'Gerätename', sortValue: (d) => d.name,
      render: (d) => (
        <span className="hstack" style={{ gap: 10 }}>
          <span className="muted"><Icon name={deviceIcon(d.type)} size={17} /></span>
          <span><b>{d.name}</b>{d.isDemo && <span className="tag" title="Aus dem Demo-Datensatz – wird nicht abgefragt" style={{ marginLeft: 6 }}>Demo</span>}<br /><span className="muted small">{d.description}</span></span>
        </span>
      ),
    },
    { key: 'ip', header: 'IP-Adresse', render: (d) => <span className="mono">{d.ip}</span>, sortValue: (d) => d.ip.split('.').map((p) => p.padStart(3, '0')).join('.') },
    { key: 'type', header: 'Gerätetyp', render: (d) => DEVICE_TYPE_LABEL[d.type], sortValue: (d) => DEVICE_TYPE_LABEL[d.type] },
    { key: 'vendor', header: 'Hersteller', render: (d) => <>{d.vendor}<br /><span className="muted small">{d.model}</span></>, sortValue: (d) => d.vendor },
    { key: 'site', header: 'Standort', render: (d) => siteName.get(d.siteId), sortValue: (d) => siteName.get(d.siteId) ?? '' },
    { key: 'sensors', header: 'Sensoren', render: (d) => d.sensorCount, sortValue: (d) => d.sensorCount, align: 'right' },
    { key: 'contact', header: 'Letzter Kontakt', render: (d) => <span className="muted">{formatRelative(d.lastContact)}</span>, sortValue: (d) => d.lastContact },
  ];

  const typeOptions = Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({ value: value as DeviceType, label }));

  return (
    <>
      <PageHeader
        title="Devices"
        description={devices.data ? `${rows.length} von ${devices.data.length} Geräten` : 'Geräteübersicht'}
        actions={management
          ? canEdit && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Gerät hinzufügen</button>
          : <button className="btn primary" onClick={() => navigate('/discovery')}><Icon name="plus" size={15} /> Gerät hinzufügen</button>}
      />
      {adding && <DeviceDialog onClose={() => setAdding(false)} onCreated={(d) => navigate(`/devices/${d.id}`)} />}
      <Card flush>
        <div className="toolbar" style={{ padding: '4px 14px 12px' }}>
          <div className="grow">
            <input className="input" placeholder="Name, IP, Hersteller, Tag …" value={q} aria-label="Geräte durchsuchen" onChange={(e) => updateQuery({ q: e.target.value })} />
          </div>
          <Select label="Standort" value={site} onChange={(v) => updateQuery({ site: v })} options={[{ value: '', label: 'Alle Standorte' }, ...(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
          <Select label="Gerätetyp" value={type} onChange={(v) => updateQuery({ type: v })} options={[{ value: '' as DeviceType | '', label: 'Alle Typen' }, ...typeOptions]} />
          <Select label="Status" value={status} onChange={(v) => updateQuery({ status: v })} options={[{ value: '' as Status | '', label: 'Alle Status' }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          {(q || site || type || status) && <button className="btn ghost" onClick={() => updateQuery({ q: null, site: null, type: null, status: null })}>Filter zurücksetzen</button>}
        </div>
        {devices.data ? (
          <DataTable rows={rows} columns={columns} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/devices/${d.id}`)} initialSort={{ key: 'status', dir: 'asc' }} />
        ) : <div style={{ padding: 16 }}><Skeleton height={300} /></div>}
      </Card>
    </>
  );
}
