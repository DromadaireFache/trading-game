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

export interface Fundamentals {
  revenue: number;
  margin: number;
  debt: number;
  shares: number;
}

export interface Company {
  symbol: SymbolId;
  name: string;
  sector: Sector;
  betaM: number;
  betaS: number;
  sigmaI: number;
  rateSensitivity: number;
  marketCap: number;
  /** Average daily dollar volume. */
  adv: number;
  fundamentals: Fundamentals;
}

export interface Fund {
  symbol: SymbolId;
  name: string;
  kind: 'index' | 'sector';
  /** Set for sector funds. */
  sector?: Sector;
  members: SymbolId[];
}

/** What a client needs to list a tradable symbol. */
export interface SymbolInfo {
  symbol: SymbolId;
  name: string;
  kind: 'stock' | 'fund';
  sector?: Sector;
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

// ---------------------------------------------------------------------------
// Portfolio (DESIGN.md section 4)
// ---------------------------------------------------------------------------

export interface Position {
  symbol: SymbolId;
  /** Signed: negative = short. */
  qty: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
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

/** One entry of headlines.json. `text` may contain placeholders such as {COMPANY}. */
export interface HeadlineTemplate {
  id: string;
  text: string;
  scope: HeadlineScope;
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
