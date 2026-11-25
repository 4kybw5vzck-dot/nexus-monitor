import { useMemo, useState } from 'react';
import { dataSource, type Device, type Link as NetLink, type Site, type Status } from '../api';
import { Link, navigate, updateQuery, useLocation } from '../app/router';
import { Card, PageHeader, Segment, Skeleton, StatusBadge, StatusDot } from '../components/ui';
import { Icon, deviceIcon } from '../components/ui/Icon';
import { useData } from '../hooks/useData';
import { formatBandwidth, formatNumber } from '../utils/format';
import { DEVICE_TYPE_LABEL, STATUS_LABEL } from '../utils/status';

const NODE_W = 128;
const NODE_H = 50;
const H_GAP = 16;
const V_GAP = 60;
const PAD = 22;
const FRAME_GAP = 40;
const TOP = 86;

const STATUS_STROKE: Record<Status, string> = {
  ok: 'var(--ok)',
  warning: 'var(--warning)',
  critical: 'var(--critical)',
  unknown: 'var(--unknown)',
  paused: 'var(--paused)',
};

interface Pos { x: number; y: number }
interface Frame { site: Site; x: number; y: number; w: number; h: number }

/**
 * Berechnet ein Ebenen-Layout je Standort: Breitensuche ab den Perimeter-Geräten
 * entlang der Verbindungen. Später kann das Layout aus gespeicherten
 * Kartenpositionen (Backend) kommen; die Darstellung bleibt gleich.
 */
function computeLayout(sites: Site[], devices: Device[], links: NetLink[]) {
  const pos = new Map<string, Pos>();
  const frames: Frame[] = [];
  let offsetX = 0;
  let maxH = 0;
  for (const site of sites) {
    const devs = devices.filter((d) => d.siteId === site.id);
    const ids = new Set(devs.map((d) => d.id));
    const intra = links.filter((l) => ids.has(l.from) && ids.has(l.to));
    const hasParent = new Set(intra.map((l) => l.to));
    const roots = devs.filter((d) => !hasParent.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
    const tiers: string[][] = [];
    const seen = new Set<string>();
    let frontier = roots.map((r) => r.id);
    while (frontier.length) {
      tiers.push(frontier);
      frontier.forEach((id) => seen.add(id));
      const next: string[] = [];
      for (const id of frontier) {
        intra
          .filter((l) => l.from === id && !seen.has(l.to) && !next.includes(l.to))
          .sort((a, b) => a.to.localeCompare(b.to))
          .forEach((l) => next.push(l.to));
      }
      frontier = next;
    }
    const rest = devs.filter((d) => !seen.has(d.id)).map((d) => d.id);
    if (rest.length) tiers.push(rest);
    const widest = Math.max(...tiers.map((t) => t.length));
    const w = Math.max(250, widest * (NODE_W + H_GAP) - H_GAP + PAD * 2);
    const h = tiers.length * (NODE_H + V_GAP) - V_GAP + PAD * 2 + 18;
    tiers.forEach((tier, ti) => {
      const tierW = tier.length * (NODE_W + H_GAP) - H_GAP;
      const startX = offsetX + (w - tierW) / 2;
      tier.forEach((id, i) => pos.set(id, { x: startX + i * (NODE_W + H_GAP), y: TOP + PAD + 18 + ti * (NODE_H + V_GAP) }));
    });
    frames.push({ site, x: offsetX, y: TOP, w, h });
    offsetX += w + FRAME_GAP;
    maxH = Math.max(maxH, h);
  }
  return { pos, frames, width: Math.max(1, offsetX - FRAME_GAP), height: TOP + maxH + 10 };
}

export function NetworkMapPage() {
  const { query } = useLocation();
  const siteFilter = query.get('site') ?? 'all';
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const sites = useData(() => dataSource.getSites());
  const devices = useData(() => dataSource.getDevices());
  const links = useData(() => dataSource.getLinks());

  const visibleSites = useMemo(() => (sites.data ?? []).filter((s) => siteFilter === 'all' || s.id === siteFilter), [sites.data, siteFilter]);
  const layout = useMemo(
    () => computeLayout(visibleSites, devices.data ?? [], links.data ?? []),
    [visibleSites, devices.data, links.data],
  );
  const devById = useMemo(() => new Map((devices.data ?? []).map((d) => [d.id, d])), [devices.data]);
  const visibleLinks = (links.data ?? []).filter((l) => layout.pos.has(l.from) && layout.pos.has(l.to));
  const sel = selected ? devById.get(selected) : undefined;
  const focus = hover ?? selected;

  const ready = sites.data && devices.data && links.data;

  return (
    <>
      <PageHeader
        title="Network Maps"
        description="Topologie aller Standorte mit Verbindungsstatus – Gerät anklicken für Details, Doppelklick öffnet das Gerät"
        actions={
          <>
            <Segment
              options={[{ id: 'all', label: 'Alle Standorte' }, ...(sites.data ?? []).map((s) => ({ id: s.id, label: s.city }))]}
              value={siteFilter}
              onChange={(v) => { updateQuery({ site: v === 'all' ? null : v }); setSelected(null); }}
            />
            <div className="segment">
              <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} aria-label="Verkleinern">−</button>
              <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</button>
              <button onClick={() => setZoom((z) => Math.min(2, z + 0.2))} aria-label="Vergrößern">+</button>
            </div>
          </>
        }
      />
      <div className="grid grid-main-side" style={{ gridTemplateColumns: sel ? undefined : 'minmax(0,1fr)' }}>
        <Card
          flush
          title="Topologie"
          actions={
            <div className="legend">
              {(['ok', 'warning', 'critical', 'unknown'] as Status[]).map((s) => <span key={s}><i style={{ background: STATUS_STROKE[s] }} />{STATUS_LABEL[s]}</span>)}
              <span><i style={{ background: 'var(--muted)', height: 1, borderTop: '1px dashed var(--muted)' }} />WAN/VPN</span>
            </div>
          }
        >
          {!ready ? <div style={{ padding: 16 }}><Skeleton height={420} /></div> : (
            <div className="map-wrap" style={{ overflow: 'auto', maxHeight: '70vh' }}>
              <svg
                width={siteFilter === 'all' ? `${100 * zoom}%` : layout.width * zoom}
                viewBox={`-10 0 ${layout.width + 20} ${layout.height}`}
                style={{ display: 'block', minWidth: layout.width * 0.55 * zoom, maxWidth: siteFilter === 'all' ? undefined : '100%' }}
                onClick={() => setSelected(null)}
                role="img"
                aria-label="Netzwerkkarte"
              >
                {layout.frames.map((f) => (
                  <g key={f.site.id}>
                    <rect className="map-site-frame" x={f.x} y={f.y} width={f.w} height={f.h} rx={12} />
                    <text className="map-site-label" x={f.x + 14} y={f.y + 20}>{f.site.name} · {f.site.subnet}</text>
                  </g>
                ))}
                {visibleLinks.map((l) => {
                  const a = layout.pos.get(l.from)!;
                  const b = layout.pos.get(l.to)!;
                  const hl = focus && (l.from === focus || l.to === focus);
                  const dim = focus && !hl;
                  const color = l.status === 'ok' ? 'rgba(60,181,127,0.65)' : STATUS_STROKE[l.status];
                  const width = l.kind === 'wan' ? 2 : Math.max(1.2, Math.log10(l.bandwidth) - 1.6);
                  let d: string;
                  if (l.kind === 'wan') {
                    const ax = a.x + NODE_W / 2;
                    const bx = b.x + NODE_W / 2;
                    d = `M${ax},${a.y} C${ax},${18} ${bx},${18} ${bx},${b.y}`;
                  } else {
                    const ax = a.x + NODE_W / 2, ay = a.y + NODE_H, bx = b.x + NODE_W / 2, by = b.y;
                    const my = (ay + by) / 2;
                    d = `M${ax},${ay} C${ax},${my} ${bx},${my} ${bx},${by}`;
                  }
                  return (
                    <g key={l.id} opacity={dim ? 0.18 : 1}>
                      <path d={d} fill="none" stroke={color} strokeWidth={hl ? width + 1.2 : width} strokeDasharray={l.kind === 'wan' ? '6 5' : l.kind === 'storage' ? '2 3' : undefined}>
                        <title>{`${devById.get(l.from)?.name} ↔ ${devById.get(l.to)?.name}\n${formatBandwidth(l.bandwidth)} · Auslastung ${formatNumber(l.utilization)} % · ${STATUS_LABEL[l.status]}`}</title>
                      </path>
                    </g>
                  );
                })}
                {/* Beschriftung der WAN-Strecken */}
                {visibleLinks.filter((l) => l.kind === 'wan').map((l) => {
                  const a = layout.pos.get(l.from)!;
                  const b = layout.pos.get(l.to)!;
                  const mx = (a.x + b.x) / 2 + NODE_W / 2;
                  return (
                    <g key={`${l.id}-lbl`}>
                      <rect x={mx - 62} y={30} width={124} height={20} rx={10} fill="var(--surface-2)" stroke="var(--border-strong)" />
                      <text x={mx} y={44} textAnchor="middle" fontSize={10.5} fill={l.status === 'ok' ? 'var(--text-2)' : STATUS_STROKE[l.status]}>
                        WAN {formatBandwidth(l.bandwidth)} · {formatNumber(l.utilization, 0)} %
                      </text>
                    </g>
                  );
                })}
                {[...layout.pos.entries()].map(([id, p]) => {
                  const d = devById.get(id);
                  if (!d) return null;
                  const dim = focus && focus !== id && !visibleLinks.some((l) => (l.from === focus && l.to === id) || (l.to === focus && l.from === id));
                  return (
                    <g
                      key={id}
                      className="map-node"
                      transform={`translate(${p.x},${p.y})`}
                      opacity={dim ? 0.35 : 1}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(null)}
                      onClick={(e) => { e.stopPropagation(); setSelected(id); }}
                      onDoubleClick={() => navigate(`/devices/${id}`)}
                    >
                      <rect width={NODE_W} height={NODE_H} rx={8} strokeWidth={selected === id ? 2 : 1} style={selected === id ? { stroke: 'var(--accent)' } : undefined} />
                      <rect width={4} height={NODE_H - 12} x={0} y={6} rx={2} fill={STATUS_STROKE[d.status]} />
                      <g transform="translate(12,15)" style={{ color: 'var(--text-2)' }}><Icon name={deviceIcon(d.type)} size={20} /></g>
                      <text x={40} y={22}>{d.name}</text>
                      <text x={40} y={37} className="sub">{d.ip}</text>
                      {(d.status === 'critical' || d.status === 'warning') && (
                        <circle cx={NODE_W - 10} cy={10} r={4.5} fill={STATUS_STROKE[d.status]} />
                      )}
                      <title>{`${d.name} – ${DEVICE_TYPE_LABEL[d.type]} – ${STATUS_LABEL[d.status]}`}</title>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </Card>
        {sel && (
          <Card title={<span className="hstack">{sel.name} <StatusBadge status={sel.status} /></span>} sub={sel.description} actions={<button className="btn ghost small" onClick={() => setSelected(null)}>✕</button>}>
            <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>Typ</dt><dd>{DEVICE_TYPE_LABEL[sel.type]}</dd>
              <dt>IP-Adresse</dt><dd className="mono">{sel.ip}</dd>
              <dt>Hersteller</dt><dd>{sel.vendor} {sel.model}</dd>
              <dt>Sensoren</dt><dd>{sel.sensorCount}</dd>
            </dl>
            <h4 style={{ margin: '16px 0 8px', fontSize: 12.5, color: 'var(--muted)' }}>VERBINDUNGEN</h4>
            <div className="vstack" style={{ gap: 6 }}>
              {visibleLinks.filter((l) => l.from === sel.id || l.to === sel.id).map((l) => {
                const other = devById.get(l.from === sel.id ? l.to : l.from)!;
                return (
                  <div key={l.id} className="between small">
                    <span className="hstack"><StatusDot status={l.status} /><a href={`#/devices/${other.id}`} onClick={(e) => { e.preventDefault(); setSelected(other.id); }}>{other.name}</a></span>
                    <span className="muted tabular">{formatBandwidth(l.bandwidth)} · {formatNumber(l.utilization, 0)} %</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to={`/devices/${sel.id}`} className="btn primary small" style={{ textDecoration: 'none' }}>Gerät öffnen <Icon name="chevronRight" size={14} /></Link>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
