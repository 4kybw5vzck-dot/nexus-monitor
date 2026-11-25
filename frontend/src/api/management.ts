/**
 * Verwaltungsfunktionen (Anlegen, Ändern, Löschen). Nur mit Backend verfügbar –
 * im Mock-Modus ist `management` undefined und die Oberfläche blendet die
 * Bearbeitung aus bzw. weist darauf hin.
 */
import type { Catalog, Collector, CredentialProfile, Device, DeviceConfig, DeviceType, Sensor, SensorType, Site, Thresholds, User } from './types';

export type Role = User['role'];

export interface UserInput {
  login: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password?: string;
}

export interface CredentialProfileInput {
  name: string;
  protocol: DeviceConfig['protocol'];
  description?: string;
  /** Leere geheime Felder behalten beim Ändern den bisherigen Wert */
  credentials?: Record<string, unknown>;
}

export interface SiteInput {
  name: string;
  city?: string;
  address?: string;
  subnet?: string;
  contact?: string;
  collectorId?: string | null;
}

export interface DeviceInput {
  name: string;
  ip: string;
  type: DeviceType;
  vendor?: string;
  model?: string;
  os?: string;
  siteId: string;
  description?: string;
  tags?: string[];
  pollingIntervalSec?: number;
  protocol: DeviceConfig['protocol'];
  credentialProfileId?: number | null;
  notificationGroup?: string;
  maintenanceWindow?: string | null;
  collectorId?: string | null;
  createDefaultSensors?: boolean;
}

export interface SensorInput {
  type: SensorType;
  name?: string;
  intervalSec?: number;
  thresholds?: Thresholds | null;
  settings?: Record<string, unknown>;
}

export interface ManagementApi {
  getCatalog(): Promise<Catalog>;
  listCredentialProfiles(): Promise<CredentialProfile[]>;
  createCredentialProfile(input: CredentialProfileInput): Promise<CredentialProfile>;
  updateCredentialProfile(id: number, patch: Partial<CredentialProfileInput>): Promise<CredentialProfile>;
  deleteCredentialProfile(id: number): Promise<void>;
  createSite(input: SiteInput): Promise<Site>;
  updateSite(id: string, patch: Partial<SiteInput>): Promise<Site>;
  deleteSite(id: string): Promise<void>;
  createDevice(input: DeviceInput): Promise<Device>;
  updateDevice(id: string, patch: Partial<Omit<DeviceInput, 'createDefaultSensors'>> & { paused?: boolean }): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  createSensor(deviceId: string, input: SensorInput): Promise<Sensor>;
  updateSensor(id: string, patch: Partial<Omit<SensorInput, 'type'>> & { paused?: boolean }): Promise<Sensor>;
  deleteSensor(id: string): Promise<void>;
  createCollector(name: string, siteId: string | null): Promise<{ collector: Collector; token: string }>;
  renewCollectorToken(id: string): Promise<{ collector: Collector; token: string }>;
  deleteCollector(id: string): Promise<void>;

  createUser(input: UserInput): Promise<User>;
  updateUser(id: string, patch: Partial<Pick<UserInput, 'name' | 'email' | 'role' | 'active'>>): Promise<User>;
  setUserPassword(id: string, password: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void>;
}
