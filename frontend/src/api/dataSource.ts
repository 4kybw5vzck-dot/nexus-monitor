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

/**
 * Schnittstelle zwischen Oberfläche und Datenquelle.
 *
 * Die Oberfläche kennt ausschließlich dieses Interface. Heute steckt dahinter
 * die MockDataSource, später eine HttpDataSource, die das FastAPI-Backend
 * anspricht. Alle Methoden sind asynchron, damit der Wechsel ohne Umbau der
 * Seiten möglich ist.
 */
export interface MonitoringDataSource {
  readonly kind: 'mock' | 'http';

  getSummary(): Promise<StatusSummary>;

  getSites(): Promise<Site[]>;
  getSite(id: string): Promise<Site | undefined>;

  getDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device | undefined>;

  getSensors(filter?: { deviceId?: string }): Promise<Sensor[]>;
  getSensor(id: string): Promise<Sensor | undefined>;
  getSensorHistory(sensorId: string, hours: number): Promise<MetricPoint[]>;

  /** Aggregierte Zeitreihen für das Dashboard */
  getAggregateSeries(
    metric: 'traffic-in' | 'traffic-out' | 'cpu' | 'memory',
    hours: number,
  ): Promise<MetricPoint[]>;

  /** Verfügbarkeit je Gerät (Basis: Ping-Sensor) im Zeitraum */
  getAvailability(hours: number): Promise<Array<{ deviceId: string; siteId: string; availability: number }>>;

  getAlerts(): Promise<Alert[]>;
  acknowledgeAlert(id: string, user: string): Promise<Alert>;

  getEvents(limit?: number): Promise<EventLogEntry[]>;
  getDeviceEvents(deviceId: string): Promise<EventLogEntry[]>;

  getLinks(): Promise<Link[]>;
  getCollectors(): Promise<Collector[]>;
  getUsers(): Promise<User[]>;
  getNotificationRules(): Promise<NotificationRule[]>;
  getReports(): Promise<ReportDefinition[]>;

  /**
   * Netzwerk-Discovery. Derzeit rein simuliert (auch im Backend) – es findet KEIN echter Scan statt.
   */
  runDiscovery(range: string, onProgress?: (pct: number) => void): Promise<DiscoveryResult[]>;

  /** Benachrichtigt Abonnenten, wenn sich Daten ändern (z. B. Alarm bestätigt). */
  subscribe(listener: () => void): () => void;
}
