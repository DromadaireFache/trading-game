/**
 * Domain types shared by sim, server and client.
 * Pure types and constant tables only: no numbers that need tuning (those live in config.ts).
 */

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** LOBBY -> [BRIEFING -> TRADING -> EARNINGS -> RESULTS -> SHOP] x N -> FINAL */
export const PHASES = ['LOBBY', 'BRIEFING', 'TRADING', 'EARNINGS', 'RESULTS', 'SHOP', 'FINAL'] as const;
export type Phase = (typeof PHASES)[number];

/** The phases that repeat every quarter, in order. */
export const QUARTER_PHASES = ['BRIEFING', 'TRADING', 'EARNINGS', 'RESULTS', 'SHOP'] as const;
export type QuarterPhase = (typeof QUARTER_PHASES)[number];

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export type PlayerId = string;
/** Ticker of a stock or a fund, e.g. "ACME". */
export type SymbolId = string;

export type Role = 'player' | 'spectator';

// ---------------------------------------------------------------------------
// Universe (DESIGN.md section 3)
// ---------------------------------------------------------------------------

/** 10 sectors. Display names are the design track's call; ids are stable. */
export const SECTORS = [
  'tech',
  'energy',
  'defense',
  'airlines',
  'tourism',
  'finance',
  'health',
  'consumer',
  'industrials',
  'materials',
] as const;
export type Sector = (typeof SECTORS)[number];

/** Display names of the sectors (design track: change freely, the ids above are the contract). */
export const SECTOR_LABELS: Record<Sector, string> = {
  tech: 'Technology',
  energy: 'Energy',
  defense: 'Defense',
  airlines: 'Airlines',
  tourism: 'Tourism',
  finance: 'Finance',
  health: 'Healthcare',
  consumer: 'Consumer',
  industrials: 'Industrials',
  materials: 'Materials',
};

export interface Fundamentals {
  /** Annual revenue, $. */
  revenue: number;
  /** Net margin as a fraction, e.g. 0.12. */
  margin: number;
  /** Total debt, $. */
  debt: number;
  /** Shares outstanding. marketCap = shares * start price. */
  shares: number;
}

/**
 * A fake company with ALL its sim parameters. SERVER-SIDE ONLY: betaM, betaS, sigmaI,
 * rateSensitivity and fundamentals are hidden game information and never go on the wire
 * (clients get SymbolInfo). The ticker is called `symbol` everywhere.
 */
export interface Company {
  symbol: SymbolId;
  name: string;
  sector: Sector;
  /** Fake CEO name (headline templates use it). */
  ceo: string;
  /** Loading on the market factor M. */
  betaM: number;
  /** Loading on the factor of its own sector S[sector]. */
  betaS: number;
  /** Idiosyncratic volatility per trading day (log-return std-dev). */
  sigmaI: number;
  /** Log-return per unit of rate change: r += rateSensitivity * dRate. Usually negative. */
  rateSensitivity: number;
  /** Market cap in $ at game start (static; used for scale, fund weights and adv). */
  marketCap: number;
  /** Average daily dollar volume. */
  adv: number;
  /** Price at game start. */
  startPrice: number;
  fundamentals: Fundamentals;
}

/**
 * Index fund (all companies) or sector fund (the companies of one sector).
 * Price = sum over i of units[i] * mid(members[i]): a fixed basket, no rebalancing.
 * units are chosen so the fund starts at config.market.fundStartPrice with the given start weights.
 */
export interface Fund {
  symbol: SymbolId;
  name: string;
  kind: 'index' | 'sector';
  /** Set for sector funds. */
  sector?: Sector;
  members: SymbolId[];
  /** Start weights, parallel to members, summing to 1. */
  weights: number[];
  /** Shares of each member per fund unit, parallel to members: startPrice * weights[i] / startPrice(members[i]). */
  units: number[];
  /** Sum of the members' market caps (shown as the fund's size). */
  marketCap: number;
  /** Average daily dollar volume of the fund itself (trading a fund has its own impact). */
  adv: number;
  startPrice: number;
}

export type SymbolKind = 'stock' | 'index' | 'sector';

/** PUBLIC description of a tradable symbol: everything a client may know. */
export interface SymbolInfo {
  symbol: SymbolId;
  name: string;
  /** stock = company; index = the index fund; sector = a sector fund. */
  kind: SymbolKind;
  /** Stocks and sector funds; undefined for the index fund. */
  sector?: Sector;
  marketCap: number;
  /** Stocks only. */
  ceo?: string;
  /** Funds only: member tickers. */
  members?: SymbolId[];
}

/**
 * PUBLIC universe sent to clients. `symbols` is in CANONICAL ORDER, the same in the sim and on
 * every client: the index fund, the sector funds in SECTORS order, then the companies sector by
 * sector in SECTORS order. 61 entries with the default config.
 */
export interface UniverseInfo {
  symbols: SymbolInfo[];
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export interface OHLC {
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Everything a client needs to draw the market from nothing (join, reconnect, refresh).
 * The sim returns it unrounded from Sim.getMarketSnapshot(); the server rounds it for the wire
 * (roundSnapshot in shared/market.ts).
 *
 * Days are 0-based trading days since game start and keep counting across quarters:
 * day d belongs to quarter floor(d / daysPerQuarter) + 1 (helpers in shared/market.ts).
 */
export interface MarketSnapshot {
  universe: UniverseInfo;
  /** The trading day in progress, or the next one to start when no day is open (= number of closed days). */
  day: number;
  /** Ticks already played of `day`: 0 when no day is in progress, else 1..ticksPerCandle-1. */
  tickOfDay: number;
  /** Latest price of every symbol (the start prices before the first tick). */
  prices: Record<SymbolId, number>;
  /**
   * Closed daily candles of days 0..day-1 per symbol, flat: [o0, h0, l0, c0, o1, h1, l1, c1, ...].
   * Every symbol has exactly `day` candles (4 * day numbers). Use unpackCandles() from shared.
   */
  candles: Record<SymbolId, number[]>;
  /** The partial candle of `day` when tickOfDay > 0, else null. */
  current: Record<SymbolId, OHLC> | null;
}

// ---------------------------------------------------------------------------
// Portfolio (DESIGN.md section 4)
// ---------------------------------------------------------------------------

export interface Position {
  symbol: SymbolId;
  /** Signed: negative = short. */
  qty: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
  /** P&L already banked on this symbol this game (partial closes, flips, borrow fees excluded). */
  realized?: number;
}

/** Why a fill happened when the player did not ask for it. */
export type ForcedFillReason = 'margin_call' | 'elimination' | 'timed';

/** A quick bet still running (Simple mode): it cashes out by itself at the close of `closeAtDay`. */
export interface QuickBet {
  symbol: SymbolId;
  /** Signed shares of the bet (> 0 = UP). */
  qty: number;
  entryPrice: number;
  /** Game day whose close settles it. */
  closeAtDay: number;
}

// ---------------------------------------------------------------------------
// Headlines (DESIGN.md section 7)
// ---------------------------------------------------------------------------

export type HeadlineScope = 'market' | 'sector' | 'stock';
export type HeadlineDirection = 'up' | 'down' | 'neutral';
export type HeadlineMagnitude = 'small' | 'medium' | 'large' | 'huge';
export type HeadlineCategory =
  | 'earnings_leak'
  | 'contract'
  | 'legal'
  | 'exec'
  | 'macro'
  | 'product'
  | 'absurd'
  | 'regime_followup';
export type HeadlineKind = 'real' | 'fake_template' | 'debunk' | 'event';

/** A scheduled beat announced at BRIEFING: its day is known, its direction is not. */
export interface ScheduledBeat {
  /** Game day (0-based trading day since the start) it lands on. */
  day: number;
  title: string;
}

/** What every player learns at BRIEFING. */
export interface Briefing {
  quarter: number;
  /** Policy rate at the start of the quarter (0.03 = 3%). */
  rate: number;
  beats: ScheduledBeat[];
  /** Names of the regimes running this quarter (M5). */
  regimes: string[];
  /**
   * Earnings consensus: the quarter's expected EPS per company, $ per share (revenue * margin / 4 /
   * shares). At EARNINGS a company beats or misses it by its hidden surprise.
   */
  consensus?: Record<SymbolId, number>;
}

/** One company's quarter result at EARNINGS. */
export interface EarningsReport {
  symbol: SymbolId;
  /** EPS against consensus: +0.08 = beat by 8%. */
  surprise: number;
  /** Log-return still to come at the next open: gapFactor * (surprise - what leaks priced in). */
  gap: number;
}

/** One entry of headlines.json. `text` may contain placeholders such as {COMPANY}. */
export interface HeadlineTemplate {
  id: string;
  text: string;
  scope: HeadlineScope;
  /** Required for generated stock and sector headlines. Omitted by generic seed templates. */
  sector?: Sector;
  direction: HeadlineDirection;
  magnitude: HeadlineMagnitude;
  category: HeadlineCategory;
  kind: HeadlineKind;
}

// ---------------------------------------------------------------------------
// Regimes (DESIGN.md section 5)
// ---------------------------------------------------------------------------

export interface Regime {
  id: string;
  name: string;
  /** Player who played the card; undefined for engine-made regimes. */
  ownerId?: PlayerId;
  quartersLeft: number;
  sectorDrift: Partial<Record<Sector, number>>;
  volMult: number;
  corrMult: number;
  rateDelta?: number;
  /** Follow-up headlines it drips out over time. */
  headlines: string[];
}

// ---------------------------------------------------------------------------
// Cards (DESIGN.md section 5)
// ---------------------------------------------------------------------------

export type CardTier = 'insider' | 'fake' | 'event' | 'regime' | 'counter';

/** Static description of a card type. */
export interface CardDef {
  /** Card type id, e.g. "insider_tip". */
  defId: string;
  tier: CardTier;
  name: string;
  description: string;
  legal: boolean;
  /** What the player must choose when playing it. */
  targetKind: 'none' | 'stock' | 'sector';
  /** True when the player also picks up/down. */
  needsDirection: boolean;
}

/** A card for sale in the SHOP phase. Price already scaled to the buyer. */
export interface CardOffer {
  offerId: string;
  card: CardDef;
  price: number;
}

/** A card in a player's hand. */
export interface Card {
  cardId: string;
  card: CardDef;
}

export type CardDirection = 'up' | 'down';

// ---------------------------------------------------------------------------
// Results (DESIGN.md sections 5 and 6)
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  playerId: PlayerId;
  name: string;
  netWorth: number;
  /** Net worth change over the quarter. */
  pnl: number;
  eliminated: boolean;
  jailed: boolean;
}

export interface TradeSummary {
  symbol: SymbolId;
  pnl: number;
}

/** Per-player quarter statement. */
export interface Statement {
  playerId: PlayerId;
  startEquity: number;
  endEquity: number;
  pnl: number;
  fines: number;
  cardSpend: number;
  bestTrade?: TradeSummary;
  worstTrade?: TradeSummary;
}

export interface RecapCause {
  kind: 'headline' | 'regime' | 'earnings' | 'card' | 'noise';
  /** Headline id or regime id when there is one. */
  id?: string;
  text: string;
}

export interface RecapMove {
  kind: 'sector' | 'stock';
  /** Sector id or symbol. */
  target: string;
  /** Fractional change over the quarter, e.g. 0.12 = +12%. */
  change: number;
  cause: RecapCause;
}

/** "Card authors revealed" at RESULTS. */
export interface CardReveal {
  playerId: PlayerId;
  name: string;
  cardName: string;
  text: string;
}

/** Market-level recap only. */
export interface Recap {
  quarter: number;
  topMoves: RecapMove[];
  cardAuthors: CardReveal[];
}

export interface Arrest {
  playerId: PlayerId;
  name: string;
  reason: string;
  fine: number;
  jailDays: number;
  /** Ready-to-show line, e.g. "Player 7 arrested for insider trading. 45 days." */
  text: string;
}

/** Final screen awards ("Most chaos", "Best short", ...). */
export interface Award {
  title: string;
  playerId: PlayerId;
  name: string;
  detail: string;
}

export type MomentKind = 'regime' | 'crash' | 'arrest';

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
}
