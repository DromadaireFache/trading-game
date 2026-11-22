import { createContext, useContext } from 'react';
import type { NetMode } from './target.ts';

/** What the screens inside a ConnectGate may ask about, and do to, where the game is played. */
export interface NetTarget {
  mode: NetMode;
  /** The room code (online only). */
  room: string | null;
  /** False in the online-only build: there is no LAN to switch to. */
  canSwitch: boolean;
  setMode(mode: NetMode): void;
  /** Back to the room code screen (online). */
  leaveRoom(): void;
}

export const NetTargetContext = createContext<NetTarget | null>(null);

export function useNetTarget(): NetTarget {
  const target = useContext(NetTargetContext);
  if (!target) throw new Error('useNetTarget must be used inside <ConnectGate>');
  return target;
}
