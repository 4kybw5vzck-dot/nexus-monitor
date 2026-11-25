/**
 * Angemeldeter Benutzer.
 *
 * - Mock-Modus: fester Demo-Benutzer, keine Anmeldung.
 * - HTTP-Modus: Token und Benutzer aus POST /api/auth/login. Gespeichert in
 *   sessionStorage (gilt nur für diesen Browser-Tab und endet mit dem Schließen).
 */
import { useSyncExternalStore } from 'react';
import type { User } from '../api/types';

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

const STORAGE_KEY = 'nexus.session';

const DEMO_USER: User = {
  id: 'usr-1',
  name: 'Martina Berger',
  login: 'm.berger',
  role: 'Administrator',
  email: 'm.berger@example.org',
  lastLogin: '',
  active: true,
};

let current: Session | null = load();
const listeners = new Set<() => void>();

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return current;
}

export function setSession(session: Session | null): void {
  current = session;
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Speicher nicht verfügbar – Sitzung gilt dann nur bis zum Neuladen */
  }
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

/** Benutzer für die Anzeige: angemeldeter Benutzer oder (Mock-Modus) Demo-Benutzer. */
export function currentUser(mockMode: boolean): User | null {
  return mockMode ? DEMO_USER : current?.user ?? null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Darf der Benutzer Alarme bestätigen und Discovery starten? */
export function canOperate(user: User | null): boolean {
  return !!user && (user.role === 'Administrator' || user.role === 'Operator');
}

/** Rechte für Bearbeitungsfunktionen (nur mit Backend). */
export function usePermissions(): { canEdit: boolean; isAdmin: boolean } {
  useSession();
  const user = current?.user ?? null;
  return {
    canEdit: !!user && (user.role === 'Administrator' || user.role === 'Operator'),
    isAdmin: !!user && user.role === 'Administrator',
  };
}
