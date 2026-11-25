/** Fachliche Bausteine, die mehrere Seiten nutzen */
import { useState } from 'react';
import { dataSource, type Alert, type Device, type EventLogEntry, type Sensor } from '../api';
import { Link } from '../app/router';
import { formatDuration, formatRelative, formatValue } from '../utils/format';
import { canOperate, currentUser, useSession } from '../app/session';
import { SeverityBadge, StatusDot } from './ui';
import { Icon } from './ui/Icon';

export function sensorValueText(s: Sensor): string {
  if (s.status === 'unknown') return '—';
  return s.displayValue ?? formatValue(s.value, s.unit);
}

export function AckButton({ alert }: { alert: Alert }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useSession();
  const user = currentUser(dataSource.kind === 'mock');
  if (alert.state !== 'active' || !canOperate(user)) return null;
  return (
    <button
      className="btn small"
      disabled={busy}
      title={error}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        setError(undefined);
        try {
          await dataSource.acknowledgeAlert(alert.id, user!.login);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Bestätigen fehlgeschlagen');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="check" size={14} /> {error ? 'Erneut versuchen' : 'Bestätigen'}
    </button>
  );
}

export function AlertList({ alerts, devices, sensors, limit }: {
  alerts: Alert[];
  devices: Device[];
  sensors: Sensor[];
  limit?: number;
}) {
  const devName = new Map(devices.map((d) => [d.id, d.name]));
  const senName = new Map(sensors.map((s) => [s.id, s.name]));
  const list = limit ? alerts.slice(0, limit) : alerts;
  if (!list.length) return <div className="empty">Keine offenen Alarme 🎉</div>;
  return (
    <div className="list">
      {list.map((a) => (
        <div className="list-item" key={a.id}>
          <StatusDot status={a.severity === 'info' ? 'info' : a.severity} pulse={a.state === 'active' && a.severity === 'critical'} />
          <div className="grow">
            <div className="title">
              <Link to={`/devices/${a.deviceId}?tab=sensors&sensor=${a.sensorId}`}>{devName.get(a.deviceId)}</Link>
              <span className="muted"> · {senName.get(a.sensorId)}</span>
            </div>
            <div className="meta">{a.description}</div>
            <div className="meta">
              seit {formatDuration(a.raisedAt)}
              {a.state === 'acknowledged' && <> · bestätigt von <b>{a.acknowledgedBy}</b></>}
            </div>
          </div>
          <div className="vstack" style={{ alignItems: 'flex-end', gap: 6 }}>
            <SeverityBadge severity={a.severity} />
            <AckButton alert={a} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventList({ events, devices }: { events: EventLogEntry[]; devices?: Device[] }) {
  const devName = new Map((devices ?? []).map((d) => [d.id, d.name]));
  if (!events.length) return <div className="empty">Keine Ereignisse.</div>;
  return (
    <div className="list">
      {events.map((e) => (
        <div className="list-item" key={e.id}>
          <StatusDot status={e.level === 'info' ? 'info' : e.level} />
          <div className="grow">
            <div>{e.message}</div>
            <div className="meta">
              {formatRelative(e.at)} · {new Date(e.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {e.deviceId && devName.size > 0 && (
                <> · <Link to={`/devices/${e.deviceId}`}>{devName.get(e.deviceId)}</Link></>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
