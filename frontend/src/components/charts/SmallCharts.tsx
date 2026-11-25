import { useState } from 'react';
import type { MetricPoint } from '../../api/types';
import { formatNumber } from '../../utils/format';
import { useElementWidth } from './useElementWidth';

/** Ringdiagramm, z. B. Sensorstatus-Verteilung */
export function DonutChart({ segments, size = 150, thickness = 18, center }: {
  segments: Array<{ label: string; value: number; color: string; onClick?: () => void }>;
  size?: number;
  thickness?: number;
  center?: { value: string; label: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
      {segments.map((s, i) => {
        if (s.value <= 0) return null;
        const len = (s.value / total) * c;
        const el = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={hover === i ? thickness + 4 : thickness}
            strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ cursor: s.onClick ? 'pointer' : 'default', transition: 'stroke-width .12s' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={s.onClick}
          >
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      {center && (
        <>
          <text x="50%" y="48%" textAnchor="middle" fill="var(--text)" fontSize={24} fontWeight={650} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hover !== null ? segments[hover].value : center.value}
          </text>
          <text x="50%" y="62%" textAnchor="middle" fill="var(--muted)" fontSize={11.5}>
            {hover !== null ? segments[hover].label : center.label}
          </text>
        </>
      )}
    </svg>
  );
}

/** Halbkreis-Tacho für Prozentwerte */
export function Gauge({ value, label, warning = 80, critical = 95, inverted = false, size = 170 }: {
  value: number;
  label: string;
  warning?: number;
  critical?: number;
  inverted?: boolean;
  size?: number;
}) {
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const v = Math.min(100, Math.max(0, value));
  const angle = Math.PI * (1 - v / 100);
  const ex = cx + r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const color = inverted
    ? v <= critical ? 'var(--critical)' : v <= warning ? 'var(--warning)' : 'var(--ok)'
    : v >= critical ? 'var(--critical)' : v >= warning ? 'var(--warning)' : 'var(--ok)';
  return (
    <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img">
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="var(--surface-3)" strokeWidth={12} strokeLinecap="round" />
      {v > 0 && <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${ex.toFixed(2)},${ey.toFixed(2)}`} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" />}
      <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--text)" fontSize={22} fontWeight={650} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatNumber(value, value >= 99 && value < 100 ? 2 : 1)} %
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="var(--muted)" fontSize={11.5}>{label}</text>
    </svg>
  );
}

/** Kleine Verlaufslinie ohne Achsen */
export function Sparkline({ points, color = 'var(--accent)', height = 28, width = 110, zeroBased = false }: {
  points: MetricPoint[];
  color?: string;
  height?: number;
  width?: number;
  /** Skala ab 0 statt ab Minimum – verhindert, dass kleines Rauschen dramatisch wirkt */
  zeroBased?: boolean;
}) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const vals = points.map((p) => p.v);
  const min = zeroBased ? 0 : Math.min(...vals);
  const max = zeroBased ? Math.max(...vals) * 1.15 : Math.max(...vals);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * width).toFixed(1)},${(height - 2 - ((p.v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/** Säulendiagramm mit Kategorien */
export function BarChart({ data, height = 200, format = (v: number) => formatNumber(v), max }: {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  format?: (v: number) => string;
  max?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const pad = { top: 18, bottom: 26, left: 8, right: 8 };
  const innerH = height - pad.top - pad.bottom;
  const top = max ?? Math.max(1, ...data.map((d) => d.value)) * 1.1;
  const slot = (width - pad.left - pad.right) / Math.max(1, data.length);
  const bw = Math.min(46, slot * 0.6);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg className="chart" width={width} height={height} role="img">
          <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} />
          {data.map((d, i) => {
            const h = (d.value / top) * innerH;
            const x = pad.left + slot * i + (slot - bw) / 2;
            return (
              <g key={d.label}>
                <rect x={x} y={pad.top + innerH - h} width={bw} height={Math.max(1, h)} rx={4} fill={d.color ?? 'var(--series-1)'}>
                  <title>{`${d.label}: ${format(d.value)}`}</title>
                </rect>
                <text className="axis-label" x={x + bw / 2} y={pad.top + innerH - h - 5} textAnchor="middle" style={{ fill: 'var(--text-2)' }}>{format(d.value)}</text>
                <text className="axis-label" x={x + bw / 2} y={height - 8} textAnchor="middle">{d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
