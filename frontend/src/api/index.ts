import type { MonitoringDataSource } from './dataSource';
import { MockDataSource } from './mockDataSource';
import { appConfig } from '../app/config';

/**
 * Zentrale Auswahl der Datenquelle.
 *
 * Phase 1: ausschließlich Mock-Daten.
 * Phase 2: Bei VITE_DATA_SOURCE=http wird hier eine HttpDataSource erzeugt, die
 * dasselbe Interface gegen das FastAPI-Backend (appConfig.apiBaseUrl) umsetzt.
 * Die Seiten bleiben dabei unverändert.
 */
function createDataSource(): MonitoringDataSource & { refresh?: () => void; dataTimestamp?: number } {
  if (appConfig.dataSource === 'http') {
    console.warn('[NEXUS] HTTP-Datenquelle ist in Phase 1 noch nicht implementiert – verwende Mock-Daten.');
  }
  return new MockDataSource();
}

export const dataSource = createDataSource();
export type { MonitoringDataSource } from './dataSource';
export * from './types';
