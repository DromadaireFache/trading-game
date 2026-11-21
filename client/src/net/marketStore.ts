/**
 * Client-side market data: universe, latest prices, closed daily candles and the live candle of the
 * day in progress. One instance per GameClient (`client.market`).
 *
 * It is NOT part of GameState on purpose: 61 symbols tick at 10 Hz, and folding that into the React
 * state would re-render the whole app ten times a second. Instead consumers subscribe to exactly what
 * they show:
 *   - subscribeUniverse / getSymbols   the symbol list (changes only with a `market` snapshot)
 *   - subscribeSymbol / getQuote       one symbol's price + quarter-open reference (a list row, a header)
 *   - subscribeSelection / getSelected the selected symbol (shared by list, chart, later the order panel)
 *   - subscribeFeed                    every market message, for charts that draw outside React
 * Listeners of a symbol are only called when that symbol's quote really changed.
 *
 * Pure apart from the optional storage for the selected symbol; no sockets, no clocks.
 */
import { CANDLE_FIELDS, candleAt, dayToQuarter, defaultConfig, quarterFirstDay } from '@tg/shared';
import type { CandleMsg, GameConfig, MarketMsg, OHLC, SymbolId, SymbolInfo, TickMsg } from '@tg/shared';
import type { SessionStorageLike } from './session.ts';

/** What a price cell shows. A new object is made only when price or ref changes. */
export interface Quote {
  readonly price: number;
  /** Open of the current quarter's first day (the price itself before the first candle). */
  readonly ref: number;
}

/** Fractional change since the quarter open, e.g. 0.05 = +5%. */
export function quoteChange(quote: Quote): number {
  return quote.ref > 0 ? quote.price / quote.ref - 1 : 0;
}

export type FeedEvent =
  /** A snapshot replaced everything: redraw from scratch. */
  | { kind: 'reset' }
  /** The live candle of `day` moved. */
  | { kind: 'tick'; day: number }
  /** `day` closed; its candle is now in the closed history. */
  | { kind: 'candle'; day: number };

type Listener = () => void;

const NO_SYMBOLS: readonly SymbolInfo[] = [];
const NO_CANDLES: readonly number[] = [];
const selectionKey = (scope: string) => `tg.symbol.${scope}`;

export class MarketStore {
  private config: GameConfig = defaultConfig;
  private symbols: readonly SymbolInfo[] = NO_SYMBOLS;
  private bySymbol = new Map<SymbolId, SymbolInfo>();
  private prices: Record<SymbolId, number> = {};
  /** Closed candles per symbol, flat [o,h,l,c,...]; element i is day i. */
  private closed = new Map<SymbolId, number[]>();
  private closedDays = 0;
  /** Candle of the day in progress, built from ticks (or taken from the snapshot). */
  private live: Record<SymbolId, OHLC> | null = null;
  private liveDay = -1;

  private quotes = new Map<SymbolId, Quote>();
  /** Day whose open is the reference of `refOpens`; null = recompute. */
  private refDay: number | null = null;
  private refOpens: Record<SymbolId, number> = {};

  private selected: SymbolId | null = null;

  private readonly universeListeners = new Set<Listener>();
  private readonly selectionListeners = new Set<Listener>();
  private readonly symbolListeners = new Map<SymbolId, Set<Listener>>();
  private readonly feedListeners = new Set<(event: FeedEvent) => void>();

  /**
   * @param storage where the selected symbol is remembered across a refresh (null = nowhere)
   * @param scope   separates /play from /floor in that storage
   */
  constructor(
    private readonly storage: SessionStorageLike | null = null,
    private readonly scope = 'player',
  ) {}

  // --- input ---------------------------------------------------------------

  /** The effective config from `welcome` (quarter length for the reference open). */
  setConfig(config: GameConfig): void {
    if (config === this.config) return;
    this.config = config;
    this.refDay = null;
    this.refreshQuotes();
  }

  apply(msg: MarketMsg | TickMsg | CandleMsg): void {
    if (msg.t === 'market') this.applySnapshot(msg);
    else if (msg.t === 'tick') this.applyTick(msg);
    else this.applyCandle(msg);
  }

  private applySnapshot(msg: MarketMsg): void {
    const symbols = Array.isArray(msg.universe?.symbols) ? msg.universe.symbols : [];
    this.symbols = symbols;
    this.bySymbol = new Map(symbols.map((s) => [s.symbol, s]));
    this.prices = { ...msg.prices };
    this.closed = new Map();
    for (const symbol in msg.candles) this.closed.set(symbol, msg.candles[symbol]!);
    this.closedDays = Math.max(0, Math.floor(msg.day));
    if (msg.current && msg.tickOfDay > 0) {
      this.live = msg.current;
      this.liveDay = this.closedDays;
    } else {
      this.live = null;
      this.liveDay = -1;
    }
    this.refDay = null;

    if (this.selected === null || !this.bySymbol.has(this.selected)) {
      const stored = this.loadSelection();
      this.selected = stored !== null && this.bySymbol.has(stored) ? stored : (symbols[0]?.symbol ?? null);
      emit(this.selectionListeners);
    }
    emit(this.universeListeners);
    this.refreshQuotes();
    this.emitFeed({ kind: 'reset' });
  }

  private applyTick(msg: TickMsg): void {
    const day = msg.day;
    // A tick of a day that already closed cannot extend a candle; its prices still count.
    const extendsCandle = day >= this.closedDays;
    if (extendsCandle && (this.live === null || this.liveDay !== day)) {
      this.live = {};
      this.liveDay = day;
    }
    const live = extendsCandle ? this.live : null;
    for (const symbol in msg.prices) {
      const price = msg.prices[symbol]!;
      this.prices[symbol] = price;
      if (!live) continue;
      const candle = live[symbol];
      if (!candle) {
        live[symbol] = { o: price, h: price, l: price, c: price };
      } else {
        if (price > candle.h) candle.h = price;
        if (price < candle.l) candle.l = price;
        candle.c = price;
      }
    }
    this.refreshQuotes();
    if (extendsCandle) this.emitFeed({ kind: 'tick', day });
  }

  private applyCandle(msg: CandleMsg): void {
    const day = msg.day;
    const at = day * CANDLE_FIELDS;
    for (const symbol in msg.ohlc) {
      const candle = msg.ohlc[symbol]!;
      let flat = this.closed.get(symbol);
      if (!flat) {
        flat = [];
        this.closed.set(symbol, flat);
      }
      // Days we never saw (should not happen: a reconnect brings a snapshot) become flat candles,
      // so index == day keeps holding.
      while (flat.length < at) {
        const fill = flat.length > 0 ? flat[flat.length - 1]! : candle.o;
        flat.push(fill, fill, fill, fill);
      }
      flat[at] = candle.o;
      flat[at + 1] = candle.h;
      flat[at + 2] = candle.l;
      flat[at + 3] = candle.c;
      this.prices[symbol] = candle.c;
    }
    if (day + 1 > this.closedDays) this.closedDays = day + 1;
    if (this.live !== null && this.liveDay <= day) {
      this.live = null;
      this.liveDay = -1;
    }
    // The server's candle is authoritative, also for the reference open.
    if (this.refDay === day) this.refDay = null;
    this.refreshQuotes();
    this.emitFeed({ kind: 'candle', day });
  }

  // --- reads ---------------------------------------------------------------

  getConfig = (): GameConfig => this.config;

  /** Canonical order: index fund, sector funds, then companies sector by sector. Stable between snapshots. */
  getSymbols = (): readonly SymbolInfo[] => this.symbols;

  getInfo(symbol: SymbolId): SymbolInfo | undefined {
    return this.bySymbol.get(symbol);
  }

  getQuote(symbol: SymbolId): Quote | undefined {
    return this.quotes.get(symbol);
  }

  /** Closed candles of a symbol, flat [o,h,l,c,...] (element i = day i). Do not modify. */
  getClosedCandles(symbol: SymbolId): readonly number[] {
    return this.closed.get(symbol) ?? NO_CANDLES;
  }

  /** The candle of the day in progress, with its day; null between days and outside TRADING. */
  getLiveCandle(symbol: SymbolId): { day: number; candle: OHLC } | null {
    const candle = this.live?.[symbol];
    return candle ? { day: this.liveDay, candle } : null;
  }

  /** The latest day with any data (live or closed); -1 before the first tick of the game. */
  getLastDay(): number {
    return this.live !== null ? this.liveDay : this.closedDays - 1;
  }

  getSelected = (): SymbolId | null => this.selected;

  select(symbol: SymbolId): void {
    if (symbol === this.selected || !this.bySymbol.has(symbol)) return;
    this.selected = symbol;
    try {
      this.storage?.setItem(selectionKey(this.scope), symbol);
    } catch {
      // storage full or blocked: the selection just does not survive a refresh
    }
    emit(this.selectionListeners);
  }

  // --- subscriptions -------------------------------------------------------

  subscribeUniverse = (listener: Listener): (() => void) => {
    this.universeListeners.add(listener);
    return () => this.universeListeners.delete(listener);
  };

  subscribeSelection = (listener: Listener): (() => void) => {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  };

  subscribeSymbol(symbol: SymbolId, listener: Listener): () => void {
    let set = this.symbolListeners.get(symbol);
    if (!set) {
      set = new Set();
      this.symbolListeners.set(symbol, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.symbolListeners.get(symbol) === set) this.symbolListeners.delete(symbol);
    };
  }

  subscribeFeed = (listener: (event: FeedEvent) => void): (() => void) => {
    this.feedListeners.add(listener);
    return () => this.feedListeners.delete(listener);
  };

  // --- internals -----------------------------------------------------------

  /** Reference = open of the first day of the quarter the latest day belongs to. */
  private ensureRefs(): void {
    const lastDay = this.getLastDay();
    const refDay = lastDay < 0 ? -1 : quarterFirstDay(this.config, dayToQuarter(this.config, lastDay));
    if (refDay === this.refDay) return;
    this.refDay = refDay;
    const opens: Record<SymbolId, number> = {};
    if (refDay >= 0) {
      const fromLive = this.live !== null && this.liveDay === refDay ? this.live : null;
      for (const symbol in this.prices) {
        const open = fromLive ? fromLive[symbol]?.o : candleAt(this.getClosedCandles(symbol), refDay)?.o;
        if (open !== undefined) opens[symbol] = open;
      }
    }
    this.refOpens = opens;
  }

  /** Rebuilds the quotes that changed and tells only their listeners. */
  private refreshQuotes(): void {
    this.ensureRefs();
    for (const symbol in this.prices) {
      const price = this.prices[symbol]!;
      const ref = this.refOpens[symbol] ?? price;
      const old = this.quotes.get(symbol);
      if (old && old.price === price && old.ref === ref) continue;
      this.quotes.set(symbol, { price, ref });
      const listeners = this.symbolListeners.get(symbol);
      if (listeners) emit(listeners);
    }
  }

  private emitFeed(event: FeedEvent): void {
    for (const listener of [...this.feedListeners]) listener(event);
  }

  private loadSelection(): SymbolId | null {
    try {
      return this.storage?.getItem(selectionKey(this.scope)) ?? null;
    } catch {
      return null;
    }
  }
}

function emit(listeners: Set<Listener>): void {
  for (const listener of [...listeners]) listener();
}
