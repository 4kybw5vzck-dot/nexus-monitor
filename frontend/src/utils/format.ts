/** Formatierungen für die deutsche Oberfläche */

const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function formatNumber(value: number, digits: 0 | 1 | 2 = 1): string {
  return (digits === 0 ? nf0 : digits === 2 ? nf2 : nf1).format(value);
}

export function formatValue(value: number, unit: string): string {
  if (unit === 'Mbit/s' && value >= 1000) return `${formatNumber(value / 1000, 2)} Gbit/s`;
  if (unit === '%') return `${formatNumber(value)} %`;
  if (unit === 'ms') return `${formatNumber(value, 0)} ms`;
  if (!unit) return formatNumber(value, 2);
  return `${formatNumber(value)} ${unit}`;
}

export function formatBandwidth(mbit: number): string {
  return mbit >= 1000 ? `${formatNumber(mbit / 1000, 0)} Gbit/s` : `${formatNumber(mbit, 0)} Mbit/s`;
}

const dtf = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export function formatDateTime(iso: string): string {
  return dtf.format(new Date(iso));
}

export function formatTime(iso: string | number): string {
  return tf.format(new Date(iso));
}

/** "vor 3 Min." – relative Zeit zum Bezugszeitpunkt */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `vor ${diff} s`;
  const min = Math.round(diff / 60);
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

export function formatDuration(fromIso: string, toIso?: string, now: number = Date.now()): string {
  const end = toIso ? new Date(toIso).getTime() : now;
  const min = Math.max(0, Math.round((end - new Date(fromIso).getTime()) / 60000));
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h} Std. ${m} Min.`;
  return `${Math.floor(h / 24)} T. ${h % 24} Std.`;
}
