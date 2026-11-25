/** Formulare für Geräte und Sensoren (nur mit Backend). */
import { useEffect, useState, type ReactNode } from 'react';
import {
  dataSource,
  management,
  type Catalog,
  type CredentialProfile,
  type Device,
  type DeviceConfig,
  type DeviceType,
  type Sensor,
  type SensorType,
} from '../../api';
import { useData } from '../../hooks/useData';
import { DEVICE_TYPE_LABEL } from '../../utils/status';
import { CheckboxField, FormModal, SelectField, TextField } from '../ui/Modal';

type Protocol = DeviceConfig['protocol'];
const PROTOCOLS: Protocol[] = ['SNMP v2c', 'SNMP v3', 'WMI', 'SSH', 'ICMP', 'API'];
const PROTOCOL_HINT: Record<Protocol, string> = {
  'SNMP v2c': 'Switches, Router, Firewalls, USV, Speicher',
  'SNMP v3': 'wie SNMP v2c, mit Benutzer und Verschlüsselung',
  WMI: 'Windows-Server – Abfrage per WinRM (Port 5985/5986)',
  SSH: 'Linux/Unix-Server',
  ICMP: 'Nur Ping, HTTP und DNS',
  API: 'Noch keine Prüfungen (z. B. vCenter folgt) – nur Ping, HTTP, DNS',
};
/** Naheliegendes Protokoll je Gerätetyp */
const DEFAULT_PROTOCOL: Record<DeviceType, Protocol> = {
  'windows-server': 'WMI', 'hypervisor-hyperv': 'WMI', 'linux-server': 'SSH', 'hypervisor-vmware': 'ICMP',
  switch: 'SNMP v2c', router: 'SNMP v2c', firewall: 'SNMP v2c', storage: 'SNMP v2c', backup: 'SNMP v2c', ups: 'SNMP v2c',
};

export function useCatalog() {
  return useData(() => (management ? management.getCatalog() : Promise.reject(new Error('Nur mit Backend'))), []);
}

function useProfiles() {
  return useData(() => (management ? management.listCredentialProfiles() : Promise.resolve([] as CredentialProfile[])), []);
}

const intervalOptions = [10, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => ({
  value: String(s),
  label: s < 60 ? `${s} Sekunden` : s < 3600 ? `${s / 60} Minute${s > 60 ? 'n' : ''}` : '1 Stunde',
}));

// ---------------------------------------------------------------------------
// Gerät anlegen / bearbeiten
// ---------------------------------------------------------------------------

export function DeviceDialog({ device, onClose, onCreated }: { device?: Device; onClose: () => void; onCreated?: (d: Device) => void }) {
  const sites = useData(() => dataSource.getSites());
  const collectors = useData(() => dataSource.getCollectors());
  const profiles = useProfiles();
  const catalog = useCatalog();

  const [name, setName] = useState(device?.name ?? '');
  const [ip, setIp] = useState(device?.ip ?? '');
  const [type, setType] = useState<DeviceType>(device?.type ?? 'switch');
  const [protocol, setProtocol] = useState<Protocol>(device?.config.protocol ?? 'SNMP v2c');
  const [protocolTouched, setProtocolTouched] = useState(!!device);
  const [profileId, setProfileId] = useState<string>(device?.config.credentialProfileId != null ? String(device.config.credentialProfileId) : '');
  const [siteId, setSiteId] = useState(device?.siteId ?? '');
  const [collectorId, setCollectorId] = useState(device?.config.collectorId ?? '');
  const [vendor, setVendor] = useState(device?.vendor ?? '');
  const [model, setModel] = useState(device?.model ?? '');
  const [os, setOs] = useState(device?.os ?? '');
  const [description, setDescription] = useState(device?.description ?? '');
  const [tags, setTags] = useState((device?.tags ?? []).join(', '));
  const [notificationGroup, setNotificationGroup] = useState(device?.config.notificationGroup ?? '');
  const [maintenance, setMaintenance] = useState(device?.config.maintenanceWindow ?? '');
  const [defaults, setDefaults] = useState(true);

  useEffect(() => {
    if (!siteId && sites.data?.length) setSiteId(sites.data[0].id);
  }, [sites.data, siteId]);

  const matchingProfiles = (profiles.data ?? []).filter((p) => p.protocol === protocol);
  const needsProfile = protocol !== 'ICMP';
  const realCollectors = (collectors.data ?? []).filter((c) => !c.isDemo);
  const defaultSensors = catalog.data?.defaultSensors[protocol] ?? [];

  async function save() {
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const common = {
      name, ip: ip.trim(), type, protocol, siteId, vendor, model, os, description, tags: tagList,
      credentialProfileId: profileId ? Number(profileId) : null,
      collectorId: collectorId || null,
      notificationGroup, maintenanceWindow: maintenance.trim() || null,
    };
    if (device) {
      await management!.updateDevice(device.id, common);
    } else {
      const created = await management!.createDevice({ ...common, createDefaultSensors: defaults });
      onCreated?.(created);
    }
  }

  return (
    <FormModal wide title={device ? `Gerät bearbeiten – ${device.name}` : 'Gerät hinzufügen'} submitLabel={device ? 'Speichern' : 'Anlegen'} onClose={onClose} onSubmit={save}>
      {device?.isDemo && <div className="notice warn">Demo-Gerät: Es wird nicht abgefragt, auch nach Änderungen nicht.</div>}
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} required autoFocus placeholder="z. B. SW-CORE-01" />
        <TextField label="IP-Adresse oder DNS-Name" value={ip} onChange={setIp} required placeholder="z. B. 10.10.0.1" />
        <SelectField label="Gerätetyp" value={type} onChange={(v) => {
          setType(v);
          if (!protocolTouched) {
            setProtocol(DEFAULT_PROTOCOL[v]);
            setProfileId('');
          }
        }} options={Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({ value: value as DeviceType, label }))} />
        <SelectField label="Standort" value={siteId} onChange={setSiteId} options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <SelectField label="Abfrage-Protokoll" value={protocol} onChange={(v) => { setProtocol(v); setProtocolTouched(true); setProfileId(''); }}
          options={PROTOCOLS.map((p) => ({ value: p, label: p }))} hint={PROTOCOL_HINT[protocol]} />
        <SelectField label="Zugangsprofil" value={profileId} onChange={setProfileId} disabled={!needsProfile}
          options={[{ value: '', label: needsProfile ? '– kein Profil –' : 'nicht nötig' }, ...matchingProfiles.map((p) => ({ value: String(p.id), label: p.name }))]}
          hint={needsProfile && matchingProfiles.length === 0 ? `Noch kein Profil für ${protocol} – unter Administration → Zugangsprofile anlegen` : undefined} />
        <SelectField label="Collector" value={collectorId} onChange={setCollectorId}
          options={[{ value: '', label: 'Zentraler Collector' }, ...realCollectors.filter((c) => c.role === 'remote').map((c) => ({ value: c.id, label: c.name }))]} />
        <TextField label="Funktion / Beschreibung" value={description} onChange={setDescription} placeholder="z. B. Core-Switch Rechenzentrum" />
        <TextField label="Hersteller" value={vendor} onChange={setVendor} />
        <TextField label="Modell" value={model} onChange={setModel} />
        <TextField label="Betriebssystem / Firmware" value={os} onChange={setOs} />
        <TextField label="Tags (durch Komma getrennt)" value={tags} onChange={setTags} placeholder="z. B. kritisch, produktion" />
        <TextField label="Benachrichtigungsgruppe" value={notificationGroup} onChange={setNotificationGroup} />
        <TextField label="Wartungsfenster (Text)" value={maintenance} onChange={setMaintenance} placeholder="z. B. Sonntag 02:00–05:00" />
      </div>
      {!device && (
        <div>
          <CheckboxField label="Standard-Sensoren anlegen" checked={defaults} onChange={setDefaults} />
          {defaults && <div className="muted small" style={{ marginTop: 4 }}>{defaultSensors.map((s) => s.name).join(' · ')}</div>}
        </div>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Sensor anlegen / bearbeiten
// ---------------------------------------------------------------------------

function compatibleTypes(catalog: Catalog, protocol: Protocol): SensorType[] {
  const method = catalog.protocolMethod[protocol];
  return (Object.keys(catalog.sensorTypes) as SensorType[]).filter((t) => {
    const m = catalog.sensorTypes[t].methods;
    return m === null || (method !== null && m.includes(method));
  });
}

type SettingsState = Record<string, string>;

function toState(settings: Record<string, unknown> | undefined): SettingsState {
  const out: SettingsState = {};
  for (const [k, v] of Object.entries(settings ?? {})) out[k] = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
  return out;
}

function fromState(type: SensorType, st: SettingsState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...st };
  if (type === 'windows-services') {
    for (const k of ['services', 'exclude']) out[k] = (st[k] ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  }
  if (type === 'http') out.verifyTls = st.verifyTls !== 'false';
  for (const k of ['count', 'timeoutSec']) if (k in st && st[k] !== '') out[k] = Number(st[k]);
  return out;
}

export function SensorDialog({ device, sensor, onClose }: { device: Device; sensor?: Sensor; onClose: () => void }) {
  const catalog = useCatalog();
  const types = catalog.data ? compatibleTypes(catalog.data, device.config.protocol) : [];
  const [type, setType] = useState<SensorType>(sensor?.type ?? 'ping');
  const spec = catalog.data?.sensorTypes[type];
  const [name, setName] = useState(sensor?.name ?? '');
  const [interval, setIntervalSec] = useState(String(sensor?.intervalSec ?? 60));
  const [settings, setSettings] = useState<SettingsState>(toState(sensor?.settings));
  const [useThresholds, setUseThresholds] = useState(sensor ? !!sensor.thresholds : true);
  const [warning, setWarning] = useState(sensor?.thresholds ? String(sensor.thresholds.warning) : '');
  const [critical, setCritical] = useState(sensor?.thresholds ? String(sensor.thresholds.critical) : '');
  const [inverted, setInverted] = useState(!!sensor?.thresholds?.inverted);

  // Beim Typwechsel (nur Neuanlage) Standardwerte übernehmen
  useEffect(() => {
    if (sensor || !spec) return;
    setName(spec.name);
    setIntervalSec(String(spec.intervalSec));
    setSettings(toState(spec.settings));
    setUseThresholds(!!spec.thresholds);
    setWarning(spec.thresholds ? String(spec.thresholds.warning) : '');
    setCritical(spec.thresholds ? String(spec.thresholds.critical) : '');
    setInverted(!!spec.thresholds?.inverted);
  }, [type, spec, sensor]);

  const set = (k: string) => (v: string) => setSettings((s) => ({ ...s, [k]: v }));
  const unit = spec?.unit ? ` (${spec.unit})` : '';

  async function save() {
    const thresholds = useThresholds
      ? { warning: Number(warning.replace(',', '.')), critical: Number(critical.replace(',', '.')), inverted }
      : null;
    if (thresholds && (Number.isNaN(thresholds.warning) || Number.isNaN(thresholds.critical))) throw new Error('Schwellwerte müssen Zahlen sein');
    const body = { name, intervalSec: Number(interval), thresholds, settings: fromState(type, settings) };
    if (sensor) await management!.updateSensor(sensor.id, body);
    else await management!.createSensor(device.id, { type, ...body });
  }

  return (
    <FormModal wide title={sensor ? `Sensor bearbeiten – ${sensor.name}` : `Sensor hinzufügen – ${device.name}`} submitLabel={sensor ? 'Speichern' : 'Anlegen'} onClose={onClose} onSubmit={save}>
      <div className="form-grid">
        <SelectField label="Sensortyp" value={type} onChange={setType} disabled={!!sensor}
          options={(sensor ? [sensor.type] : types).map((t) => ({ value: t, label: catalog.data?.sensorTypes[t].label ?? t }))}
          hint={sensor ? 'Typ kann nicht geändert werden' : `Passend zum Protokoll ${device.config.protocol}`} />
        <TextField label="Name" value={name} onChange={setName} required />
        <SelectField label="Intervall" value={interval} onChange={setIntervalSec} options={intervalOptions.some((o) => o.value === interval) ? intervalOptions : [...intervalOptions, { value: interval, label: `${interval} Sekunden` }]} />
      </div>

      {/* Typabhängige Einstellungen */}
      {(type === 'snmp-traffic' || type === 'interface-status') && (
        <TextField label="Interface" value={settings.interface ?? ''} onChange={set('interface')} required placeholder="z. B. GigabitEthernet0/0/1, XGE0/0/2 oder Indexnummer"
          hint="Name (ifName) oder Beschreibung (ifDescr) wie am Gerät; Groß-/Kleinschreibung egal" />
      )}
      {type === 'disk-usage' && (
        <TextField label={device.config.protocol === 'WMI' ? 'Laufwerk' : 'Pfad / Dateisystem'} value={settings.path ?? ''} onChange={set('path')} required
          placeholder={device.config.protocol === 'WMI' ? 'C:' : '/'} />
      )}
      {type === 'http' && (
        <>
          <TextField label="URL" value={settings.url ?? ''} onChange={set('url')} required placeholder="https://intranet.firma.local/status" />
          <div className="form-grid">
            <TextField label="Suchbegriff im Inhalt (optional)" value={settings.keyword ?? ''} onChange={set('keyword')} />
            <TextField label="Zeitlimit (Sekunden)" value={settings.timeoutSec ?? '10'} onChange={set('timeoutSec')} />
          </div>
          <CheckboxField label="TLS-Zertifikat prüfen" checked={settings.verifyTls !== 'false'} onChange={(v) => set('verifyTls')(String(v))} />
        </>
      )}
      {type === 'dns' && (
        <div className="form-grid">
          <TextField label="Aufzulösender Name" value={settings.name ?? ''} onChange={set('name')} required placeholder="z. B. dc01.firma.local" />
          <SelectField label="Eintragstyp" value={settings.recordType ?? 'A'} onChange={set('recordType')} options={(catalog.data?.dnsRecordTypes ?? ['A']).map((t) => ({ value: t, label: t }))} />
          <TextField label="DNS-Server (leer = dieses Gerät)" value={settings.server ?? ''} onChange={set('server')} placeholder={device.ip} />
        </div>
      )}
      {type === 'ping' && (
        <div className="form-grid">
          <TextField label="Pakete je Messung" value={settings.count ?? '3'} onChange={set('count')} />
          <TextField label="Zeitlimit je Paket (Sekunden)" value={settings.timeoutSec ?? '2'} onChange={set('timeoutSec')} />
        </div>
      )}
      {type === 'windows-services' && (
        <>
          <TextField label="Nur diese Dienste (Dienstnamen, durch Komma getrennt)" value={settings.services ?? ''} onChange={set('services')}
            placeholder="leer = alle automatisch startenden Dienste" hint="Dienstname wie in services.msc unter „Dienstname“, z. B. NTDS, DNS, W32Time" />
          <TextField label="Ausnahmen (Dienstnamen)" value={settings.exclude ?? ''} onChange={set('exclude')} placeholder="z. B. gupdate, MapsBroker" />
        </>
      )}

      <div>
        <CheckboxField label="Schwellwerte verwenden" checked={useThresholds} onChange={setUseThresholds} />
        {useThresholds && (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <TextField label={`Warnung ab${unit}`} value={warning} onChange={setWarning} required />
            <TextField label={`Kritisch ab${unit}`} value={critical} onChange={setCritical} required />
            <CheckboxField label="Umgekehrt: niedrige Werte sind schlecht" checked={inverted} onChange={setInverted} />
          </div>
        )}
      </div>
    </FormModal>
  );
}

/** Bestätigungsdialog für Löschen */
export function ConfirmDelete({ title, children, onConfirm, onClose }: { title: string; children: ReactNode; onConfirm: () => Promise<void>; onClose: () => void }) {
  return (
    <FormModal title={title} submitLabel="Endgültig löschen" danger onClose={onClose} onSubmit={onConfirm}>
      {children}
    </FormModal>
  );
}
