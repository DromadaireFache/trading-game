/**
 * React binding for GameClient: one client per mounted route (/play = player, /floor = spectator).
 *   const game = useGame();            // GameState, re-renders on change
 *   const client = useGameClient();    // join(), startGame(), send(), onMessage()
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Role, ServerMsg } from '@tg/shared';
import { GameClient } from './gameClient.ts';
import type { GameState } from './state.ts';

const GameClientContext = createContext<GameClient | null>(null);

export function GameProvider({ role, children }: { role: Role; children: ReactNode }) {
  // The constructor has no side effects; the socket lives and dies with the effect (StrictMode-safe).
  const [client] = useState(() => new GameClient({ role }));
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

/** Subscribe to raw server messages without re-rendering (charts, sound effects, flashes). */
export function useServerMessages(handler: (msg: ServerMsg) => void): void {
  const client = useGameClient();
  useEffect(() => client.onMessage(handler), [client, handler]);
}
