/**
 * Wire protocol. JSON text frames, discriminated on `t`.
 * Follows DESIGN.md section 8; additions are listed in docs/DECISIONS.md.
 *
 * Time conventions:
 * - `endsAt`, `serverTime`: server wall-clock ms since epoch (Date.now() on the server).
 * - `ts`, `jailedUntil`: game time in trading days since the start of the game (may be fractional).
 * - `day` (tick, candle, market): 0-based INTEGER trading day since the start of the game.
 */
import type { GameConfig } from './config.ts';
import type {
  Arrest,
  Award,
  Briefing,
  Card,
  EarningsReport,
  CardDirection,
  CardOffer,
  ForcedFillReason,
  LeaderboardEntry,
  LobbyPlayer,
  MarketSnapshot,
  MomentKind,
  OHLC,
  Phase,
  PlayerId,
  Position,
  QuickBet,
  ReadyPhase,
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
  /** Let a single player skip Trading, Results or Shop for this game. */
  debugMode?: boolean;
}

/** Choices offered in the lobby for the game's length. */
export const QUARTER_OPTIONS = [2, 4, 8, 16] as const;
/** Real-time length of a quarter's trading, in seconds. A quarter is always the same number of days. */
export const QUARTER_SECONDS_OPTIONS = [30, 60, 90, 180] as const;

/** Game length, set in the lobby by any player; shared by everyone in it. */
export interface GameSettings {
  quarters: number;
  quarterSeconds: number;
}

/**
 * LOBBY only, any player: change the game's length. Everyone gets a fresh welcome (with the new
 * config) and lobby. Fields left out keep their value.
 */
export interface SetSettingsMsg {
  t: 'set_settings';
  quarters?: number;
  quarterSeconds?: number;
}

/** FINAL only, any player: a fresh game (next seed) with the connected players back in the lobby. */
export interface NewGameMsg {
  t: 'new_game';
}

/** Ends the current game for everyone and opens the final standings. */
export interface EndGameMsg {
  t: 'end_game';
  /** Game number from welcome, so a late request cannot end a different game. */
  game: number;
}

/** Market order. qty < 0 = sell/short. */
export interface OrderMsg {
  t: 'order';
  symbol: SymbolId;
  qty: number;
  /** Optional client request ID echoed on the fill. */
  requestId?: number;
  /**
   * Quick bet (Simple mode): cash this order out by itself at the close of its holdDays-th trading
   * day (the day in progress counts as the first), and at the latest at the end of the quarter.
   */
  holdDays?: number;
}

export interface BuyCardMsg {
  t: 'buy_card';
  offerId: string;
}

/** Marks the player ready to leave this phase of the quarter. */
export interface ReadyUpMsg {
  t: 'ready_up';
  quarter: number;
  phase: ReadyPhase;
}

export interface PlayCardMsg {
  t: 'play_card';
  cardId: string;
  /** Symbol or sector id, depending on the card. */
  target?: string;
  direction?: CardDirection;
}

export type ClientMsg = JoinMsg | StartMsg | SetSettingsMsg | OrderMsg | BuyCardMsg | ReadyUpMsg | PlayCardMsg | NewGameMsg | EndGameMsg;
export type ClientMsgType = ClientMsg['t'];

// ---------------------------------------------------------------------------
// server -> client
// ---------------------------------------------------------------------------

/** Current phase. Also embedded in `welcome` so a (re)joining client is in sync at once. */
export interface PhaseInfo {
  phase: Phase;
  /** Wall-clock ms when the phase ends. null for LOBBY and FINAL (no timer). */
  endsAt: number | null;
  /** 0 in LOBBY, then the current quarter. FINAL keeps the quarter where the game ended. */
  quarter: number;
  totalQuarters: number;
  /** Set when the game was started in debug mode. */
  debugMode?: boolean;
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
  /**
   * Which game of this server run (1, 2, ...). A `welcome` with another number than the client had
   * means "play again" started a new game: drop everything from the old one.
   */
  game?: number;
}

export interface LobbyState {
  players: LobbyPlayer[];
  spectators: number;
  minPlayers: number;
  maxPlayers: number;
  /** The game length the next start will use. */
  settings: GameSettings;
}

/** Roster broadcast: on every join, leave, disconnect and reconnect (in any phase). */
export interface LobbyMsg extends LobbyState {
  t: 'lobby';
}

export interface PhaseMsg extends PhaseInfo {
  t: 'phase';
}

/**
 * Universe + price history. Sent to ONE connection right after every `welcome` (first join,
 * reconnect, spectator, in any phase including LOBBY), so a refresh restores the chart.
 * Never broadcast and never repeated: after it the client keeps itself current with tick/candle.
 * Up to 61 symbols x 360 candles by default, prices rounded with roundPrice().
 */
export interface MarketMsg extends MarketSnapshot {
  t: 'market';
}

/**
 * One shared price tick for everybody: 10 Hz, only while prices move (the TRADING phase).
 * Prices of ALL symbols (stocks and funds), rounded with roundPrice().
 */
export interface TickMsg {
  t: 'tick';
  /** 0-based trading day this tick belongs to (integer; keeps counting across quarters). */
  day: number;
  /** 1..ticksPerCandle within the day. Game time after this tick = day + tickOfDay / ticksPerCandle. */
  tickOfDay: number;
  prices: Record<SymbolId, number>;
}

/**
 * The closed daily candle of every symbol. Sent once per trading day, right after that day's last
 * tick. Days are consecutive (0, 1, 2, ...) across quarters; the server's candle replaces whatever
 * the client built from ticks for that day.
 */
export interface CandleMsg {
  t: 'candle';
  /** 0-based trading day that just closed. */
  day: number;
  ohlc: Record<SymbolId, OHLC>;
}

export interface HeadlineMsg {
  t: 'headline';
  /** Unique per publication (the same template can appear twice in a long game). */
  id: string;
  text: string;
  symbol?: SymbolId;
  sector?: Sector;
  /** Game day (fractional) at which it was published. */
  ts: number;
  /** true = insider preview, sent only to the card holder ahead of the public headline. */
  early?: boolean;
  /** Set on a rate decision: the policy rate it leaves (0.0325 = 3.25%). */
  rate?: number;
}

/** Broadcast when BRIEFING starts, and sent after `welcome` during the quarter it belongs to. */
export interface BriefingMsg extends Briefing {
  t: 'briefing';
}

/**
 * Broadcast at the close of TRADING (right after the RESULTS or FINAL phase message). The latest
 * report is replayed after `welcome`.
 */
export interface EarningsMsg {
  t: 'earnings';
  quarter: number;
  /** Every company, in the same shuffled order on broadcast and reconnect. */
  reports: EarningsReport[];
}

/** Sent to the player whose order was filled. */
export interface FillMsg {
  t: 'fill';
  symbol: SymbolId;
  /** Signed shares: > 0 bought, < 0 sold. */
  qty: number;
  /** Fill price including slippage. */
  price: number;
  /** P&L on the part of the fill that closed an existing position. */
  realizedPnl?: number;
  requestId?: number;
  /** Set when the server traded on the player's behalf (margin call, elimination). */
  reason?: ForcedFillReason;
  /** Game day (fractional) of the fill. */
  ts?: number;
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
  /**
   * Additions to the draft. buyingPower = max(0, leverageCap * equity - gross exposure) at the
   * prices of the moment it was sent; clients recompute it live from ticks with the same formula.
   */
  buyingPower?: number;
  hand?: Card[];
  eliminated?: boolean;
  /** Quick bets still running. */
  bets?: QuickBet[];
  /** Quick bets won in a row (display only: it does not change any payout). */
  streak?: number;
}

/**
 * One player's open positions, broadcast to everybody (players and projector) whenever that player's
 * portfolio changes, and sent for every player on join. Lets each desk show what the others hold.
 */
export interface HoldingsMsg {
  t: 'holdings';
  playerId: PlayerId;
  positions: Position[];
  equity: number;
  eliminated?: boolean;
  /** Game day until which the player is in jail. */
  jailedUntil?: number;
}

export interface NetWorthSample {
  /** Market ticks elapsed since the game opened. Each day has time.ticksPerCandle ticks. */
  readonly tick: number;
  readonly equity: Readonly<Record<PlayerId, number>>;
}

/** Projector-only standings history on join and subsequent live samples. */
export interface NetWorthMsg {
  t: 'net_worth';
  samples: NetWorthSample[];
  reset?: boolean;
}

/** A quick bet settled (sent to its player only). */
export interface BetResultMsg {
  t: 'bet_result';
  symbol: SymbolId;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  /** Wins in a row after this one (0 after a loss). */
  streak: number;
}

/** Sent per player (prices scale with the buyer's net worth). */
export interface PendingOrderMsg {
  t: 'pending_order';
  order: { symbol: SymbolId; qty: number; remainingMs: number } | null;
  cancelled?: boolean;
}

export interface ShopMsg {
  t: 'shop';
  offers: CardOffer[];
}

export interface PhaseReadyMsg {
  t: 'phase_ready';
  readyPlayerIds: PlayerId[];
}

export interface ResultsMsg {
  t: 'results';
  leaderboard: LeaderboardEntry[];
  statements: Statement[];
  recap: Recap;
  arrests: Arrest[];
  /** Opening balance through settlement for the completed quarter, one sample per market tick. */
  netWorthHistory?: NetWorthSample[];
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
  | PendingOrderMsg
  | WelcomeMsg
  | LobbyMsg
  | PhaseMsg
  | MarketMsg
  | TickMsg
  | CandleMsg
  | HeadlineMsg
  | BriefingMsg
  | EarningsMsg
  | FillMsg
  | BetResultMsg
  | PortfolioMsg
  | HoldingsMsg
  | NetWorthMsg
  | ShopMsg
  | PhaseReadyMsg
  | ResultsMsg
  | MomentMsg
  | ErrorMsg;
export type ServerMsgType = ServerMsg['t'];

/** Pick one message type out of a union by its tag, e.g. MsgOf<ServerMsg, 'phase'>. */
export type MsgOf<U extends { t: string }, T extends U['t']> = Extract<U, { t: T }>;
