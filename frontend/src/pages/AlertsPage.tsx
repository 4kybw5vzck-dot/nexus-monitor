import { useMemo, useState } from 'react';
import { dataSource, type Alert } from '../api';
import { Link, updateQuery, useLocation } from '../app/router';
import { CURRENT_USER } from '../app/session';
import { AckButton } from '../components/shared';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Card, KpiTile, PageHeader, Select, SeverityBadge, Skeleton, Tabs } from '../components/ui';
import { Icon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatDateTime, formatDuration, formatRelative } from '../utils/format';

type View = 'open' | 'critical' | 'warning' | 'resolved' | 'all';

export function AlertsPage() {
  const { query } = useLocation();
  const view = (query.get('view') as View) || 'open';
  const q = query.get('q') ?? '';
  const site = query.get('site') ?? '';
  const ack = query.get('ack') ?? '';
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const alerts = useData(() => dataSource.getAlerts());
  const devices = useData(() => dataSource.getDevices());
  const sensors = useData(() => dataSource.getSensors());
  const sites = useData(() => dataSource.getSites());
  const devName = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d.name])), [devices.data]);
  const senName = useMemo(() => new Map((sensors.data ?? []).map((s) => [s.id, s.name])), [sensors.data]);

  const all = alerts.data ?? [];
  const open = all.filter((a) => a.state !== 'resolved');
  const byView: Record<View, Alert[]> = {
    open,
    critical: open.filter((a) => a.severity === 'critical'),
    warning: open.filter((a) => a.severity === 'warning'),
    resolved: all.filter((a) => a.state === 'resolved'),
    all,
  };

  const rows = byView[view].filter((a) => {
    const term = q.toLowerCase();
    return (
      (!term || `${devName.get(a.deviceId)} ${senName.get(a.sensorId)} ${a.description}`.toLowerCase().includes(term)) &&
      (!site || a.siteId === site) &&
      (!ack || (ack === 'yes' ? a.state === 'acknowledged' : a.state === 'active'))
    );
  });

  const selectable = rows.filter((a) => a.state === 'active');
  const toggle = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const ackSelected = async () => {
    for (const id of selection) await dataSource.acknowledgeAlert(id, CURRENT_USER);
    setSelection(new Set());
  };

  const columns: Column<Alert>[] = [
    {
      key: 'sel', header: '', width: 34,
      render: (a) => a.state === 'active' ? (
        <input type="checkbox" aria-label="Alarm auswählen" checked={selection.has(a.id)} onChange={() => toggle(a.id)} onClick={(e) => e.stopPropagation()} />
      ) : null,
    },
    { key: 'sev', header: 'Schwere', render: (a) => <SeverityBadge severity={a.severity} />, sortValue: (a) => (a.severity === 'critical' ? 0 : 1), width: 110 },
    { key: 'time', header: 'Zeitstempel', render: (a) => <span title={formatRelative(a.raisedAt)}>{formatDateTime(a.raisedAt)}</span>, sortValue: (a) => a.raisedAt },
    { key: 'device', header: 'Gerät', render: (a) => <Link to={`/devices/${a.deviceId}`}>{devName.get(a.deviceId)}</Link>, sortValue: (a) => devName.get(a.deviceId) ?? '' },
    { key: 'sensor', header: 'Sensor', render: (a) => <Link to={`/devices/${a.deviceId}?tab=sensors&sensor=${a.sensorId}`}>{senName.get(a.sensorId)}</Link>, sortValue: (a) => senName.get(a.sensorId) ?? '' },
    { key: 'desc', header: 'Beschreibung', render: (a) => a.description },
    { key: 'dur', header: 'Dauer', render: (a) => <span className="tabular">{formatDuration(a.raisedAt, a.resolvedAt)}</span>, sortValue: (a) => new Date(a.resolvedAt ?? Date.now()).getTime() - new Date(a.raisedAt).getTime() },
    {
      key: 'ack', header: 'Bestätigung', sortValue: (a) => a.state,
      render: (a) =>
        a.state === 'resolved' ? <span className="text-ok">Normalisiert</span>
          : a.state === 'acknowledged' ? <span className="muted"><Icon name="check" size={13} /> {a.acknowledgedBy}, {formatRelative(a.acknowledgedAt!)}</span>
            : <AckButton alert={a} />,
    },
  ];

  return (
    <>
      <PageHeader title="Alerts" description="Alarme aller Standorte – offene Alarme bitte bestätigen" />
      <div className="grid grid-4">
        <KpiTile label="Kritisch (offen)" value={<span className="text-critical">{byView.critical.length}</span>} color="var(--critical)" />
        <KpiTile label="Warnungen (offen)" value={<span className="text-warning">{byView.warning.length}</span>} color="var(--warning)" />
        <KpiTile label="Unbestätigt" value={open.filter((a) => a.state === 'active').length} color="var(--accent)" />
        <KpiTile label="Normalisiert (24 Std.)" value={byView.resolved.length} color="var(--ok)" />
      </div>
      <Card flush>
        <Tabs<View>
          active={view}
          onChange={(v) => { updateQuery({ view: v === 'open' ? null : v }); setSelection(new Set()); }}
          tabs={[
            { id: 'open', label: 'Offen', count: byView.open.length },
            { id: 'critical', label: 'Kritisch', count: byView.critical.length },
            { id: 'warning', label: 'Warnungen', count: byView.warning.length },
            { id: 'resolved', label: 'Normalisiert', count: byView.resolved.length },
            { id: 'all', label: 'Alle', count: all.length },
          ]}
        />
        <div className="toolbar" style={{ padding: '12px 14px' }}>
          <div className="grow"><input className="input" placeholder="Gerät, Sensor oder Beschreibung …" aria-label="Alarme durchsuchen" value={q} onChange={(e) => updateQuery({ q: e.target.value })} /></div>
          <Select label="Standort" value={site} onChange={(v) => updateQuery({ site: v })} options={[{ value: '', label: 'Alle Standorte' }, ...(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
          <Select label="Bestätigung" value={ack} onChange={(v) => updateQuery({ ack: v })} options={[{ value: '', label: 'Bestätigt & unbestätigt' }, { value: 'no', label: 'Nur unbestätigte' }, { value: 'yes', label: 'Nur bestätigte' }]} />
          {selectable.length > 0 && (
            <button className="btn" onClick={() => setSelection(selection.size === selectable.length ? new Set() : new Set(selectable.map((a) => a.id)))}>
              {selection.size === selectable.length ? 'Auswahl aufheben' : 'Alle unbestätigten wählen'}
            </button>
          )}
          <button className="btn primary" disabled={selection.size === 0} onClick={ackSelected}>
            <Icon name="check" size={15} /> {selection.size || ''} bestätigen
          </button>
        </div>
        {alerts.data && devices.data && sensors.data ? (
          <DataTable rows={rows} columns={columns} rowKey={(a) => a.id} initialSort={{ key: 'time', dir: 'desc' }} empty="Keine Alarme in dieser Ansicht." />
        ) : <div style={{ padding: 16 }}><Skeleton height={260} /></div>}
      </Card>
    </>
  );
}
