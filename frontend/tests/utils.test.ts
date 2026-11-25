import { describe, expect, it } from 'vitest';
import { evaluateStatus, worstStatus } from '../src/utils/status';
import { formatBandwidth, formatDuration } from '../src/utils/format';
import { matchPath } from '../src/app/router';

describe('Statuslogik', () => {
  it('bewertet Schwellwerte korrekt', () => {
    const t = { warning: 80, critical: 95 };
    expect(evaluateStatus(50, t)).toBe('ok');
    expect(evaluateStatus(80, t)).toBe('warning');
    expect(evaluateStatus(97, t)).toBe('critical');
    expect(evaluateStatus(42)).toBe('ok');
  });

  it('unterstützt invertierte Schwellwerte (niedrig = schlecht)', () => {
    const t = { warning: 0.5, critical: 0.5, inverted: true };
    expect(evaluateStatus(1, t)).toBe('ok');
    expect(evaluateStatus(0, t)).toBe('critical');
  });

  it('ermittelt den schlechtesten Status', () => {
    expect(worstStatus(['ok', 'warning', 'ok'])).toBe('warning');
    expect(worstStatus(['ok', 'critical', 'unknown'])).toBe('critical');
    expect(worstStatus(['paused', 'ok'])).toBe('ok');
    expect(worstStatus([])).toBe('unknown');
  });
});

describe('Formatierung', () => {
  it('formatiert Bandbreiten', () => {
    expect(formatBandwidth(500)).toBe('500 Mbit/s');
    expect(formatBandwidth(10000)).toBe('10 Gbit/s');
  });

  it('formatiert Dauern', () => {
    const from = '2026-01-01T10:00:00Z';
    expect(formatDuration(from, '2026-01-01T10:45:00Z')).toBe('45 Min.');
    expect(formatDuration(from, '2026-01-01T12:05:00Z')).toBe('2 Std. 5 Min.');
  });
});

describe('Router', () => {
  it('erkennt Pfade mit Parametern', () => {
    expect(matchPath('/devices/:id', '/devices/dev-1')).toEqual({ id: 'dev-1' });
    expect(matchPath('/devices/:id', '/devices')).toBeNull();
    expect(matchPath('/alerts', '/alerts')).toEqual({});
  });
});
