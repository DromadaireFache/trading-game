/**
 * React binding for GameClient: one client per mounted route (/play = player, /floor = spectator).
 *   const game = useGame();            // GameState, re-renders on change
 *   const client = useGameClient();    // join(), startGame(), send(), onMessage()
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Role, ServerMsg } from '@tg/shared';
import { GameClient } from './gameClient.ts';
import type { GameClientOptions } from './gameClient.ts';
import type { GameState } from './state.ts';

const GameClientContext = createContext<GameClient | null>(null);

export interface GameProviderProps {
  role: Role;
  children: ReactNode;
  /** Where to connect; default: the page's own origin (the LAN server). */
  url?: GameClientOptions['url'];
  /** Names the saved session (the online room code). */
  scope?: string;
  onRoomError?: GameClientOptions['onRoomError'];
}

export function GameProvider({ role, url, scope, onRoomError, children }: GameProviderProps) {
  // The constructor has no side effects; the socket lives and dies with the effect (StrictMode-safe).
  // Url, scope and callback are read once: a different room is a different provider (see ConnectGate).
  const [client] = useState(() => new GameClient({ role, url, scope, onRoomError }));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  return <GameClientContext.Provider value={client}>{children}</GameClientContext.Provider>;
}

export function useGameClient(): GameClient {
  const client = useContext(GameClientContext);
  if (!client) throw new Error('useGameClient must be used inside <GameProvider>');
  return client;
}

export function useGame(): GameState {
  const client = useGameClient();
  return useSyncExternalStore(client.subscribe, client.getState);
}

/** Every player's holdings; re-renders only when someone's holdings change. */
export function useHoldings() {
  const client = useGameClient();
  return useSyncExternalStore(client.holdings.subscribe, client.holdings.get);
}

/** Subscribe to raw server messages without re-rendering (charts, sound effects, flashes). */
export function useServerMessages(handler: (msg: ServerMsg) => void): void {
  const client = useGameClient();
  useEffect(() => client.onMessage(handler), [client, handler]);
}
