/**
 * Wire protocol. JSON text frames, discriminated on `t`.
 * Follows DESIGN.md section 8; additions are listed in docs/DECISIONS.md.
 *
 * Time conventions:
 * - `endsAt`, `serverTime`: server wall-clock ms since epoch (Date.now() on the server).
 * - `day`, `ts`, `jailedUntil`: game time in trading days since the start of the game (may be fractional).
 */
import type { GameConfig } from './config.ts';
import type {
  Arrest,
  Award,
  Card,
  CardDirection,
  CardOffer,
  LeaderboardEntry,
  LobbyPlayer,
  MomentKind,
  OHLC,
  Phase,
  PlayerId,
  Position,
  Recap,
  Role,
  Sector,
  Statement,
  SymbolId,
} from './types.ts';

// ---------------------------------------------------------------------------
// client -> server
// ---------------------------------------------------------------------------

/**
 * First message on every connection.
 * - New player: { role: 'player', name }.
 * - Projector: { role: 'spectator' } (name optional).
 * - Reconnect: add the `token` from a previous welcome. A valid token resumes that session and
 *   name/role are ignored. An unknown token falls back to a fresh join when possible, otherwise
 *   the server answers with error code 'bad_token'.
 */
export interface JoinMsg {
  t: 'join';
  role: Role;
  name?: string;
  token?: string;
}

/** Any joined player may start the game while in LOBBY. */
export interface StartMsg {
  t: 'start';
}

/** Market order. qty < 0 = sell/short. */
export interface OrderMsg {
  t: 'order';
  symbol: SymbolId;
  qty: number;
}

export interface BuyCardMsg {
  t: 'buy_card';
  offerId: string;
}

export interface PlayCardMsg {
  t: 'play_card';
  cardId: string;
  /** Symbol or sector id, depending on the card. */
  target?: string;
  direction?: CardDirection;
}

export type ClientMsg = JoinMsg | StartMsg | OrderMsg | BuyCardMsg | PlayCardMsg;
export type ClientMsgType = ClientMsg['t'];

// ---------------------------------------------------------------------------
// server -> client
// ---------------------------------------------------------------------------

/** Current phase. Also embedded in `welcome` so a (re)joining client is in sync at once. */
export interface PhaseInfo {
  phase: Phase;
  /** Wall-clock ms when the phase ends. null for LOBBY and FINAL (no timer). */
  endsAt: number | null;
  /** 0 in LOBBY, then 1..totalQuarters. Stays at totalQuarters in FINAL. */
  quarter: number;
  totalQuarters: number;
  /** Server clock when this was sent; clients use it to correct for clock offset. */
  serverTime: number;
}

/** Answer to a successful join. Sent to that connection only. */
export interface WelcomeMsg {
  t: 'welcome';
  playerId: PlayerId;
  /** Keep in sessionStorage and send back in `join` to reconnect. */
  token: string;
  role: Role;
  name: string;
  phase: PhaseInfo;
  lobby: LobbyState;
  /** The config the server is running with (after env overrides). */
  config: GameConfig;
  /**
   * `/play` URLs of the host on the LAN (one per network interface, may be empty). The projector shows
   * the first one when it was itself opened through localhost, where its own address is useless to others.
   */
  joinUrls?: string[];
}

export interface LobbyState {
  players: LobbyPlayer[];
  spectators: number;
  minPlayers: number;
  maxPlayers: number;
}

/** Roster broadcast: on every join, leave, disconnect and reconnect (in any phase). */
export interface LobbyMsg extends LobbyState {
  t: 'lobby';
}

export interface PhaseMsg extends PhaseInfo {
  t: 'phase';
}

/** One shared price tick for everybody. */
export interface TickMsg {
  t: 'tick';
  day: number;
  prices: Record<SymbolId, number>;
}

/** Closed daily candles. */
export interface CandleMsg {
  t: 'candle';
  day: number;
  ohlc: Record<SymbolId, OHLC>;
}

export interface HeadlineMsg {
  t: 'headline';
  id: string;
  text: string;
  symbol?: SymbolId;
  sector?: Sector;
  /** Game day (fractional) at which it was published. */
  ts: number;
  /** true = insider preview, sent only to the card holder ahead of the public headline. */
  early?: boolean;
}

/** Sent to the player whose order was filled. */
export interface FillMsg {
  t: 'fill';
  symbol: SymbolId;
  qty: number;
  price: number;
}

/** Sent per player. */
export interface PortfolioMsg {
  t: 'portfolio';
  cash: number;
  positions: Position[];
  equity: number;
  heat: number;
  /** Game day until which the player is in jail. */
  jailedUntil?: number;
  /** Additions to the draft, filled in by later milestones. */
  buyingPower?: number;
  hand?: Card[];
  eliminated?: boolean;
}

/** Sent per player (prices scale with the buyer's net worth). */
export interface ShopMsg {
  t: 'shop';
  offers: CardOffer[];
}

export interface ResultsMsg {
  t: 'results';
  leaderboard: LeaderboardEntry[];
  statements: Statement[];
  recap: Recap;
  arrests: Arrest[];
  /** Set on the last quarter / FINAL. */
  final?: boolean;
  awards?: Award[];
}

/** Projector moment (full-screen BREAKING banner). */
export interface MomentMsg {
  t: 'moment';
  kind: MomentKind;
  text: string;
}

/**
 * WebSocket close code the server uses when a newer connection took over the session (same token,
 * e.g. a duplicated browser tab). A client must NOT auto-reconnect after it, or the two tabs ping-pong.
 */
export const WS_CLOSE_REPLACED = 4000;

export const ERROR_CODES = [
  'bad_message', // not JSON, unknown `t`, wrong field types, too large
  'not_joined', // anything but `join` before a successful join
  'name_invalid',
  'name_taken',
  'game_full',
  'game_in_progress', // new players cannot join after the lobby
  'bad_token',
  'not_allowed', // e.g. spectator sending `start`, `start` outside LOBBY, not enough players
  'rate_limited', // more than net.maxMessagesPerSecond frames; the excess was dropped
  'rejected', // the sim refused an intent (order, card); see message
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorMsg {
  t: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | LobbyMsg
  | PhaseMsg
  | TickMsg
  | CandleMsg
  | HeadlineMsg
  | FillMsg
  | PortfolioMsg
  | ShopMsg
  | ResultsMsg
  | MomentMsg
  | ErrorMsg;
export type ServerMsgType = ServerMsg['t'];

/** Pick one message type out of a union by its tag, e.g. MsgOf<ServerMsg, 'phase'>. */
export type MsgOf<U extends { t: string }, T extends U['t']> = Extract<U, { t: T }>;
