/**
 * Client-side game state and the pure reducer that folds server messages into it.
 * No I/O here (no sockets, storage or clocks), so it is unit-testable; `now` is passed in.
 *
 * Later milestones add their slices here (prices, portfolio, headlines, shop, results) and handle
 * the matching message in `applyServerMsg`. High-frequency consumers (charts) can instead subscribe
 * to raw messages with GameClient.onMessage and keep their own buffers.
 */
import { defaultConfig } from '@tg/shared';
import type { ErrorCode, GameConfig, LobbyState, PhaseInfo, PlayerId, Role, ServerMsg } from '@tg/shared';

/**
 * idle: not started. connecting: first attempt. open: socket is up.
 * reconnecting: lost the socket, retrying with backoff. closed: stopped on purpose.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** none: no join pending. joining: join sent (or queued until the socket opens). joined: welcome received. */
export type JoinStatus = 'none' | 'joining' | 'joined';

export interface Me {
  playerId: PlayerId;
  name: string;
  role: Role;
}

export interface GameError {
  code: ErrorCode;
  message: string;
  /** Client clock (ms) when it arrived; lets the UI auto-dismiss. */
  at: number;
}

export interface GameState {
  connection: ConnectionStatus;
  join: JoinStatus;
  /** Set by `welcome`; kept across reconnects so the UI does not flash back to name entry. */
  me: Me | null;
  /** Effective server config once welcomed; shared defaults before that. */
  config: GameConfig;
  phase: PhaseInfo | null;
  lobby: LobbyState | null;
  /** The host's LAN `/play` URLs, from `welcome`. */
  joinUrls: string[];
  /** serverTime - clientTime in ms. Server "now" = Date.now() + clockOffsetMs. */
  clockOffsetMs: number;
  error: GameError | null;
  /** Another tab took over this session; this tab stays disconnected until it is reloaded. */
  replaced: boolean;
}

export const initialGameState: GameState = {
  connection: 'idle',
  join: 'none',
  me: null,
  config: defaultConfig,
  phase: null,
  lobby: null,
  joinUrls: [],
  clockOffsetMs: 0,
  error: null,
  replaced: false,
};

/** Folds one server message into the state. Returns the same object when nothing changed. */
export function applyServerMsg(state: GameState, msg: ServerMsg, now: number): GameState {
  switch (msg.t) {
    case 'welcome':
      return {
        ...state,
        join: 'joined',
        me: { playerId: msg.playerId, name: msg.name, role: msg.role },
        config: msg.config,
        phase: msg.phase,
        lobby: msg.lobby,
        joinUrls: Array.isArray(msg.joinUrls) ? msg.joinUrls : [],
        clockOffsetMs: msg.phase.serverTime - now,
        error: null,
      };
    case 'lobby': {
      const { t: _t, ...lobby } = msg;
      return { ...state, lobby };
    }
    case 'phase': {
      const { t: _t, ...phase } = msg;
      return { ...state, phase, clockOffsetMs: msg.serverTime - now };
    }
    case 'error':
      return { ...state, error: { code: msg.code, message: msg.message, at: now } };
    // Market data lives in MarketStore (net/marketStore.ts), fed by GameClient: it must not touch this state.
    case 'market':
    case 'tick':
    case 'candle':
      return state;
    // Later milestones: fold these into their own slices.
    case 'headline':
    case 'fill':
    case 'portfolio':
    case 'shop':
    case 'results':
    case 'moment':
      return state;
    default: {
      // Unknown `t` from a newer server: ignore rather than crash.
      const _exhaustive: never = msg;
      void _exhaustive;
      return state;
    }
  }
}

/** Minimal shape check for an incoming frame; the server is trusted beyond that. */
export function parseServerMsg(data: unknown): ServerMsg | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof (parsed as { t?: unknown }).t !== 'string') return null;
    return parsed as ServerMsg;
  } catch {
    return null;
  }
}
