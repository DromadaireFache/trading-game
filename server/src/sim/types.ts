/**
 * Public contract of the pure sim.
 *
 * PURITY RULES for everything under server/src/sim:
 *   no Date.now, no Math.random, no timers, no fs, no ws, no console, no process.
 *   Import only from '@tg/shared' and from inside this folder. Randomness comes from ./rng.ts.
 *
 * The sim knows nothing about wall-clock time or sockets. It counts ticks; the server shell
 * turns ticks into `endsAt` and SimEvents into wire messages.
 */
import type {
  Arrest,
  Award,
  Briefing,
  Card,
  EarningsReport,
  CardDirection,
  CardOffer,
  ForcedFillReason,
  GameConfig,
  LeaderboardEntry,
  MarketSnapshot,
  MomentKind,
  OHLC,
  Phase,
  PlayerId,
  Position,
  Recap,
  Sector,
  Statement,
  SymbolId,
} from '@tg/shared';
import type { HeadlineTemplate } from '@tg/shared';
import type { PlaceholderLists } from './headlines.ts';
import type { News } from './news.ts';
import type { Universe } from './universe.ts';

// ---------------------------------------------------------------------------
// Intents: plain objects, queued by submit(), processed in arrival order at the next tick()
// ---------------------------------------------------------------------------

export type SimIntent =
  /** LOBBY only. The shell guarantees unique ids and names. */
  | { kind: 'add_player'; playerId: PlayerId; name: string }
  /** LOBBY only (a player who leaves before the game starts). */
  | { kind: 'remove_player'; playerId: PlayerId }
  /** LOBBY only; needs config.lobby.minPlayers players. */
  | { kind: 'start'; playerId: PlayerId }
  /** TRADING only. qty in shares, < 0 = sell/short; truncated to whole shares. */
  | { kind: 'order'; playerId: PlayerId; symbol: SymbolId; qty: number }
  // --- later milestones (the stub rejects them) ---
  | { kind: 'buy_card'; playerId: PlayerId; offerId: string }
  | { kind: 'play_card'; playerId: PlayerId; cardId: string; target?: string; direction?: CardDirection };

export type SimIntentKind = SimIntent['kind'];

// ---------------------------------------------------------------------------
// Events: plain objects returned by tick(), in the order they happened
// ---------------------------------------------------------------------------

export type SimRejectCode =
  | 'wrong_phase'
  | 'unknown_player'
  | 'not_enough_players'
  | 'game_full'
  | 'invalid'
  | 'unknown_symbol'
  | 'insufficient_buying_power'
  | 'eliminated'
  | 'not_implemented';

export type SimEvent =
  /** A new phase began on this tick. durationTicks is null for LOBBY and FINAL. */
  | { e: 'phase'; phase: Phase; quarter: number; durationTicks: number | null }
  /** An intent was refused. The shell forwards it to that player as an `error` message. */
  | { e: 'reject'; playerId: PlayerId; intent: SimIntentKind; code: SimRejectCode; message: string }
  /**
   * Market (milestone 2). Only while prices move, i.e. once per tick() during TRADING: all symbols,
   * UNROUNDED (the shell rounds with roundPrice). `day` = 0-based trading day since game start,
   * continuing across quarters; `tickOfDay` = 1..ticksPerCandle.
   */
  | { e: 'tick'; day: number; tickOfDay: number; prices: Record<SymbolId, number> }
  /** The closed candle of `day`, in the same tick() result right after that day's last `tick` event. */
  | { e: 'candle'; day: number; ohlc: Record<SymbolId, OHLC> }
  // --- later milestones: shapes mirror the wire messages in @tg/shared ---
  /** `to` set = private (insider preview with early: true); unset = broadcast. */
  | { e: 'headline'; to?: PlayerId; id: string; text: string; symbol?: SymbolId; sector?: Sector; ts: number; early?: boolean; rate?: number }
  /** Milestone 4: right after the BRIEFING phase event. */
  | ({ e: 'briefing' } & Briefing)
  /** Milestone 4: right after the EARNINGS phase event. Gaps show at the next quarter's first tick. */
  | { e: 'earnings'; quarter: number; reports: EarningsReport[] }
  /** Milestone 3: a market order (or a forced close) was filled. Price unrounded. */
  | { e: 'fill'; playerId: PlayerId; symbol: SymbolId; qty: number; price: number; ts: number; reason?: ForcedFillReason }
  | {
      e: 'portfolio';
      playerId: PlayerId;
      cash: number;
      positions: Position[];
      equity: number;
      heat: number;
      jailedUntil?: number;
      buyingPower?: number;
      hand?: Card[];
      eliminated?: boolean;
    }
  | { e: 'shop'; playerId: PlayerId; offers: CardOffer[] }
  | {
      e: 'results';
      leaderboard: LeaderboardEntry[];
      statements: Statement[];
      recap: Recap;
      arrests: Arrest[];
      final?: boolean;
      awards?: Award[];
    }
  | { e: 'moment'; kind: MomentKind; text: string };

export type SimEventType = SimEvent['e'];
export type SimEventOf<T extends SimEventType> = Extract<SimEvent, { e: T }>;

// ---------------------------------------------------------------------------
// State snapshot
// ---------------------------------------------------------------------------

export interface SimPlayer {
  id: PlayerId;
  name: string;
}

/** Read-only view of where the sim is. Used by the shell for welcome/reconnect snapshots. */
export interface SimState {
  phase: Phase;
  /** 0 in LOBBY, then 1..config.time.quarters. Stays at the last quarter in FINAL. */
  quarter: number;
  /** Number of tick() calls so far. */
  tick: number;
  /** Ticks already spent in the current phase (0 right after the phase event). */
  phaseTick: number;
  /** Length of the current phase in ticks; null for LOBBY and FINAL. */
  phaseTicks: number | null;
  /** Ticks until the next phase; null for LOBBY and FINAL. */
  ticksLeft: number | null;
  players: SimPlayer[];
}

// ---------------------------------------------------------------------------
// The sim
// ---------------------------------------------------------------------------

export interface Sim {
  readonly seed: number;
  readonly config: GameConfig;
  /** Queue an intent. Nothing happens until the next tick(). */
  submit(intent: SimIntent): void;
  /**
   * Advance one tick (config.time.tickMs of game time):
   *   1. process queued intents in arrival order,
   *   2. advance the clock / phase machine (time does not advance in LOBBY and FINAL),
   *   3. return every event produced, in order.
   * Same seed + config + same intents on the same ticks => identical events.
   */
  tick(): SimEvent[];
  getState(): SimState;
  /**
   * The full universe INCLUDING hidden parameters (betas, sigma, fundamentals). For the sim's own
   * subsystems, tests and the balance harness. The shell must never send it: clients get
   * getMarketSnapshot().universe.
   */
  getUniverse(): Universe;
  /**
   * Public universe + closed candles since day 0 + current prices (+ the partial candle of the day in
   * progress), unrounded. Valid in every phase (in LOBBY: start prices, no candles). The shell sends
   * it, rounded, as the `market` message after each `welcome`. Returns fresh objects.
   */
  getMarketSnapshot(): MarketSnapshot;
  /**
   * A player's portfolio at current prices (unrounded), or undefined for an unknown player.
   * The shell sends it after `welcome` so a reconnect restores cash and positions at once.
   */
  getPortfolio(playerId: PlayerId): SimEventOf<'portfolio'> | undefined;
  /**
   * The latest `results` event (a quarter's, or the final one with awards), or null before the first
   * RESULTS. The shell sends it to a player who (re)joins during RESULTS, SHOP or FINAL.
   */
  getResults(): SimEventOf<'results'> | null;
  /**
   * What a (re)joining client needs to show the news: this quarter's briefing, the latest earnings
   * (until the next BRIEFING) and the last config.news.replayHeadlines public headlines, oldest first.
   */
  getNewsSnapshot(): {
    briefing: SimEventOf<'briefing'> | null;
    earnings: SimEventOf<'earnings'> | null;
    headlines: SimEventOf<'headline'>[];
  };
  /** The news engine (published headlines with their causes, the queue, earnings plan). */
  readonly news: News;
}

export interface SimOptions {
  /** Headline database (default: shared/data via ./data/headlineData.ts). */
  headlines?: readonly HeadlineTemplate[];
  /** Placeholder fill lists (default: shared/data/placeholders.json). */
  placeholders?: PlaceholderLists;
}

export type CreateSim = (seed: number, config: GameConfig, options?: SimOptions) => Sim;
