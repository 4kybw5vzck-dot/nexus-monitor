/** Verwaltung: Zugangsprofile, Standorte, Collectors (nur mit Backend, Administratoren). */
import { useState } from 'react';
import { dataSource, management, type Collector, type CredentialField, type CredentialProfile, type DeviceConfig, type Site } from '../../api';
import { usePermissions } from '../../app/session';
import { useData } from '../../hooks/useData';
import { Card, ErrorBox, Skeleton } from '../ui';
import { DataTable } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { CheckboxField, FormModal, KeepOpen as KeepOpenError, SelectField, TextField } from '../ui/Modal';
import { ConfirmDelete, useCatalog } from './DeviceForms';

type Protocol = DeviceConfig['protocol'];
const PROFILE_PROTOCOLS: Protocol[] = ['SNMP v2c', 'SNMP v3', 'WMI', 'SSH', 'API'];

// ---------------------------------------------------------------------------
// Zugangsprofile
// ---------------------------------------------------------------------------

export function CredentialProfilesTab() {
  const { isAdmin } = usePermissions();
  const profiles = useData(() => management!.listCredentialProfiles());
  const [dialog, setDialog] = useState<{ kind: 'edit'; profile?: CredentialProfile } | { kind: 'delete'; profile: CredentialProfile } | null>(null);
  if (profiles.error) return <ErrorBox error={profiles.error} />;
  if (!profiles.data) return <Skeleton height={200} />;
  return (
    <>
      <Card
        flush
        title="Zugangsprofile"
        sub="Zugangsdaten für SNMP, WMI und SSH – verschlüsselt gespeichert, nie angezeigt. Geräte verweisen nur auf das Profil."
        actions={isAdmin && <button className="btn small" onClick={() => setDialog({ kind: 'edit' })}><Icon name="plus" size={14} /> Profil anlegen</button>}
      >
        <DataTable
          rows={profiles.data}
          rowKey={(p) => String(p.id)}
          initialSort={{ key: 'name', dir: 'asc' }}
          empty="Noch keine Zugangsprofile."
          columns={[
            { key: 'name', header: 'Name', render: (p) => <><b>{p.name}</b>{p.description && <><br /><span className="muted small">{p.description}</span></>}</>, sortValue: (p) => p.name },
            { key: 'protocol', header: 'Protokoll', render: (p) => p.protocol, sortValue: (p) => p.protocol },
            { key: 'user', header: 'Benutzer / Port', render: (p) => <span className="mono small">{[p.fields.username, p.fields.port].filter((x) => x != null && x !== '').join(' · ') || '–'}</span> },
            {
              key: 'state', header: 'Zugangsdaten',
              render: (p) => !p.readable
                ? <span className="badge s-critical" title="Passt nicht zum aktuellen NEXUS_SECRET_KEY – neu eingeben">nicht lesbar</span>
                : p.hasSecret ? <span className="badge s-ok">hinterlegt</span> : <span className="badge s-unknown">fehlen</span>,
            },
            { key: 'devices', header: 'Geräte', render: (p) => p.deviceCount, sortValue: (p) => p.deviceCount, align: 'right' },
            ...(isAdmin ? [{
              key: 'actions', header: '',
              render: (p: CredentialProfile) => (
                <div className="row-actions">
                  <button className="btn small ghost" onClick={() => setDialog({ kind: 'edit', profile: p })}>Bearbeiten</button>
                  <button className="btn small ghost" disabled={p.deviceCount > 0} title={p.deviceCount ? 'Wird noch von Geräten verwendet' : undefined}
                    onClick={() => setDialog({ kind: 'delete', profile: p })}>Löschen</button>
                </div>
              ),
            }] : []),
          ]}
        />
      </Card>
      {dialog?.kind === 'edit' && <ProfileDialog profile={dialog.profile} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDelete title="Zugangsprofil löschen" onClose={() => setDialog(null)} onConfirm={() => management!.deleteCredentialProfile(dialog.profile.id)}>
          Zugangsprofil <b>{dialog.profile.name}</b> und die darin gespeicherten Zugangsdaten werden gelöscht.
        </ConfirmDelete>
      )}
    </>
  );
}

function ProfileDialog({ profile, onClose }: { profile?: CredentialProfile; onClose: () => void }) {
  const catalog = useCatalog();
  const [name, setName] = useState(profile?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(profile?.protocol ?? 'SNMP v2c');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(profile?.fields ?? {})) if (typeof val !== 'boolean' || k === 'verifyTls') v[k] = val;
    return v;
  });
  const fields: CredentialField[] = catalog.data?.credentialFields[protocol] ?? [];
  const sameProtocol = profile && profile.protocol === protocol;

  async function save() {
    const credentials: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'bool') credentials[f.key] = v === undefined ? f.default ?? false : v;
      else if (v !== undefined && v !== '') credentials[f.key] = v;
      else if (!f.secret) credentials[f.key] = '';
    }
    if (profile) await management!.updateCredentialProfile(profile.id, { name, protocol, description, credentials });
    else await management!.createCredentialProfile({ name, protocol, description, credentials });
  }

  return (
    <FormModal wide title={profile ? `Zugangsprofil bearbeiten – ${profile.name}` : 'Zugangsprofil anlegen'} submitLabel={profile ? 'Speichern' : 'Anlegen'} onClose={onClose} onSubmit={save}>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} required autoFocus placeholder="z. B. SNMP Switches Zentrale" />
        <SelectField label="Protokoll" value={protocol} onChange={(p) => { setProtocol(p); setValues({}); }} disabled={!!profile && profile.deviceCount > 0}
          options={PROFILE_PROTOCOLS.map((p) => ({ value: p, label: p }))}
          hint={profile && profile.deviceCount > 0 ? 'Wird von Geräten verwendet – Protokoll nicht änderbar' : undefined} />
      </div>
      <TextField label="Beschreibung" value={description} onChange={setDescription} />
      {protocol === 'WMI' && (
        <div className="notice"><Icon name="info" size={16} /><div>Abfrage über <b>WinRM</b> (WS-Management, HTTP 5985 / HTTPS 5986) mit NTLM. Der Benutzer braucht Leserechte auf WMI, z. B. Mitglied in „Remoteverwaltungsbenutzer“ und „Leistungsüberwachungsbenutzer“.</div></div>
      )}
      <div className="form-grid">
        {fields.map((f) => {
          const label = f.label + (f.secret && sameProtocol && profile?.fields[f.key] ? ' (gespeichert – leer lassen zum Beibehalten)' : '');
          if (f.type === 'bool') {
            return <CheckboxField key={f.key} label={f.label} checked={values[f.key] === undefined ? !!f.default : !!values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />;
          }
          if (f.options) {
            return <SelectField key={f.key} label={f.label} value={String(values[f.key] ?? f.default ?? f.options[0])} onChange={(v) => setValues({ ...values, [f.key]: v })}
              options={f.options.map((o) => ({ value: o, label: o }))} />;
          }
          if (f.multiline) {
            return (
              <div className="field" key={f.key} style={{ gridColumn: '1 / -1' }}>
                <label>{label}</label>
                <textarea className="input mono" rows={4} style={{ height: 'auto', paddingTop: 8 }} value={String(values[f.key] ?? '')} autoComplete="off"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              </div>
            );
          }
          return (
            <TextField key={f.key} label={label} type={f.secret ? 'password' : 'text'} value={String(values[f.key] ?? '')}
              onChange={(v) => setValues({ ...values, [f.key]: v })} required={f.required && (!f.secret || !sameProtocol || !profile?.fields[f.key])}
              placeholder={f.default != null ? String(f.default) : undefined} autoComplete={f.secret ? 'new-password' : 'off'} />
          );
        })}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Standorte
// ---------------------------------------------------------------------------

export function SiteDialog({ site, onClose }: { site?: Site; onClose: () => void }) {
  const collectors = useData(() => dataSource.getCollectors());
  const [name, setName] = useState(site?.name ?? '');
  const [city, setCity] = useState(site?.city ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [subnet, setSubnet] = useState(site?.subnet ?? '');
  const [contact, setContact] = useState(site?.contact ?? '');
  const [collectorId, setCollectorId] = useState(site?.collectorId ?? '');
  async function save() {
    const body = { name, city, address, subnet, contact, collectorId: collectorId || null };
    if (site) await management!.updateSite(site.id, body);
    else await management!.createSite(body);
  }
  return (
    <FormModal title={site ? `Standort bearbeiten – ${site.name}` : 'Standort anlegen'} submitLabel={site ? 'Speichern' : 'Anlegen'} onClose={onClose} onSubmit={save}>
      <TextField label="Name" value={name} onChange={setName} required autoFocus />
      <div className="form-grid">
        <TextField label="Ort" value={city} onChange={setCity} />
        <TextField label="Adresse" value={address} onChange={setAddress} />
        <TextField label="Netz (Info)" value={subnet} onChange={setSubnet} placeholder="z. B. 10.10.0.0/16" />
        <TextField label="Ansprechpartner" value={contact} onChange={setContact} />
      </div>
      <SelectField label="Collector des Standorts (Anzeige)" value={collectorId} onChange={setCollectorId}
        options={[{ value: '', label: '– keiner –' }, ...(collectors.data ?? []).map((c) => ({ value: c.id, label: c.name + (c.isDemo ? ' (Demo)' : '') }))]}
        hint="Welcher Collector ein Gerät abfragt, wird am Gerät festgelegt." />
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

export function CollectorCreateDialog({ onClose }: { onClose: () => void }) {
  const sites = useData(() => dataSource.getSites());
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [token, setToken] = useState<string | null>(null);
  if (token) return <TokenDialog title={`Collector „${name}“ angelegt`} token={token} onClose={onClose} />;
  return (
    <FormModal title="Remote-Collector anlegen" submitLabel="Anlegen" onClose={onClose}
      onSubmit={async () => {
        const r = await management!.createCollector(name, siteId || null);
        setToken(r.token);
        throw new KeepOpenError();
      }}>
      <TextField label="Name" value={name} onChange={setName} required autoFocus placeholder="z. B. COL-LU-01" />
      <SelectField label="Standort" value={siteId} onChange={setSiteId} options={[{ value: '', label: '– ohne –' }, ...(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
    </FormModal>
  );
}


export function TokenDialog({ title, token, onClose }: { title: string; token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://<server>';
  const snippet = `NEXUS_CORE_URL=${origin}\nNEXUS_COLLECTOR_TOKEN=${token}`;
  return (
    <FormModal title={title} submitLabel="Fertig" onClose={onClose} onSubmit={async () => undefined}>
      <div className="notice warn"><Icon name="key" size={16} /><div>Der Token wird <b>nur jetzt</b> angezeigt. In der Zentrale ist nur ein Hash gespeichert.</div></div>
      <div className="field">
        <label>Einträge für die .env des Collectors am Standort</label>
        <pre className="mono" style={{ background: 'var(--bg-elev)', padding: 10, borderRadius: 6, border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{snippet}</pre>
      </div>
      <button type="button" className="btn small" onClick={() => { void navigator.clipboard?.writeText(snippet).then(() => setCopied(true)); }}>
        <Icon name="check" size={14} /> {copied ? 'Kopiert' : 'In die Zwischenablage kopieren'}
      </button>
      <div className="muted small">Start am Standort: siehe docs/BETRIEB.md, Abschnitt „Remote-Collector“.</div>
    </FormModal>
  );
}

export function CollectorActions({ collector }: { collector: Collector }) {
  const { isAdmin } = usePermissions();
  const [dialog, setDialog] = useState<'renew' | 'delete' | null>(null);
  const [token, setToken] = useState<string | null>(null);
  if (!management || !isAdmin) return null;
  const canDelete = collector.isDemo || collector.role !== 'central';
  return (
    <div className="row-actions">
      {!collector.isDemo && collector.role === 'remote' && <button className="btn small ghost" onClick={() => setDialog('renew')}><Icon name="key" size={13} /> Neuer Token</button>}
      {canDelete && <button className="btn small ghost" onClick={() => setDialog('delete')}>Löschen</button>}
      {dialog === 'renew' && !token && (
        <FormModal title={`Neuer Token – ${collector.name}`} submitLabel="Neuen Token erzeugen" onClose={() => setDialog(null)}
          onSubmit={async () => { setToken((await management!.renewCollectorToken(collector.id)).token); throw new KeepOpenError(); }}>
          Der bisherige Token wird sofort ungültig. Der Collector am Standort muss danach mit dem neuen Token neu gestartet werden.
        </FormModal>
      )}
      {token && <TokenDialog title={`Neuer Token – ${collector.name}`} token={token} onClose={() => { setToken(null); setDialog(null); }} />}
      {dialog === 'delete' && (
        <ConfirmDelete title="Collector löschen" onClose={() => setDialog(null)} onConfirm={() => management!.deleteCollector(collector.id)}>
          Collector <b>{collector.name}</b> wird gelöscht. Zugeordnete Geräte werden danach vom zentralen Collector abgefragt.
        </ConfirmDelete>
      )}
    </div>
  );
}
