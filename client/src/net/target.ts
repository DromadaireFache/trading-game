/**
 * Where the game is played: on the LAN server this page came from (one game, no code), or online in a
 * Cloudflare room picked by a four-character code. Pure helpers; ConnectGate (routes/) holds the state.
 *
 * Two builds: the default build (`npm run play`, `npm run dev`) offers both and starts on the LAN; the
 * online build (`vite build --mode online`, see .env.online) is what the Worker serves: online only,
 * connecting to its own origin.
 */
import { defaultConfig } from '@tg/shared';
import type { SessionStorageLike } from './session.ts';

export type NetMode = 'online' | 'lan';

/** True in the build the Worker serves. */
export const ONLINE_ONLY: boolean = import.meta.env.VITE_ONLINE_ONLY === '1';
/** Where the online game lives, for the LAN build's "play online" option. */
export const ONLINE_HOST: string = import.meta.env.VITE_ONLINE_HOST || 'oligopoly.julienyang12.workers.dev';

/** The host players type into their browser to reach the online game. */
export function onlinePageHost(page: { host: string } = location): string {
  return ONLINE_ONLY ? page.host : ONLINE_HOST;
}

/** The websocket of a room. `create` asks the server to make the room instead of joining an existing one. */
export function onlineWsUrl(room: string, create: boolean, page: { protocol: string; host: string } = location): string {
  const base = ONLINE_ONLY ? `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}` : `wss://${ONLINE_HOST}`;
  return `${base}${defaultConfig.net.wsPath}?room=${room}${create ? '&create=1' : ''}`;
}

const MODE_KEY = 'tg.mode';

/** The mode this tab last chose; the LAN until somebody picks online. */
export function loadMode(storage: SessionStorageLike | null): NetMode {
  try {
    return storage?.getItem(MODE_KEY) === 'online' ? 'online' : 'lan';
  } catch {
    return 'lan';
  }
}

export function saveMode(storage: SessionStorageLike | null, mode: NetMode): void {
  try {
    storage?.setItem(MODE_KEY, mode);
  } catch {
    // storage blocked: the choice just does not survive a reload
  }
}
