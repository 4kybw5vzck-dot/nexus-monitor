import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, HttpDataSource } from '../src/api/httpDataSource';
import { getSession, setSession } from '../src/app/session';

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

const session = {
  token: 'tok-123',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'u1', name: 'Test Operator', login: 'op', role: 'Operator' as const, email: '', lastLogin: '', active: true },
};

describe('HttpDataSource', () => {
  beforeEach(() => setSession(session));
  afterEach(() => {
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('ruft die Endpunkte aus docs/ARCHITEKTUR.md mit Bearer-Token auf', async () => {
    const calls = mockFetch(() => ({ status: 200, body: [] }));
    const ds = new HttpDataSource('/api/');
    await ds.getSensors({ deviceId: 'dev a' });
    await ds.getSensorHistory('sen-1', 168);
    await ds.getAggregateSeries('traffic-in', 24);
    await ds.getAvailability(720);
    await ds.getEvents(12);
    await ds.getDeviceEvents('dev-1');
    expect(calls.map((c) => c.url)).toEqual([
      '/api/sensors?device_id=dev%20a',
      '/api/sensors/sen-1/history?hours=168',
      '/api/metrics/aggregate?metric=traffic-in&hours=24',
      '/api/availability?hours=720',
      '/api/events?limit=12',
      '/api/devices/dev-1/events',
    ]);
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok-123');
  });

  it('liefert undefined bei 404 für Einzelobjekte', async () => {
    mockFetch(() => ({ status: 404, body: { detail: 'Gerät nicht gefunden' } }));
    const ds = new HttpDataSource('/api');
    await expect(ds.getDevice('x')).resolves.toBeUndefined();
    await expect(ds.getDevices()).rejects.toThrow('Gerät nicht gefunden');
  });

  it('beendet die Sitzung bei 401', async () => {
    mockFetch(() => ({ status: 401, body: { detail: 'Nicht angemeldet oder Sitzung abgelaufen' } }));
    const ds = new HttpDataSource('/api');
    await expect(ds.getSummary()).rejects.toBeInstanceOf(ApiError);
    expect(getSession()).toBeNull();
  });

  it('meldet ein nicht erreichbares Backend verständlich', async () => {
    mockFetch(() => ({ status: 502 }));
    const ds = new HttpDataSource('/api');
    await expect(ds.getSites()).rejects.toThrow('Backend nicht erreichbar');
  });

  it('bestätigt Alarme per POST und benachrichtigt Abonnenten', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { id: 'a1', state: 'acknowledged' } }));
    const ds = new HttpDataSource('/api');
    const listener = vi.fn();
    ds.subscribe(listener);
    const alert = await ds.acknowledgeAlert('a1', 'egal');
    expect(alert.state).toBe('acknowledged');
    expect(calls[0].url).toBe('/api/alerts/a1/acknowledge');
    expect(calls[0].init.method).toBe('POST');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('meldet an und speichert die Sitzung', async () => {
    setSession(null);
    const calls = mockFetch(() => ({ status: 200, body: session }));
    const ds = new HttpDataSource('/api');
    await ds.login('op', 'geheim');
    expect(getSession()?.token).toBe('tok-123');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ login: 'op', password: 'geheim' });
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBeNull();
  });

  it('meldet ab und verwirft die Sitzung auch bei Fehlern', async () => {
    mockFetch(() => ({ status: 500 }));
    const ds = new HttpDataSource('/api');
    await expect(ds.logout()).rejects.toThrow();
    expect(getSession()).toBeNull();
  });

  it('Discovery meldet Fortschritt bis 100 %', async () => {
    mockFetch(() => ({ status: 200, body: [] }));
    const ds = new HttpDataSource('/api');
    const progress: number[] = [];
    await ds.runDiscovery('192.0.2.0/24', (p) => progress.push(p));
    expect(progress.at(-1)).toBe(100);
  });
});
