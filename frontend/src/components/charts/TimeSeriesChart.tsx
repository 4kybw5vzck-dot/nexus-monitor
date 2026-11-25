import { useMemo, useRef, useState, type MouseEvent } from 'react';
import type { MetricPoint } from '../../api/types';
import { formatTime } from '../../utils/format';
import { useElementWidth } from './useElementWidth';

export interface Series {
  name: string;
  color: string;
  points: MetricPoint[];
}

interface Props {
  series: Series[];
  height?: number;
  area?: boolean;
  /** Formatierung der Y-Werte (Achse und Tooltip) */
  format?: (v: number) => string;
  yMax?: number;
  thresholds?: Array<{ value: number; color: string; label: string }>;
  showLegend?: boolean;
}

const PAD = { top: 10, right: 12, bottom: 24, left: 52 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => f <= c) ?? 10;
  return nice * exp;
}

/** Linien-/Flächendiagramm für Zeitreihen mit Fadenkreuz-Tooltip (reines SVG). */
export function TimeSeriesChart({ series, height = 220, area = false, format = (v) => v.toFixed(1), yMax, thresholds = [], showLegend = true }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const base = series[0]?.points ?? [];
  const n = base.length;
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const max = useMemo(() => {
    if (yMax !== undefined) return yMax;
    const all = series.flatMap((s) => s.points.map((p) => p.v));
    return niceMax(Math.max(1e-6, ...all) * 1.1);
  }, [series, yMax]);

  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(v, max) / max) * innerH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const xTickEvery = Math.max(1, Math.round(n / Math.max(2, Math.floor(innerW / 90))));

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = e.clientX - rect.left - PAD.left;
    const i = Math.round((px / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {showLegend && series.length > 1 && (
        <div className="legend" style={{ marginBottom: 6 }}>
          {series.map((s) => (
            <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg ref={svgRef} className="chart" width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text className="axis-label" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {base.map((p, i) =>
            i % xTickEvery === 0 && i !== 0 ? (
              <text key={p.t} className="axis-label" x={x(i)} y={height - 6} textAnchor="middle">{formatTime(p.t)}</text>
            ) : null,
          )}
          {thresholds.map((t) => (
            t.value <= max && (
              <g key={t.label}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t.value)} y2={y(t.value)} stroke={t.color} strokeDasharray="5 4" strokeWidth={1} opacity={0.7} />
                <text x={PAD.left + innerW - 4} y={y(t.value) - 4} textAnchor="end" fontSize={10.5} fill={t.color}>{t.label}</text>
              </g>
            )
          ))}
          {series.map((s, si) => {
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
            const gid = `g-${si}-${s.name.replace(/\W/g, '')}`;
            return (
              <g key={s.name}>
                {area && (
                  <>
                    <defs>
                      <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <path d={`${d} L${x(s.points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />
                  </>
                )}
                <path d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" />
              </g>
            );
          })}
          {hover !== null && base[hover] && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" />
              {series.map((s) => s.points[hover] && (
                <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].v)} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && base[hover] && (
        <div className="chart-tooltip" style={{ left: Math.min(x(hover) + 12, width - 170), top: 18 + (showLegend && series.length > 1 ? 22 : 0) }}>
          <div className="muted" style={{ marginBottom: 3 }}>{new Date(base[hover].t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
          {series.map((s) => s.points[hover] && (
            <div className="row" key={s.name}><span className="sw" style={{ background: s.color }} />{s.name}: <b>{format(s.points[hover].v)}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}
