import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dataSource } from '../../api';
import { appConfig } from '../../app/config';
import { Link, navigate, useLocation } from '../../app/router';
import { useData } from '../../hooks/useData';
import { formatTime } from '../../utils/format';
import { CURRENT_USER, CURRENT_USER_INITIALS } from '../../app/session';
import { DEVICE_TYPE_LABEL } from '../../utils/status';
import { Icon, deviceIcon, type IconName } from '../ui/Icon';
import { StatusDot } from '../ui';

export const NAV_ITEMS: Array<{ to: string; label: string; icon: IconName; section?: string }> = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Überwachung' },
  { to: '/devices', label: 'Devices', icon: 'devices' },
  { to: '/sensors', label: 'Sensors', icon: 'sensors' },
  { to: '/maps', label: 'Network Maps', icon: 'map' },
  { to: '/sites', label: 'Sites', icon: 'sites' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/reports', label: 'Reports', icon: 'reports', section: 'Auswertung & Betrieb' },
  { to: '/discovery', label: 'Discovery', icon: 'discovery' },
  { to: '/collectors', label: 'Collectors', icon: 'collectors' },
  { to: '/admin', label: 'Administration', icon: 'admin' },
];

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { path } = useLocation();
  const { data: alerts } = useData(() => dataSource.getAlerts());
  const open = alerts?.filter((a) => a.state === 'active').length ?? 0;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 32 32"><path d="M8 25V7l16 18V7" stroke="#46c28e" strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div>
          <div className="brand-name">NEXUS</div>
          <div className="brand-sub">MONITOR</div>
        </div>
      </div>
      <nav className="nav" aria-label="Hauptnavigation">
        {NAV_ITEMS.map((item) => {
          const active = path === item.to || path.startsWith(`${item.to}/`) || (item.to === '/dashboard' && path === '/');
          return (
            <div key={item.to} style={{ display: 'contents' }}>
              {item.section && <div className="nav-section">{item.section}</div>}
              <Link to={item.to} className={active ? 'active' : ''} onClick={onNavigate}>
                <Icon name={item.icon} />
                {item.label}
                {item.to === '/alerts' && open > 0 && <span className="nav-badge">{open}</span>}
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        {appConfig.instanceName} · v{appConfig.version}
        <br />
        Datenquelle: {dataSource.kind === 'mock' ? 'Mock-Daten' : 'Backend'}
      </div>
    </aside>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const { data: devices } = useData(() => dataSource.getDevices());
  const { data: sensors } = useData(() => dataSource.getSensors());

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2 || !devices || !sensors) return [];
    const devName = new Map(devices.map((d) => [d.id, d.name]));
    const devHits = devices
      .filter((d) => [d.name, d.ip, d.vendor, d.model, d.description].some((v) => v.toLowerCase().includes(term)))
      .slice(0, 6)
      .map((d) => ({ key: d.id, to: `/devices/${d.id}`, icon: deviceIcon(d.type), title: d.name, meta: `${d.ip} · ${DEVICE_TYPE_LABEL[d.type]}`, status: d.status }));
    const senHits = sensors
      .filter((s) => `${s.name} ${devName.get(s.deviceId)}`.toLowerCase().includes(term))
      .slice(0, 6)
      .map((s) => ({ key: s.id, to: `/devices/${s.deviceId}?tab=sensors&sensor=${s.id}`, icon: 'sensors' as IconName, title: s.name, meta: devName.get(s.deviceId) ?? '', status: s.status }));
    return [...devHits, ...senHits];
  }, [q, devices, sensors]);

  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="topbar-search" ref={box}>
      <Icon name="search" size={16} />
      <input
        className="input"
        placeholder="Geräte, IP-Adressen oder Sensoren suchen …"
        value={q}
        aria-label="Globale Suche"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setFocus(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(results.length - 1, f + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
          if (e.key === 'Enter' && results[focus]) go(results[focus].to);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="search-results">
          {results.length === 0 && <div className="empty" style={{ padding: 14 }}>Keine Treffer für „{q}“</div>}
          {results.map((r, i) => (
            <a key={r.key} href={`#${r.to}`} className={i === focus ? 'focus' : ''} onClick={(e) => { e.preventDefault(); go(r.to); }}>
              <StatusDot status={r.status} />
              <Icon name={r.icon} size={16} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{r.title}</b> <span className="muted small">{r.meta}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const [stamp, setStamp] = useState(dataSource.dataTimestamp ?? Date.now());
  useEffect(() => dataSource.subscribe(() => setStamp(dataSource.dataTimestamp ?? Date.now())), []);
  return (
    <header className="topbar">
      <button className="btn ghost menu-btn" onClick={onMenu} aria-label="Navigation öffnen"><Icon name="menu" /></button>
      <GlobalSearch />
      <div className="topbar-right">
        {dataSource.kind === 'mock' && <span className="mock-chip" title="Phase 1: Alle Daten sind fiktive Beispieldaten">DEMO · MOCK-DATEN</span>}
        <span className="muted small tabular" title="Zeitpunkt des Datenstands">Stand {formatTime(stamp)}</span>
        <button className="btn small" onClick={() => dataSource.refresh?.()} title="Daten aktualisieren">
          <Icon name="refresh" size={15} /> Aktualisieren
        </button>
        <div className="user-chip"><span className="avatar">{CURRENT_USER_INITIALS}</span><span className="name">{CURRENT_USER}</span></div>
      </div>
    </header>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { path } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
