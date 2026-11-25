/**
 * Laufzeit-Konfiguration des Frontends.
 *
 * Werte kommen aus Vite-Umgebungsvariablen (VITE_*). Für den Containerbetrieb
 * kann zusätzlich window.__NEXUS_CONFIG__ gesetzt werden (siehe
 * frontend/docker/40-runtime-config.sh), damit dasselbe Image ohne Neubau auf
 * verschiedenen Servern läuft. Keine festen Hosts, keine Zugangsdaten.
 */
interface RuntimeConfig {
  dataSource?: 'mock' | 'http';
  apiBaseUrl?: string;
  instanceName?: string;
}

declare global {
  interface Window {
    __NEXUS_CONFIG__?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig = (typeof window !== 'undefined' && window.__NEXUS_CONFIG__) || {};
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const appConfig = {
  dataSource: (runtime.dataSource ?? env.VITE_DATA_SOURCE ?? 'mock') as 'mock' | 'http',
  /** Relativ, damit ein Reverse-Proxy im selben Origin genügt */
  apiBaseUrl: runtime.apiBaseUrl ?? env.VITE_API_BASE_URL ?? '/api',
  instanceName: runtime.instanceName ?? env.VITE_INSTANCE_NAME ?? 'NEXUS Monitor',
  version: '0.3.1',
};
