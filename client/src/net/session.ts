/**
 * Reconnect session, kept in sessionStorage: per TAB, so two windows of one browser are two players.
 * One entry per role, so /play and /floor in the same tab do not overwrite each other, and one per
 * room in the online game (`scope` = the room code), so a token never goes to another room.
 */
import type { Role } from '@tg/shared';

export interface Session {
  token: string;
  /** Sent along with the token so the server can fall back to a fresh join after a restart. */
  name: string;
}

/** The part of the Storage API we use; injectable for tests. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const key = (role: Role, scope?: string) => (scope === undefined ? `tg.session.${role}` : `tg.session.${role}.${scope}`);

export function loadSession(storage: SessionStorageLike | null, role: Role, scope?: string): Session | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(role, scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, name } = parsed as { token?: unknown; name?: unknown };
    if (typeof token !== 'string' || token === '') return null;
    return { token, name: typeof name === 'string' ? name : '' };
  } catch {
    return null;
  }
}

export function saveSession(storage: SessionStorageLike | null, role: Role, session: Session, scope?: string): void {
  try {
    storage?.setItem(key(role, scope), JSON.stringify(session));
  } catch {
    // Storage full or blocked: play on without reconnect support.
  }
}

export function clearSession(storage: SessionStorageLike | null, role: Role, scope?: string): void {
  try {
    storage?.removeItem(key(role, scope));
  } catch {
    // ignore
  }
}

/** sessionStorage, or null where it is unavailable (tests, privacy modes). */
export function browserSessionStorage(): SessionStorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
