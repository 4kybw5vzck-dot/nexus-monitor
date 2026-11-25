import { useEffect, useState } from 'react';
import { dataSource, type DiscoveryResult } from '../api';
import { Card, PageHeader } from '../components/ui';
import { Icon, deviceIcon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { DEVICE_TYPE_LABEL } from '../utils/status';

const PROTOCOLS = ['ICMP (Ping)', 'SNMP v3', 'SNMP v2c', 'WMI', 'SSH', 'HTTP/HTTPS'];

export function DiscoveryPage() {
  const sites = useData(() => dataSource.getSites());
  const [siteId, setSiteId] = useState('');
  const [range, setRange] = useState('');
  const [protocols, setProtocols] = useState<string[]>(['ICMP (Ping)', 'SNMP v3', 'WMI', 'SSH']);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<DiscoveryResult[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (sites.data && !siteId) {
      setSiteId(sites.data[0].id);
      setRange(sites.data[0].subnet);
    }
  }, [sites.data, siteId]);

  const valid = /^(\d{1,3}\.){3}\d{1,3}\/(2[4-9]|3[0-2])$/.test(range.trim());

  const start = async () => {
    setResults(null);
    setPicked(new Set());
    setProgress(0);
    const r = await dataSource.runDiscovery(range.trim(), setProgress);
    setResults(r);
    setProgress(null);
  };

  const fresh = results?.filter((r) => !r.alreadyMonitored && !added.has(r.ip)) ?? [];

  return (
    <>
      <PageHeader title="Discovery" description="Netzwerkbereiche nach neuen Geräten durchsuchen" />
      <div className="notice warn">
        <Icon name="info" size={18} />
        <div><b>Simulation (Phase 1):</b> Es findet kein echter Netzwerkscan statt. Die Ergebnisse werden aus Beispieldaten erzeugt. Echte Scans übernimmt später der Remote-Collector des jeweiligen Standorts.</div>
      </div>
      <Card title="Scan konfigurieren">
        <div className="grid grid-3">
          <div className="field">
            <label htmlFor="d-site">Standort / Collector</label>
            <select id="d-site" className="select" value={siteId} onChange={(e) => {
              const s = sites.data?.find((x) => x.id === e.target.value);
              setSiteId(e.target.value);
              if (s) setRange(s.subnet);
            }}>
              {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-range">IP-Bereich (CIDR, /24 bis /32)</label>
            <input id="d-range" className="input mono" value={range} onChange={(e) => setRange(e.target.value)} placeholder="192.0.2.0/24" aria-invalid={!valid} />
            {!valid && range && <span className="small text-critical">Bitte gültigen Bereich angeben, z. B. 192.0.2.0/24</span>}
          </div>
          <div className="field">
            <label htmlFor="d-cred">Zugangsprofil</label>
            <select id="d-cred" className="select" defaultValue="SNMP-Netzwerk">
              <option>SNMP-Netzwerk</option>
              <option>Windows-Dienstkonto</option>
              <option>Linux-Monitoring</option>
            </select>
          </div>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Protokolle</label>
          <div className="hstack" style={{ flexWrap: 'wrap', gap: 14 }}>
            {PROTOCOLS.map((p) => (
              <label key={p} className="hstack" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={protocols.includes(p)} onChange={() => setProtocols((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))} />
                {p}
              </label>
            ))}
          </div>
        </div>
        <div className="hstack" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={!valid || progress !== null || protocols.length === 0} onClick={start}>
            <Icon name="play" size={14} /> Scan starten
          </button>
          {progress !== null && (
            <div style={{ flex: 1, maxWidth: 360 }}>
              <div className="between small muted" style={{ marginBottom: 4 }}><span>Durchsuche {range} …</span><span>{progress} %</span></div>
              <div className="progress"><div style={{ width: `${progress}%` }} /></div>
            </div>
          )}
        </div>
      </Card>

      {results && (
        <Card
          title="Ergebnisse"
          sub={`${results.length} Systeme gefunden · ${results.filter((r) => !r.alreadyMonitored).length} neu`}
          actions={
            <button className="btn primary small" disabled={picked.size === 0} onClick={() => { setAdded((a) => new Set([...a, ...picked])); setPicked(new Set()); }}>
              <Icon name="plus" size={14} /> {picked.size || ''} zur Überwachung hinzufügen
            </button>
          }
          flush
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" aria-label="Alle neuen auswählen" checked={fresh.length > 0 && picked.size === fresh.length} onChange={() => setPicked(picked.size === fresh.length ? new Set() : new Set(fresh.map((r) => r.ip)))} />
                  </th>
                  <th>IP-Adresse</th><th>Hostname</th><th>Hersteller (vermutet)</th><th>Typ (vermutet)</th><th>Dienste</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const isNew = !r.alreadyMonitored && !added.has(r.ip);
                  return (
                    <tr key={r.ip}>
                      <td>{isNew && <input type="checkbox" aria-label={`${r.ip} auswählen`} checked={picked.has(r.ip)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.ip)) n.delete(r.ip); else n.add(r.ip); return n; })} />}</td>
                      <td className="mono">{r.ip}</td>
                      <td>{r.hostname}</td>
                      <td>{r.vendorGuess}</td>
                      <td className="hstack"><Icon name={deviceIcon(r.typeGuess)} size={15} />{DEVICE_TYPE_LABEL[r.typeGuess]}</td>
                      <td>{r.openServices.map((s) => <span className="tag" key={s}>{s}</span>)}</td>
                      <td>
                        {r.alreadyMonitored ? <span className="muted">Bereits überwacht</span>
                          : added.has(r.ip) ? <span className="text-ok">Hinzugefügt (Demo)</span>
                            : <span className="badge s-info">Neu</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {added.size > 0 && <div className="table-foot">Hinweis: In Phase 1 werden hinzugefügte Geräte nicht dauerhaft gespeichert.</div>}
        </Card>
      )}
    </>
  );
}
