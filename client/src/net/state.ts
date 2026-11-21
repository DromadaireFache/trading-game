/**
 * Client-side game state and the pure reducer that folds server messages into it.
 * No I/O here (no sockets, storage or clocks), so it is unit-testable; `now` is passed in.
 *
 * Later milestones add their slices here (prices, portfolio, headlines, shop, results) and handle
 * the matching message in `applyServerMsg`. High-frequency consumers (charts) can instead subscribe
 * to raw messages with GameClient.onMessage and keep their own buffers.
 */
import { defaultConfig } from '@tg/shared';
import type {
  Briefing,
  CardOffer,
  EarningsMsg,
  ErrorCode,
  FillMsg,
  GameConfig,
  HeadlineMsg,
  LobbyState,
  MomentMsg,
  PhaseInfo,
  PlayerId,
  PortfolioMsg,
  ResultsMsg,
  Role,
  ServerMsg,
} from '@tg/shared';

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
  /** Latest `portfolio` from the server (players only). Live values are recomputed from ticks. */
  portfolio: Portfolio | null;
  /** This player's fills, newest first, at most MAX_FILLS. */
  fills: FillRecord[];
  /** Public headlines, newest first, at most MAX_HEADLINES, unique by id. */
  headlines: Omit<HeadlineMsg, 't'>[];
  /** This quarter's briefing (beats, rate). */
  briefing: Briefing | null;
  /** Latest earnings reports, until the next briefing. */
  earnings: Omit<EarningsMsg, 't'> | null;
  /** This SHOP's offers for this player (prices are personal). */
  shop: CardOffer[];
  /** Latest quarter (or final) results; shown in RESULTS and FINAL, kept until the next ones. */
  results: Omit<ResultsMsg, 't'> | null;
  /** Latest projector moment and when it arrived (client ms); the floor shows it for a few seconds. */
  moment: (Omit<MomentMsg, 't'> & { at: number }) | null;
}

export const MAX_HEADLINES = 60;

export type Portfolio = Omit<PortfolioMsg, 't'>;

export interface FillRecord extends Omit<FillMsg, 't'> {
  /** Running number, so the UI can flash a new fill even when it looks like the last one. */
  seq: number;
}

export const MAX_FILLS = 20;

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
  portfolio: null,
  fills: [],
  headlines: [],
  briefing: null,
  earnings: null,
  shop: [],
  results: null,
  moment: null,
};

/** Folds one server message into the state. Returns the same object when nothing changed. */
export function applyServerMsg(state: GameState, msg: ServerMsg, now: number): GameState {
  switch (msg.t) {
    case 'welcome': {
      // Same seat after a reconnect: keep the trading history. Another seat: start clean.
      const sameSeat = state.me?.playerId === msg.playerId;
      return {
        ...state,
        portfolio: sameSeat ? state.portfolio : null,
        fills: sameSeat ? state.fills : [],
        join: 'joined',
        me: { playerId: msg.playerId, name: msg.name, role: msg.role },
        config: msg.config,
        phase: msg.phase,
        lobby: msg.lobby,
        joinUrls: Array.isArray(msg.joinUrls) ? msg.joinUrls : [],
        clockOffsetMs: msg.phase.serverTime - now,
        error: null,
      };
    }
    case 'portfolio': {
      const { t: _t, ...portfolio } = msg;
      return { ...state, portfolio };
    }
    case 'fill': {
      const { t: _t, ...fill } = msg;
      const seq = (state.fills[0]?.seq ?? 0) + 1;
      return { ...state, fills: [{ ...fill, seq }, ...state.fills].slice(0, MAX_FILLS) };
    }
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
    case 'headline': {
      // Replays after a reconnect repeat ids we already have.
      if (state.headlines.some((h) => h.id === msg.id && !h.early === !msg.early)) return state;
      const { t: _t, ...headline } = msg;
      const rest = msg.early ? state.headlines : state.headlines.filter((h) => h.id !== msg.id);
      return { ...state, headlines: [headline, ...rest].slice(0, MAX_HEADLINES) };
    }
    case 'briefing': {
      const { t: _t, ...briefing } = msg;
      // A new quarter: last quarter's earnings are history.
      return { ...state, briefing, earnings: null };
    }
    case 'earnings': {
      const { t: _t, ...earnings } = msg;
      return { ...state, earnings };
    }
    case 'results': {
      const { t: _t, ...results } = msg;
      return { ...state, results };
    }
    case 'moment': {
      const { t: _t, ...moment } = msg;
      return { ...state, moment: { ...moment, at: now } };
    }
    case 'shop':
      return { ...state, shop: msg.offers };
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
