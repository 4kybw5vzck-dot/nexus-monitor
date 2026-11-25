import { useEffect, useState } from 'react';
import { dataSource, management, type NotificationRule, type Role, type User } from '../api';
import { appConfig } from '../app/config';
import { updateQuery, useLocation } from '../app/router';
import { DataTable } from '../components/ui/DataTable';
import { Card, ErrorBox, PageHeader, Skeleton, Tabs } from '../components/ui';
import { CheckboxField, FormModal, SelectField, TextField } from '../components/ui/Modal';
import { currentUser, initials, useSession } from '../app/session';
import { CredentialProfilesTab } from '../components/manage/AdminForms';
import { Icon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatRelative } from '../utils/format';

type Tab = 'users' | 'credentials' | 'notifications' | 'system' | 'backup';

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
          ...(management ? [{ id: 'credentials' as Tab, label: 'Zugangsprofile' }] : []),
          { id: 'notifications', label: 'Benachrichtigungen' },
          { id: 'system', label: 'System' },
          { id: 'backup', label: 'Datensicherung' },
        ]}
      />
      {tab === 'users' && <UsersTab />}
      {tab === 'credentials' && management && <CredentialProfilesTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'system' && <SystemTab />}
      {tab === 'backup' && <BackupTab />}
    </>
  );
}

function UsersTab() {
  const users = useData(() => dataSource.getUsers());
  useSession();
  const me = currentUser(dataSource.kind === 'mock');
  const canEdit = !!management && me?.role === 'Administrator';
  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'edit'; user: User } | { kind: 'password'; user: User } | { kind: 'delete'; user: User } | null
  >(null);
  if (users.error) return <ErrorBox error={users.error} />;
  if (!users.data) return <Skeleton height={260} />;
  return (
    <>
      <Card
        flush
        title="Benutzer"
        sub={management ? 'Lokale Benutzer · später zusätzlich LDAP/Active Directory und OIDC' : 'Mock-Modus: Bearbeiten nur mit Backend möglich'}
        actions={canEdit && <button className="btn small" onClick={() => setDialog({ kind: 'create' })}><Icon name="plus" size={14} /> Benutzer anlegen</button>}
      >
        <DataTable
          rows={users.data}
          rowKey={(u) => u.id}
          initialSort={{ key: 'name', dir: 'asc' }}
          columns={[
            { key: 'name', header: 'Name', render: (u) => <span className="hstack"><span className="avatar">{initials(u.name)}</span><b>{u.name}</b></span>, sortValue: (u) => u.name },
            { key: 'login', header: 'Anmeldename', render: (u) => <span className="mono">{u.login}</span>, sortValue: (u) => u.login },
            { key: 'role', header: 'Rolle', render: (u) => u.role, sortValue: (u) => u.role },
            { key: 'mail', header: 'E-Mail', render: (u) => <span className="muted">{u.email}</span> },
            { key: 'last', header: 'Letzte Anmeldung', render: (u) => <span className="muted">{u.lastLogin ? formatRelative(u.lastLogin) : '–'}</span>, sortValue: (u) => u.lastLogin ?? '' },
            {
              key: 'active', header: 'Status', sortValue: (u) => (u.active ? 0 : 1),
              render: (u) => !u.active
                ? <span className="badge s-paused">Deaktiviert</span>
                : u.hasPassword === false
                  ? <span className="badge s-unknown" title="Ohne Passwort ist keine Anmeldung möglich">Kein Passwort</span>
                  : <span className="badge s-ok">Aktiv</span>,
            },
            ...(canEdit ? [{
              key: 'actions', header: '',
              render: (u: User) => (
                <div className="row-actions">
                  <button className="btn small ghost" onClick={() => setDialog({ kind: 'edit', user: u })}>Bearbeiten</button>
                  <button className="btn small ghost" onClick={() => setDialog({ kind: 'password', user: u })}><Icon name="key" size={13} /> Passwort</button>
                  {u.id !== me?.id && <button className="btn small ghost" onClick={() => setDialog({ kind: 'delete', user: u })}>Löschen</button>}
                </div>
              ),
            }] : []),
          ]}
        />
      </Card>
      {dialog?.kind === 'create' && <UserDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <UserDialog user={dialog.user} self={dialog.user.id === me?.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <SetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <FormModal title="Benutzer löschen" submitLabel="Endgültig löschen" danger onClose={() => setDialog(null)} onSubmit={() => management!.deleteUser(dialog.user.id)}>
          <div>Benutzer <b>{dialog.user.name}</b> (<span className="mono">{dialog.user.login}</span>) wird gelöscht. Das lässt sich nicht rückgängig machen.</div>
          <div className="muted small">Alternative: Benutzer deaktivieren – dann bleiben Name und Verlauf erhalten.</div>
        </FormModal>
      )}
    </>
  );
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'Administrator', label: 'Administrator – alles' },
  { value: 'Operator', label: 'Operator – lesen, Alarme bestätigen, Discovery' },
  { value: 'Nur Lesen', label: 'Nur Lesen' },
];

function UserDialog({ user, self, onClose }: { user?: User; self?: boolean; onClose: () => void }) {
  const [login, setLogin] = useState(user?.login ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'Operator');
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  async function save() {
    if (!user) {
      if (password && password !== password2) throw new Error('Die Passwörter stimmen nicht überein');
      await management!.createUser({ login, name, email, role, active, password: password || undefined });
    } else {
      await management!.updateUser(user.id, { name, email, role, active });
    }
  }

  return (
    <FormModal title={user ? `Benutzer bearbeiten – ${user.login}` : 'Benutzer anlegen'} submitLabel={user ? 'Speichern' : 'Anlegen'} onClose={onClose} onSubmit={save}>
      <div className="form-grid">
        <TextField label="Anmeldename" value={login} onChange={setLogin} required autoFocus={!user} disabled={!!user} autoComplete="off"
          hint={user ? 'Kann nicht geändert werden' : 'Buchstaben, Ziffern und . _ @ -'} />
        <TextField label="Name" value={name} onChange={setName} required autoFocus={!!user} />
        <TextField label="E-Mail" type="email" value={email} onChange={setEmail} />
        <SelectField label="Rolle" value={role} onChange={setRole} options={ROLE_OPTIONS} disabled={self} hint={self ? 'Die eigene Rolle kann nicht geändert werden' : undefined} />
      </div>
      {!user && (
        <div className="form-grid">
          <TextField label="Passwort" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="Optional, mindestens 10 Zeichen. Ohne Passwort ist keine Anmeldung möglich." />
          <TextField label="Passwort wiederholen" type="password" value={password2} onChange={setPassword2} autoComplete="new-password" />
        </div>
      )}
      {!self && <CheckboxField label="Konto aktiv (Anmeldung erlaubt)" checked={active} onChange={setActive} />}
    </FormModal>
  );
}

function SetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  return (
    <FormModal title={`Passwort setzen – ${user.login}`} submitLabel="Passwort setzen" onClose={onClose}
      onSubmit={async () => {
        if (password !== password2) throw new Error('Die Passwörter stimmen nicht überein');
        await management!.setUserPassword(user.id, password);
      }}>
      <TextField label="Neues Passwort" type="password" value={password} onChange={setPassword} required autoFocus autoComplete="new-password" hint="Mindestens 10 Zeichen" />
      <TextField label="Wiederholen" type="password" value={password2} onChange={setPassword2} required autoComplete="new-password" />
      <div className="muted small">Bestehende Anmeldungen des Benutzers werden beendet.</div>
    </FormModal>
  );
}

function NotificationsTab() {
  const rules = useData(() => dataSource.getNotificationRules());
  const [local, setLocal] = useState<NotificationRule[]>([]);
  useEffect(() => { if (rules.data) setLocal(rules.data); }, [rules.data]);
  if (!rules.data) return <Skeleton height={220} />;
  return (
    <Card flush title="Benachrichtigungsregeln" sub="Bearbeiten wird noch nicht gespeichert – Änderungen gelten nur bis zum Neuladen">
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
    ['Datenquelle', dataSource.kind === 'mock' ? 'Mock-Daten im Browser' : 'Backend-API'],
    ['API-Basis-URL', appConfig.apiBaseUrl],
    ['Betriebsmodus', 'Vollständig lokal, keine Cloud-Dienste'],
    ['Zeitzone (Browser)', Intl.DateTimeFormat().resolvedOptions().timeZone],
  ];
  return (
    <div className="grid grid-2">
      <Card title="Systeminformationen">
        <dl className="kv">{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Card>
      <Card title="Komponenten">
        <div className="list" style={{ margin: '0 -16px' }}>
          {[
            ['Frontend (React/TypeScript)', 'vorhanden', 'ok'],
            ['Backend (Python/FastAPI)', dataSource.kind === 'http' ? 'vorhanden – aktiv' : 'vorhanden – im Mock-Modus nicht genutzt', dataSource.kind === 'http' ? 'ok' : 'paused'],
            ['PostgreSQL – Konfiguration', dataSource.kind === 'http' ? 'vorhanden – aktiv' : 'vorhanden – im Mock-Modus nicht genutzt', dataSource.kind === 'http' ? 'ok' : 'paused'],
            ['TimescaleDB – Messwerte', 'vorhanden', dataSource.kind === 'http' ? 'ok' : 'paused'],
            ['Monitoring-Engine (Ping, SNMP, HTTP, DNS, SSH, WMI)', dataSource.kind === 'http' ? 'vorhanden – Collector-Container' : 'vorhanden – im Mock-Modus nicht genutzt', dataSource.kind === 'http' ? 'ok' : 'paused'],
            ['Remote-Collectoren', 'vorhanden – Anlage unter Collectors', dataSource.kind === 'http' ? 'ok' : 'paused'],
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
          Konfiguration (PostgreSQL), Messwerte (TimescaleDB) und die <span className="mono">.env</span>-Konfiguration
          werden über Skripte gesichert. Die Sicherung ist ein einzelnes Archiv, das auf einem anderen Server wiederhergestellt werden kann.
        </p>
        <pre className="mono" style={{ background: 'var(--bg-elev)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto' }}>
{`# Sicherung
./scripts/backup.sh                 (Linux)
.\\scripts\\backup.ps1                 (Windows)

# Wiederherstellung (auch auf neuem Server)
./scripts/restore.sh backups/nexus-<zeitstempel>.tar.gz
.\\scripts\\restore.ps1 .\\backups\\nexus-<zeitstempel>.tar.gz`}
        </pre>
        <div className="muted small">Details: docs/BETRIEB.md im Projekt.</div>
      </Card>
      <div className="notice warn">
        <Icon name="info" size={18} />
        <div>{dataSource.kind === 'mock'
          ? 'Im Mock-Modus gibt es keine persistenten Daten – alle Werte entstehen im Browser. Die Sicherung betrifft dann nur die Konfiguration.'
          : 'Die Sicherung enthält die Datenbank, sofern der Datenbankdienst läuft. Bash- und PowerShell-Skripte erzeugen dasselbe Archivformat.'}</div>
      </div>
    </div>
  );
}
