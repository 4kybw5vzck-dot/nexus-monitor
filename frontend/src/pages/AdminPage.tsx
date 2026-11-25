import { useEffect, useState } from 'react';
import { dataSource, type NotificationRule } from '../api';
import { appConfig } from '../app/config';
import { updateQuery, useLocation } from '../app/router';
import { DataTable } from '../components/ui/DataTable';
import { Card, PageHeader, Skeleton, Tabs } from '../components/ui';
import { Icon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatRelative } from '../utils/format';

type Tab = 'users' | 'notifications' | 'system' | 'backup';

export function AdminPage() {
  const { query } = useLocation();
  const tab = (query.get('tab') as Tab) || 'users';
  return (
    <>
      <PageHeader title="Administration" description="Benutzer, Benachrichtigungen und Systemeinstellungen" />
      <Tabs<Tab>
        active={tab}
        onChange={(t) => updateQuery({ tab: t === 'users' ? null : t })}
        tabs={[
          { id: 'users', label: 'Benutzer & Rollen' },
          { id: 'notifications', label: 'Benachrichtigungen' },
          { id: 'system', label: 'System' },
          { id: 'backup', label: 'Datensicherung' },
        ]}
      />
      {tab === 'users' && <UsersTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'system' && <SystemTab />}
      {tab === 'backup' && <BackupTab />}
    </>
  );
}

function UsersTab() {
  const users = useData(() => dataSource.getUsers());
  if (!users.data) return <Skeleton height={260} />;
  return (
    <Card flush title="Benutzer" sub="Lokale Benutzer · später zusätzlich LDAP/Active Directory und OIDC" actions={<button className="btn small" disabled title="Ab Phase 2"><Icon name="plus" size={14} /> Benutzer anlegen</button>}>
      <DataTable
        rows={users.data}
        rowKey={(u) => u.id}
        initialSort={{ key: 'name', dir: 'asc' }}
        columns={[
          { key: 'name', header: 'Name', render: (u) => <span className="hstack"><span className="avatar">{u.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span><b>{u.name}</b></span>, sortValue: (u) => u.name },
          { key: 'login', header: 'Anmeldename', render: (u) => <span className="mono">{u.login}</span>, sortValue: (u) => u.login },
          { key: 'role', header: 'Rolle', render: (u) => u.role, sortValue: (u) => u.role },
          { key: 'mail', header: 'E-Mail', render: (u) => <span className="muted">{u.email}</span> },
          { key: 'last', header: 'Letzte Anmeldung', render: (u) => <span className="muted">{formatRelative(u.lastLogin)}</span>, sortValue: (u) => u.lastLogin },
          { key: 'active', header: 'Status', render: (u) => (u.active ? <span className="badge s-ok">Aktiv</span> : <span className="badge s-paused">Deaktiviert</span>), sortValue: (u) => (u.active ? 0 : 1) },
        ]}
      />
    </Card>
  );
}

function NotificationsTab() {
  const rules = useData(() => dataSource.getNotificationRules());
  const [local, setLocal] = useState<NotificationRule[]>([]);
  useEffect(() => { if (rules.data) setLocal(rules.data); }, [rules.data]);
  if (!rules.data) return <Skeleton height={220} />;
  return (
    <Card flush title="Benachrichtigungsregeln" sub="Änderungen gelten in Phase 1 nur bis zum Neuladen">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Aktiv</th><th>Regel</th><th>Auslöser</th><th>Kanal</th><th>Ziel</th></tr></thead>
          <tbody>
            {local.map((r) => (
              <tr key={r.id}>
                <td>
                  <button
                    className={`switch${r.enabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={`${r.name} ${r.enabled ? 'deaktivieren' : 'aktivieren'}`}
                    onClick={() => setLocal((l) => l.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}
                  />
                </td>
                <td><b>{r.name}</b></td>
                <td>{r.trigger}</td>
                <td>{r.channel}</td>
                <td className="muted">{r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SystemTab() {
  const rows: Array<[string, string]> = [
    ['Instanzname', appConfig.instanceName],
    ['Version', appConfig.version],
    ['Datenquelle', dataSource.kind === 'mock' ? 'Mock-Daten (Phase 1)' : 'Backend-API'],
    ['API-Basis-URL', appConfig.apiBaseUrl],
    ['Betriebsmodus', 'Vollständig lokal, keine Cloud-Dienste'],
    ['Zeitzone (Browser)', Intl.DateTimeFormat().resolvedOptions().timeZone],
  ];
  return (
    <div className="grid grid-2">
      <Card title="Systeminformationen">
        <dl className="kv">{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Card>
      <Card title="Geplante Komponenten">
        <div className="list" style={{ margin: '0 -16px' }}>
          {[
            ['Frontend (React/TypeScript)', 'Phase 1 – vorhanden', 'ok'],
            ['Backend (Python/FastAPI)', 'Phase 2', 'paused'],
            ['PostgreSQL – Konfiguration', 'Phase 2 – im Compose vorbereitet', 'paused'],
            ['TimescaleDB – Messwerte', 'Phase 2 – im Compose vorbereitet', 'paused'],
            ['Monitoring-Engine (SNMP, ICMP, WMI …)', 'Phase 3', 'paused'],
            ['Remote-Collectoren', 'Phase 3', 'paused'],
          ].map(([name, phase, st]) => (
            <div className="list-item" key={name}>
              <span className={`dot s-${st}`} style={{ marginTop: 6 }} />
              <div className="grow"><div className="title">{name}</div><div className="meta">{phase}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BackupTab() {
  return (
    <div className="grid grid-2">
      <Card title="Datensicherung und Wiederherstellung">
        <p style={{ marginTop: 0, color: 'var(--text-2)' }}>
          Ab Phase 2 werden Konfiguration (PostgreSQL), Messwerte (TimescaleDB) und die <span className="mono">.env</span>-Konfiguration
          über Skripte gesichert. Die Sicherung ist ein einzelnes Archiv, das auf einem anderen Server wiederhergestellt werden kann.
        </p>
        <pre className="mono" style={{ background: 'var(--bg-elev)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto' }}>
{`# Sicherung
./scripts/backup.sh

# Wiederherstellung (auch auf neuem Server)
./scripts/restore.sh backups/nexus-<zeitstempel>.tar.gz`}
        </pre>
        <div className="muted small">Details: docs/BETRIEB.md im Projekt.</div>
      </Card>
      <div className="notice warn">
        <Icon name="info" size={18} />
        <div>In Phase 1 gibt es noch keine persistenten Daten – alle Werte sind Mock-Daten im Browser. Die Skripte sind vorbereitet und werden mit dem Backend aktiv.</div>
      </div>
    </div>
  );
}
