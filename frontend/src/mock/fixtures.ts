/**
 * Statische, vollständig fiktive Stammdaten.
 *
 * - Firma, Standorte, Personen und Gerätenamen sind erfunden.
 * - IP-Adressen stammen ausschließlich aus den Dokumentationsbereichen nach
 *   RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) und sind im
 *   Internet nicht routbar.
 * - Es sind keine Zugangsdaten enthalten, nur Namen von Zugangsprofilen.
 */
import type { DeviceConfig, DeviceType, NotificationRule, ReportDefinition, Site, User } from '../api/types';

export const COMPANY = 'Musterwerk Rhein-Neckar GmbH (fiktiv)';

export const SITES: Site[] = [
  {
    id: 'site-ma',
    name: 'Zentrale Mannheim',
    city: 'Mannheim',
    address: 'Beispielstraße 1',
    subnet: '192.0.2.0/24',
    collectorId: 'col-ma',
    contact: 'IT-Betrieb Zentrale',
  },
  {
    id: 'site-lu',
    name: 'Werk Ludwigshafen',
    city: 'Ludwigshafen',
    address: 'Musterallee 25',
    subnet: '198.51.100.0/24',
    collectorId: 'col-lu',
    contact: 'Werks-IT Ludwigshafen',
  },
  {
    id: 'site-hd',
    name: 'Außenstelle Heidelberg',
    city: 'Heidelberg',
    address: 'Testweg 7',
    subnet: '203.0.113.0/24',
    collectorId: 'col-hd',
    contact: 'IT-Betrieb Zentrale',
  },
];

export interface DeviceFixture {
  id: string;
  name: string;
  ip: string;
  type: DeviceType;
  vendor: string;
  model: string;
  os: string;
  siteId: string;
  role: string;
  tags: string[];
  /** Zusätzliche Sensoren über das Typ-Template hinaus */
  extra?: Array<'dns' | 'http' | 'disk-data'>;
  protocol: DeviceConfig['protocol'];
}

export const DEVICES: DeviceFixture[] = [
  // ---------- Zentrale Mannheim ----------
  { id: 'dev-ma-fw-01', name: 'MA-FW-01', ip: '192.0.2.1', type: 'firewall', vendor: 'Fortinet', model: 'FortiGate 200F', os: 'FortiOS 7.4', siteId: 'site-ma', role: 'Perimeter-Firewall', tags: ['perimeter', 'kritisch'], extra: ['http'], protocol: 'SNMP v3' },
  { id: 'dev-ma-rt-01', name: 'MA-RT-01', ip: '192.0.2.2', type: 'router', vendor: 'Cisco', model: 'ISR 4331', os: 'IOS XE 17.9', siteId: 'site-ma', role: 'WAN-Router (MPLS)', tags: ['wan'], protocol: 'SNMP v3' },
  { id: 'dev-ma-core-01', name: 'MA-CORE-01', ip: '192.0.2.3', type: 'switch', vendor: 'Huawei', model: 'CloudEngine 6881', os: 'VRP V200R022', siteId: 'site-ma', role: 'Core-Switch', tags: ['core', 'kritisch'], protocol: 'SNMP v3' },
  { id: 'dev-ma-acc-01', name: 'MA-ACC-01', ip: '192.0.2.11', type: 'switch', vendor: 'Huawei', model: 'S5735-L48T4X', os: 'VRP V200R022', siteId: 'site-ma', role: 'Access-Switch EG', tags: ['access'], protocol: 'SNMP v3' },
  { id: 'dev-ma-acc-02', name: 'MA-ACC-02', ip: '192.0.2.12', type: 'switch', vendor: 'Huawei', model: 'S5735-L48T4X', os: 'VRP V200R022', siteId: 'site-ma', role: 'Access-Switch 1. OG', tags: ['access'], protocol: 'SNMP v3' },
  { id: 'dev-ma-dc-01', name: 'MA-DC-01', ip: '192.0.2.20', type: 'windows-server', vendor: 'Dell', model: 'PowerEdge R650', os: 'Windows Server 2022', siteId: 'site-ma', role: 'Domänencontroller', tags: ['ad', 'kritisch'], extra: ['dns'], protocol: 'WMI' },
  { id: 'dev-ma-fs-01', name: 'MA-FS-01', ip: '192.0.2.21', type: 'windows-server', vendor: 'VMware', model: 'Virtuelle Maschine', os: 'Windows Server 2022', siteId: 'site-ma', role: 'Dateiserver', tags: ['fileservice'], extra: ['disk-data'], protocol: 'WMI' },
  { id: 'dev-ma-sql-01', name: 'MA-SQL-01', ip: '192.0.2.22', type: 'windows-server', vendor: 'VMware', model: 'Virtuelle Maschine', os: 'Windows Server 2022', siteId: 'site-ma', role: 'SQL Server (ERP)', tags: ['datenbank', 'kritisch'], extra: ['disk-data'], protocol: 'WMI' },
  { id: 'dev-ma-web-01', name: 'MA-WEB-01', ip: '192.0.2.30', type: 'linux-server', vendor: 'VMware', model: 'Virtuelle Maschine', os: 'Ubuntu Server 24.04 LTS', siteId: 'site-ma', role: 'Intranet-Webserver', tags: ['web'], extra: ['http'], protocol: 'SSH' },
  { id: 'dev-ma-esx-01', name: 'MA-ESX-01', ip: '192.0.2.40', type: 'hypervisor-vmware', vendor: 'HPE', model: 'ProLiant DL380 Gen11', os: 'VMware ESXi 8.0 U3', siteId: 'site-ma', role: 'Virtualisierungshost', tags: ['virtualisierung'], protocol: 'API' },
  { id: 'dev-ma-esx-02', name: 'MA-ESX-02', ip: '192.0.2.41', type: 'hypervisor-vmware', vendor: 'HPE', model: 'ProLiant DL380 Gen11', os: 'VMware ESXi 8.0 U3', siteId: 'site-ma', role: 'Virtualisierungshost', tags: ['virtualisierung'], protocol: 'API' },
  { id: 'dev-ma-nas-01', name: 'MA-SAN-01', ip: '192.0.2.50', type: 'storage', vendor: 'NetApp', model: 'AFF A250', os: 'ONTAP 9.15', siteId: 'site-ma', role: 'Primärspeicher', tags: ['storage', 'kritisch'], protocol: 'SNMP v3' },
  { id: 'dev-ma-bkp-01', name: 'MA-BKP-01', ip: '192.0.2.51', type: 'backup', vendor: 'Dell', model: 'PowerEdge R760xd2', os: 'Windows Server 2022 / Veeam B&R 12', siteId: 'site-ma', role: 'Backup-Server', tags: ['backup'], protocol: 'WMI' },
  { id: 'dev-ma-usv-01', name: 'MA-USV-01', ip: '192.0.2.60', type: 'ups', vendor: 'APC', model: 'Smart-UPS SRT 5000', os: 'NMC 3', siteId: 'site-ma', role: 'USV Serverraum', tags: ['infrastruktur'], protocol: 'SNMP v3' },
  // ---------- Werk Ludwigshafen ----------
  { id: 'dev-lu-fw-01', name: 'LU-FW-01', ip: '198.51.100.1', type: 'firewall', vendor: 'Cisco', model: 'Firepower 1120', os: 'FTD 7.4', siteId: 'site-lu', role: 'Standort-Firewall', tags: ['perimeter'], protocol: 'SNMP v3' },
  { id: 'dev-lu-sw-01', name: 'LU-SW-01', ip: '198.51.100.3', type: 'switch', vendor: 'Huawei', model: 'S6730-H24X6C', os: 'VRP V200R022', siteId: 'site-lu', role: 'Core-Switch Werk', tags: ['core'], protocol: 'SNMP v3' },
  { id: 'dev-lu-sw-02', name: 'LU-SW-02', ip: '198.51.100.11', type: 'switch', vendor: 'Huawei', model: 'S5735-L24P4X', os: 'VRP V200R022', siteId: 'site-lu', role: 'Access-Switch Produktion', tags: ['access', 'produktion'], protocol: 'SNMP v3' },
  { id: 'dev-lu-hv-01', name: 'LU-HV-01', ip: '198.51.100.40', type: 'hypervisor-hyperv', vendor: 'Lenovo', model: 'ThinkSystem SR650 V3', os: 'Windows Server 2022 Hyper-V', siteId: 'site-lu', role: 'Hyper-V-Host', tags: ['virtualisierung'], protocol: 'WMI' },
  { id: 'dev-lu-app-01', name: 'LU-MES-01', ip: '198.51.100.30', type: 'linux-server', vendor: 'Microsoft', model: 'Hyper-V-VM', os: 'Debian 12', siteId: 'site-lu', role: 'MES-Applikationsserver', tags: ['produktion', 'kritisch'], extra: ['http'], protocol: 'SSH' },
  { id: 'dev-lu-dc-02', name: 'LU-DC-02', ip: '198.51.100.20', type: 'windows-server', vendor: 'Microsoft', model: 'Hyper-V-VM', os: 'Windows Server 2022', siteId: 'site-lu', role: 'Domänencontroller', tags: ['ad'], extra: ['dns'], protocol: 'WMI' },
  { id: 'dev-lu-nas-01', name: 'LU-NAS-01', ip: '198.51.100.50', type: 'storage', vendor: 'Synology', model: 'RS3621xs+', os: 'DSM 7.2', siteId: 'site-lu', role: 'Datei- und Backup-Ziel', tags: ['storage', 'backup'], protocol: 'SNMP v3' },
  // ---------- Außenstelle Heidelberg ----------
  { id: 'dev-hd-fw-01', name: 'HD-FW-01', ip: '203.0.113.1', type: 'firewall', vendor: 'Fortinet', model: 'FortiGate 60F', os: 'FortiOS 7.4', siteId: 'site-hd', role: 'Standort-Firewall (VPN)', tags: ['perimeter', 'vpn'], protocol: 'SNMP v3' },
  { id: 'dev-hd-sw-01', name: 'HD-SW-01', ip: '203.0.113.3', type: 'switch', vendor: 'Huawei', model: 'S5735-L24T4X', os: 'VRP V200R022', siteId: 'site-hd', role: 'Standort-Switch', tags: ['access'], protocol: 'SNMP v2c' },
  { id: 'dev-hd-srv-01', name: 'HD-SRV-01', ip: '203.0.113.20', type: 'linux-server', vendor: 'Fujitsu', model: 'PRIMERGY TX1330 M5', os: 'Rocky Linux 9', siteId: 'site-hd', role: 'Standortserver (Druck/Datei)', tags: ['standort'], extra: ['dns'], protocol: 'SSH' },
];

/** Topologie: Verbindungen zwischen Geräten (from = Richtung Kern/Perimeter). */
export const LINK_FIXTURES: Array<{ from: string; to: string; bandwidth: number; kind: 'lan' | 'uplink' | 'wan' | 'storage' }> = [
  // Mannheim
  { from: 'dev-ma-fw-01', to: 'dev-ma-rt-01', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-ma-fw-01', to: 'dev-ma-core-01', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-ma-core-01', to: 'dev-ma-acc-01', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-ma-core-01', to: 'dev-ma-acc-02', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-ma-core-01', to: 'dev-ma-esx-01', bandwidth: 25000, kind: 'lan' },
  { from: 'dev-ma-core-01', to: 'dev-ma-esx-02', bandwidth: 25000, kind: 'lan' },
  { from: 'dev-ma-core-01', to: 'dev-ma-dc-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-ma-core-01', to: 'dev-ma-bkp-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-ma-core-01', to: 'dev-ma-nas-01', bandwidth: 25000, kind: 'storage' },
  { from: 'dev-ma-esx-01', to: 'dev-ma-fs-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-ma-esx-01', to: 'dev-ma-web-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-ma-esx-02', to: 'dev-ma-sql-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-ma-acc-02', to: 'dev-ma-usv-01', bandwidth: 1000, kind: 'lan' },
  // Ludwigshafen
  { from: 'dev-lu-fw-01', to: 'dev-lu-sw-01', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-lu-sw-01', to: 'dev-lu-sw-02', bandwidth: 10000, kind: 'uplink' },
  { from: 'dev-lu-sw-01', to: 'dev-lu-hv-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-lu-sw-01', to: 'dev-lu-nas-01', bandwidth: 10000, kind: 'storage' },
  { from: 'dev-lu-hv-01', to: 'dev-lu-app-01', bandwidth: 10000, kind: 'lan' },
  { from: 'dev-lu-hv-01', to: 'dev-lu-dc-02', bandwidth: 10000, kind: 'lan' },
  // Heidelberg
  { from: 'dev-hd-fw-01', to: 'dev-hd-sw-01', bandwidth: 1000, kind: 'uplink' },
  { from: 'dev-hd-sw-01', to: 'dev-hd-srv-01', bandwidth: 1000, kind: 'lan' },
  // Standortverbindungen (WAN / VPN)
  { from: 'dev-ma-rt-01', to: 'dev-lu-fw-01', bandwidth: 500, kind: 'wan' },
  { from: 'dev-ma-rt-01', to: 'dev-hd-fw-01', bandwidth: 100, kind: 'wan' },
];

export const USERS: User[] = [
  { id: 'usr-1', name: 'Martina Berger', login: 'm.berger', role: 'Administrator', email: 'm.berger@example.org', lastLogin: '', active: true },
  { id: 'usr-2', name: 'Jonas Keller', login: 'j.keller', role: 'Operator', email: 'j.keller@example.org', lastLogin: '', active: true },
  { id: 'usr-3', name: 'Selin Aydin', login: 's.aydin', role: 'Operator', email: 's.aydin@example.org', lastLogin: '', active: true },
  { id: 'usr-4', name: 'Thomas Brandt', login: 't.brandt', role: 'Nur Lesen', email: 't.brandt@example.org', lastLogin: '', active: true },
  { id: 'usr-5', name: 'Leitstand Werk LU', login: 'leitstand.lu', role: 'Nur Lesen', email: 'leitstand-lu@example.org', lastLogin: '', active: true },
  { id: 'usr-6', name: 'Peter Vogt', login: 'p.vogt', role: 'Operator', email: 'p.vogt@example.org', lastLogin: '', active: false },
];

export const NOTIFICATION_RULES: NotificationRule[] = [
  { id: 'nr-1', name: 'Kritisch an Bereitschaft', trigger: 'Status wechselt auf Kritisch (alle Standorte)', channel: 'SMS', target: 'Bereitschaftsgruppe IT', enabled: true },
  { id: 'nr-2', name: 'Warnungen an IT-Betrieb', trigger: 'Status Warnung länger als 15 Minuten', channel: 'E-Mail', target: 'it-betrieb@example.org', enabled: true },
  { id: 'nr-3', name: 'Produktion Ludwigshafen', trigger: 'Tag „produktion“ – Warnung oder Kritisch', channel: 'Microsoft Teams', target: 'Kanal „Werks-IT LU“', enabled: true },
  { id: 'nr-4', name: 'Ticketsystem', trigger: 'Kritisch, nicht bestätigt nach 10 Minuten', channel: 'Webhook', target: 'Ticketsystem (Platzhalter-URL)', enabled: false },
];

export const REPORTS: ReportDefinition[] = [
  { id: 'rep-1', name: 'Verfügbarkeit je Standort', description: 'Verfügbarkeit aller Ping-Sensoren, gruppiert nach Standort', period: 'Monatlich', lastRun: '', format: 'PDF' },
  { id: 'rep-2', name: 'Top 10 Bandbreite', description: 'Interfaces und WAN-Strecken mit der höchsten Auslastung', period: 'Wöchentlich', lastRun: '', format: 'PDF' },
  { id: 'rep-3', name: 'Speicherkapazität', description: 'Belegung aller Datenträger und Volumes mit Trend', period: 'Wöchentlich', lastRun: '', format: 'CSV' },
  { id: 'rep-4', name: 'Alarmhistorie', description: 'Alle Alarme inklusive Bestätigung und Dauer', period: 'Täglich', lastRun: '', format: 'HTML' },
  { id: 'rep-5', name: 'SLA Produktion', description: 'Verfügbarkeit der Systeme mit Tag „produktion“', period: 'Monatlich', lastRun: '', format: 'PDF' },
];
