/** Wiederverwendbare UI-Bausteine */
import type { ReactNode } from 'react';
import type { AlertSeverity, Status } from '../../api/types';
import { SEVERITY_LABEL, STATUS_LABEL } from '../../utils/status';
import { Link } from '../../app/router';

export function Card({ title, sub, actions, children, flush, className = '' }: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="page-header">
      <div>
        {breadcrumb && (
          <div className="breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={i} className="hstack" style={{ gap: 6 }}>
                {b.to ? <Link to={b.to}>{b.label}</Link> : <span>{b.label}</span>}
                {i < breadcrumb.length - 1 && <span>/</span>}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge s-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cls = severity === 'info' ? 's-info' : `s-${severity}`;
  return <span className={`badge ${cls}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function StatusDot({ status, pulse }: { status: Status | 'info'; pulse?: boolean }) {
  return <span className={`dot s-${status}${pulse ? ' pulse' : ''}`} />;
}

export function KpiTile({ label, value, foot, color, to }: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  color?: string;
  to?: string;
}) {
  const content = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </>
  );
  const style = { ['--kpi-color' as string]: color };
  return to ? (
    <Link to={to} className="card kpi" style={style}>{content}</Link>
  ) : (
    <div className="card kpi" style={style}>{content}</div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segment<T extends string>({ options, value, onChange }: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function UsageBar({ value, status }: { value: number; status?: Status }) {
  return (
    <div className={`bar-track s-${status ?? 'info'}`}>
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error }: { error: Error }) {
  return <div className="notice warn">Fehler beim Laden: {error.message}</div>;
}
