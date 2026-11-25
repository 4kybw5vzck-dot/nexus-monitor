import { dataSource, type Status } from '../api';
import { Link, navigate, updateQuery, useLocation } from '../app/router';
import { Card, PageHeader, Skeleton, StatusBadge, StatusDot } from '../components/ui';
import { Icon, deviceIcon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatNumber, formatRelative } from '../utils/format';
import { STATUS_ORDER, statusSeverity, worstStatus } from '../utils/status';

export function SitesPage() {
  const { query } = useLocation();
  const focus = query.get('site');
  const sites = useData(() => dataSource.getSites());
  const devices = useData(() => dataSource.getDevices());
  const sensors = useData(() => dataSource.getSensors());
  const collectors = useData(() => dataSource.getCollectors());
  const alerts = useData(() => dataSource.getAlerts());
  const avail = useData(() => dataSource.getAvailability(24));

  if (!sites.data || !devices.data || !sensors.data) return <><PageHeader title="Sites" /><Skeleton height={400} /></>;
  const list = focus ? sites.data.filter((s) => s.id === focus) : sites.data;

  return (
    <>
      <PageHeader
        title="Sites"
        description={`${sites.data.length} Standorte mit je einem lokalen Remote-Collector`}
        actions={focus ? <button className="btn" onClick={() => updateQuery({ site: null })}>Alle Standorte anzeigen</button> : undefined}
      />
      <div className={`grid ${focus ? '' : 'grid-3'}`}>
        {list.map((site) => {
          const devs = devices.data!.filter((d) => d.siteId === site.id);
          const ids = new Set(devs.map((d) => d.id));
          const sens = sensors.data!.filter((s) => ids.has(s.deviceId));
          const st: Status = worstStatus(devs.map((d) => d.status));
          const col = collectors.data?.find((c) => c.id === site.collectorId);
          const open = (alerts.data ?? []).filter((a) => a.siteId === site.id && a.state !== 'resolved').length;
          const av = (avail.data ?? []).filter((a) => a.siteId === site.id);
          const availability = av.length ? av.reduce((s, a) => s + a.availability, 0) / av.length : undefined;
          const counts = STATUS_ORDER.map((s) => ({ s, n: sens.filter((x) => x.status === s).length }));
          return (
            <Card
              key={site.id}
              title={<span className="hstack"><Icon name="sites" size={16} />{site.name}<StatusBadge status={st} /></span>}
              sub={`${site.address}, ${site.city} · Netz ${site.subnet}`}
              actions={!focus ? <button className="btn small" onClick={() => updateQuery({ site: site.id })}>Details</button> : undefined}
            >
              <div className="grid grid-4" style={{ marginBottom: 14 }}>
                <div><div className="muted small">Geräte</div><div style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap' }}>{devs.length}</div></div>
                <div><div className="muted small">Sensoren</div><div style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap' }}>{sens.length}</div></div>
                <div><div className="muted small">Offene Alarme</div><div style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap' }} className={open ? 'text-critical' : ''}>{open}</div></div>
                <div><div className="muted small">Verfügbarkeit</div><div style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap' }}>{availability !== undefined ? `${formatNumber(availability, 2)} %` : '–'}</div></div>
              </div>
              <div className="hstack small" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
                {counts.map((c) => <span key={c.s} className="hstack" style={{ gap: 5 }}><StatusDot status={c.s} />{c.n}</span>)}
              </div>
              {col && (
                <div className="between small" style={{ padding: '8px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                  <span className="hstack"><Icon name="collectors" size={15} /> Collector <Link to="/collectors">{col.name}</Link></span>
                  <span className="hstack"><StatusDot status={col.status} /> Heartbeat {formatRelative(col.lastHeartbeat)}</span>
                </div>
              )}
              <div className="list" style={{ margin: '0 -16px' }}>
                {[...devs].sort((a, b) => statusSeverity(b.status) - statusSeverity(a.status)).slice(0, focus ? undefined : 6).map((d) => (
                  <Link key={d.id} to={`/devices/${d.id}`} className="list-item" style={{ color: 'var(--text)', alignItems: 'center', padding: '7px 16px' }}>
                    <StatusDot status={d.status} />
                    <span className="muted"><Icon name={deviceIcon(d.type)} size={15} /></span>
                    <div className="grow"><b>{d.name}</b> <span className="muted small">{d.description}</span></div>
                    <span className="mono muted">{d.ip}</span>
                  </Link>
                ))}
              </div>
              <div className="hstack" style={{ marginTop: 12 }}>
                <button className="btn small" onClick={() => navigate(`/devices?site=${site.id}`)}>Alle Geräte</button>
                <button className="btn small" onClick={() => navigate(`/maps?site=${site.id}`)}>Netzwerkkarte</button>
                <button className="btn small" onClick={() => navigate(`/alerts?site=${site.id}`)}>Alarme</button>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
