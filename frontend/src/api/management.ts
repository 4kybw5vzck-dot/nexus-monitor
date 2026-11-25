/**
 * Verwaltungsfunktionen (Anlegen, Ändern, Löschen). Nur mit Backend verfügbar –
 * im Mock-Modus ist `management` undefined und die Oberfläche blendet die
 * Bearbeitung aus bzw. weist darauf hin.
 */
import type { User } from './types';

export type Role = User['role'];

export interface UserInput {
  login: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password?: string;
}

export interface ManagementApi {
  createUser(input: UserInput): Promise<User>;
  updateUser(id: string, patch: Partial<Pick<UserInput, 'name' | 'email' | 'role' | 'active'>>): Promise<User>;
  setUserPassword(id: string, password: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void>;
}
