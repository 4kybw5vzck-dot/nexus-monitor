import { useState } from 'react';
import { dataSource, type Sensor } from '../api';
import { TimeSeriesChart } from './charts/TimeSeriesChart';
import { Card, Segment, Skeleton, StatusBadge } from './ui';
import { useData } from '../hooks/useData';
import { formatDateTime, formatRelative, formatValue } from '../utils/format';
import { SENSOR_TYPE_LABEL } from '../utils/status';
import { sensorValueText } from './shared';

type Range = '24' | '168' | '720';

/** Detailansicht eines Sensors mit Verlauf und Schwellwerten */
export function SensorDetail({ sensor, deviceName, onClose }: { sensor: Sensor; deviceName?: string; onClose?: () => void }) {
  const [range, setRange] = useState<Range>('24');
  const history = useData(() => dataSource.getSensorHistory(sensor.id, Number(range)), [sensor.id, range]);
  const t = sensor.thresholds;
  const isBinary = sensor.type === 'interface-status';
  const fmt = (v: number) => (isBinary ? (v >= 0.5 ? 'Up' : 'Down') : formatValue(v, sensor.unit));
  const vals = history.data?.map((p) => p.v) ?? [];
  const stats = vals.length
    ? { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length }
    : undefined;

  return (
    <Card
      title={<span className="hstack">{deviceName ? `${deviceName} · ` : ''}{sensor.name} <StatusBadge status={sensor.status} /></span>}
      sub={`${SENSOR_TYPE_LABEL[sensor.type]} · Intervall ${sensor.intervalSec} s`}
      actions={
        <div className="hstack">
          <Segment options={[{ id: '24', label: '24 Std.' }, { id: '168', label: '7 Tage' }, { id: '720', label: '30 Tage' }]} value={range} onChange={setRange} />
          {onClose && <button className="btn ghost small" onClick={onClose} aria-label="Schließen">✕</button>}
        </div>
      }
    >
      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <div><div className="muted small">Aktueller Wert</div><div style={{ fontSize: 20, fontWeight: 650 }} className={`tabular text-${sensor.status}`}>{sensorValueText(sensor)}</div></div>
        <div><div className="muted small">Minimum / Maximum</div><div className="tabular">{stats ? `${fmt(stats.min)} / ${fmt(stats.max)}` : '–'}</div></div>
        <div><div className="muted small">Durchschnitt</div><div className="tabular">{stats && !isBinary ? fmt(stats.avg) : '–'}</div></div>
        <div><div className="muted small">Letzte Messung</div><div title={formatDateTime(sensor.lastCheck)}>{formatRelative(sensor.lastCheck)}</div></div>
      </div>
      <div className="small" style={{ marginBottom: 10, color: 'var(--text-2)' }}>Meldung: {sensor.message}</div>
      {history.data ? (
        <TimeSeriesChart
          area
          height={230}
          format={fmt}
          yMax={sensor.unit === '%' ? 100 : isBinary ? 1.2 : undefined}
          series={[{ name: sensor.name, color: 'var(--series-1)', points: history.data }]}
          thresholds={t && !isBinary ? [
            { value: t.warning, color: 'var(--warning)', label: `Warnung ${fmt(t.warning)}` },
            { value: t.critical, color: 'var(--critical)', label: `Kritisch ${fmt(t.critical)}` },
          ] : []}
        />
      ) : <Skeleton height={230} />}
      {t && !isBinary && (
        <div className="muted small" style={{ marginTop: 8 }}>
          Schwellwerte: Warnung ab {fmt(t.warning)}, kritisch ab {fmt(t.critical)}
        </div>
      )}
    </Card>
  );
}
