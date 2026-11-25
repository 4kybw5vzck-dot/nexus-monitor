import type { MonitoringDataSource } from './dataSource';
import { MockDataSource } from './mockDataSource';
import { HttpDataSource } from './httpDataSource';
import { appConfig } from '../app/config';

/**
 * Zentrale Auswahl der Datenquelle (Laufzeit-Konfiguration NEXUS_DATA_SOURCE):
 *   mock – Beispieldaten im Browser, keine Anmeldung
 *   http – FastAPI-Backend unter appConfig.apiBaseUrl, mit Anmeldung
 * Die Seiten bleiben in beiden Fällen unverändert.
 */
type AppDataSource = MonitoringDataSource & { refresh?: () => void; dataTimestamp?: number };

function createDataSource(): AppDataSource {
  return appConfig.dataSource === 'http' ? new HttpDataSource(appConfig.apiBaseUrl) : new MockDataSource();
}

export const dataSource = createDataSource();

/** HTTP-Datenquelle (für Anmeldung/Abmeldung) – im Mock-Modus undefined. */
export const httpDataSource = dataSource instanceof HttpDataSource ? dataSource : undefined;

export type { MonitoringDataSource } from './dataSource';
export { ApiError } from './httpDataSource';
export * from './types';
