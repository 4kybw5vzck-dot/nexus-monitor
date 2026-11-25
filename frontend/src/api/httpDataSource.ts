import type { MonitoringDataSource } from './dataSource';
import type {
  Alert,
  Collector,
  Device,
  DiscoveryResult,
  EventLogEntry,
  Link,
  MetricPoint,
  NotificationRule,
  ReportDefinition,
  Sensor,
  Site,
  StatusSummary,
  User,
} from './types';
import { getSession, setSession, type Session } from '../app/session';

/** Fehler der API mit HTTP-Status und lesbarer Meldung (Feld "detail" von FastAPI). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readError(res: Response): Promise<string> {
  // 502/503/504 kommen vom nginx-Proxy, wenn das Backend nicht läuft
  if (res.status >= 502 && res.status <= 504) return 'Backend nicht erreichbar';
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return 'Ungültige Eingabe';
  } catch {
    /* kein JSON */
  }
  return `Serverfehler (${res.status})`;
}

/**
 * Datenquelle für Phase 2: spricht das FastAPI-Backend an (docs/ARCHITEKTUR.md).
 * Die Seiten bleiben unverändert – sie kennen nur MonitoringDataSource.
 */
export class HttpDataSource implements MonitoringDataSource {
  readonly kind = 'http' as const;
  private listeners = new Set<() => void>();
  private stamp = Date.now();

  constructor(private readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ---------- Transport ----------

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = getSession();
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, 'Backend nicht erreichbar');
    }
    if (res.status === 401 && session) {
      // Sitzung abgelaufen oder widerrufen -> zurück zur Anmeldung
      setSession(null);
    }
    if (!res.ok) throw new ApiError(res.status, await readError(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private get<T>(path: string) {
    return this.request<T>(path);
  }

  private async getOptional<T>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return undefined;
      throw e;
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Aktualisieren-Knopf: alle Ansichten laden neu. */
  refresh() {
    this.stamp = Date.now();
    this.emit();
  }

  get dataTimestamp() {
    return this.stamp;
  }

  // ---------- Anmeldung ----------

  async login(login: string, password: string): Promise<Session> {
    const session = await this.request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    setSession(session);
    this.refresh();
    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
    }
  }

  // ---------- MonitoringDataSource ----------

  getSummary() {
    return this.get<StatusSummary>('/summary');
  }

  getSites() {
    return this.get<Site[]>('/sites');
  }
  getSite(id: string) {
    return this.getOptional<Site>(`/sites/${encodeURIComponent(id)}`);
  }

  getDevices() {
    return this.get<Device[]>('/devices');
  }
  getDevice(id: string) {
    return this.getOptional<Device>(`/devices/${encodeURIComponent(id)}`);
  }

  getSensors(filter?: { deviceId?: string }) {
    const q = filter?.deviceId ? `?device_id=${encodeURIComponent(filter.deviceId)}` : '';
    return this.get<Sensor[]>(`/sensors${q}`);
  }
  getSensor(id: string) {
    return this.getOptional<Sensor>(`/sensors/${encodeURIComponent(id)}`);
  }
  getSensorHistory(sensorId: string, hours: number) {
    return this.get<MetricPoint[]>(`/sensors/${encodeURIComponent(sensorId)}/history?hours=${hours}`);
  }

  getAggregateSeries(metric: 'traffic-in' | 'traffic-out' | 'cpu' | 'memory', hours: number) {
    return this.get<MetricPoint[]>(`/metrics/aggregate?metric=${metric}&hours=${hours}`);
  }

  getAvailability(hours: number) {
    return this.get<Array<{ deviceId: string; siteId: string; availability: number }>>(`/availability?hours=${hours}`);
  }

  getAlerts() {
    return this.get<Alert[]>('/alerts');
  }

  /** Der bestätigende Benutzer ergibt sich serverseitig aus der Anmeldung. */
  async acknowledgeAlert(id: string, _user: string): Promise<Alert> {
    const alert = await this.request<Alert>(`/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
    this.emit();
    return alert;
  }

  getEvents(limit = 50) {
    return this.get<EventLogEntry[]>(`/events?limit=${limit}`);
  }
  getDeviceEvents(deviceId: string) {
    return this.get<EventLogEntry[]>(`/devices/${encodeURIComponent(deviceId)}/events`);
  }

  getLinks() {
    return this.get<Link[]>('/links');
  }
  getCollectors() {
    return this.get<Collector[]>('/collectors');
  }
  getUsers() {
    return this.get<User[]>('/users');
  }
  getNotificationRules() {
    return this.get<NotificationRule[]>('/notification-rules');
  }
  getReports() {
    return this.get<ReportDefinition[]>('/reports');
  }

  /** Discovery läuft im Backend (in Phase 2 simuliert). Fortschritt wird bis zur Antwort angenähert. */
  async runDiscovery(range: string, onProgress?: (pct: number) => void): Promise<DiscoveryResult[]> {
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(90, pct + 10);
      onProgress?.(pct);
    }, 150);
    try {
      const result = await this.request<DiscoveryResult[]>('/discovery', {
        method: 'POST',
        body: JSON.stringify({ range }),
      });
      onProgress?.(100);
      return result;
    } finally {
      clearInterval(timer);
    }
  }
}
