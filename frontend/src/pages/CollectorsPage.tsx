import { dataSource } from '../api';
import { Card, KpiTile, PageHeader, Skeleton, StatusBadge, UsageBar } from '../components/ui';
import { Icon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatNumber, formatRelative } from '../utils/format';

export function CollectorsPage() {
  const collectors = useData(() => dataSource.getCollectors());
  const sites = useData(() => dataSource.getSites());
  const siteName = new Map((sites.data ?? []).map((s) => [s.id, s.name]));
  const list = collectors.data ?? [];
  const remote = list.filter((c) => c.role === 'remote');

  return (
    <>
      <PageHeader title="Collectors" description="Zentrale Plattform und lokale Remote-Collectoren der Standorte" />
      <div className="grid grid-4">
        <KpiTile label="Remote-Collectoren" value={remote.length} color="var(--accent)" />
        <KpiTile label="Online" value={remote.filter((c) => c.status === 'ok' || c.status === 'warning').length} color="var(--ok)" />
        <KpiTile label="Mit Warnung" value={<span className="text-warning">{remote.filter((c) => c.status === 'warning').length}</span>} color="var(--warning)" />
        <KpiTile label="Messwerte in Warteschlange" value={formatNumber(list.reduce((s, c) => s + c.queueLength, 0), 0)} color="var(--series-3)" />
      </div>
      <div className="notice">
        <Icon name="info" size={18} />
        <div>
          Architektur: Jeder Standort erhält einen eigenen <b>Remote-Collector</b> (Docker-Container), der lokal misst und die Ergebnisse
          gepuffert an <b>NEXUS Core</b> überträgt. Fällt die WAN-Verbindung aus, sammelt der Collector weiter und überträgt nachträglich.
        </div>
      </div>
      {!collectors.data ? <Skeleton height={300} /> : (
        <div className="grid grid-2">
          {list.map((c) => (
            <Card
              key={c.id}
              title={<span className="hstack"><Icon name={c.role === 'central' ? 'database' : 'collectors'} size={16} />{c.name}<StatusBadge status={c.status} /></span>}
              sub={c.role === 'central' ? 'Zentrale Plattform (Core)' : `Remote-Collector · ${siteName.get(c.siteId ?? '')}`}
            >
              <dl className="kv" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 14 }}>
                <dt>Version</dt><dd>{c.version}{c.version !== '0.9.3' && <span className="text-warning small"> · Update verfügbar (0.9.3)</span>}</dd>
                <dt>Letzter Heartbeat</dt><dd>{formatRelative(c.lastHeartbeat)}</dd>
                <dt>{c.role === 'central' ? 'Sensoren gesamt' : 'Sensoren'}</dt><dd>{c.sensorCount}</dd>
                <dt>Warteschlange</dt><dd className={c.queueLength > 100 ? 'text-warning' : ''}>{c.queueLength} Messwerte</dd>
              </dl>
              <div className="vstack" style={{ gap: 10 }}>
                <div>
                  <div className="between small" style={{ marginBottom: 4 }}><span className="muted">CPU</span><span className="tabular">{c.cpu} %</span></div>
                  <UsageBar value={c.cpu} status={c.cpu > 80 ? 'warning' : 'ok'} />
                </div>
                <div>
                  <div className="between small" style={{ marginBottom: 4 }}><span className="muted">Arbeitsspeicher</span><span className="tabular">{c.memory} %</span></div>
                  <UsageBar value={c.memory} status={c.memory > 85 ? 'warning' : 'ok'} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
