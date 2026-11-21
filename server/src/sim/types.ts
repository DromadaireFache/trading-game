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
  Card,
  CardDirection,
  CardOffer,
  GameConfig,
  LeaderboardEntry,
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
  // --- later milestones (the stub rejects them) ---
  | { kind: 'order'; playerId: PlayerId; symbol: SymbolId; qty: number }
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
  | 'not_implemented';

export type SimEvent =
  /** A new phase began on this tick. durationTicks is null for LOBBY and FINAL. */
  | { e: 'phase'; phase: Phase; quarter: number; durationTicks: number | null }
  /** An intent was refused. The shell forwards it to that player as an `error` message. */
  | { e: 'reject'; playerId: PlayerId; intent: SimIntentKind; code: SimRejectCode; message: string }
  // --- later milestones: shapes mirror the wire messages in @tg/shared ---
  | { e: 'tick'; day: number; prices: Record<SymbolId, number> }
  | { e: 'candle'; day: number; ohlc: Record<SymbolId, OHLC> }
  /** `to` set = private (insider preview with early: true); unset = broadcast. */
  | { e: 'headline'; to?: PlayerId; id: string; text: string; symbol?: SymbolId; sector?: Sector; ts: number; early?: boolean }
  | { e: 'fill'; playerId: PlayerId; symbol: SymbolId; qty: number; price: number }
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
}

export type CreateSim = (seed: number, config: GameConfig) => Sim;
