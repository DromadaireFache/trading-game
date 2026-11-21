/**
 * Results, final screen and projector moments (DESIGN.md section 6). Pure: no randomness, no I/O.
 *
 * createSim feeds it:
 *   startQuarter(q)       at BRIEFING: quarter-open prices, equity and positions
 *   recordFill(fill)      every fill (orders and forced closes)
 *   recordEarnings(...)   at EARNINGS: the gaps land at the NEXT quarter's open, so they explain its moves
 *   onCandle(...)         every closed day: may return a crash moment
 *   closeQuarter(...)     at RESULTS: the `results` event (leaderboard, statements, recap)
 *   final(...)            at FINAL: the `results` event with final: true and awards
 *
 * Recap (market-level only): the 3 biggest quarter moves among sector funds and stocks, at most one per
 * sector, each with the cause that explains most of it. A cause is a published headline (or card /
 * regime item) on the stock, its sector or the whole market, or an earnings gap, with the same sign as
 * the move. Its contribution is its log-move, weighted by the stock's share of the fund for a sector
 * move. If nothing explains at least NOISE_SHARE of the move, the cause is 'noise'.
 *
 * Per player: best and worst trade of the quarter. A trade = one symbol over the quarter:
 *   pnl = end qty * end price - start qty * start price - sum(fill qty * fill price)     (fees excluded)
 *
 * M5 fills the inputs that are zero / empty here (arrests, fines, card spend, jail) through `extra`.
 */
import type {
  Arrest,
  Award,
  CardReveal,
  EarningsReport,
  GameConfig,
  LeaderboardEntry,
  PlayerId,
  Position,
  RecapCause,
  RecapMove,
  Sector,
  Statement,
  SymbolId,
  TradeSummary,
} from '@tg/shared';
import { SECTOR_LABELS } from '@tg/shared';
import type { PublishedHeadline } from './news.ts';
import type { SimEventOf, SimPlayer } from './types.ts';
import type { Universe } from './universe.ts';

export type ResultsEvent = SimEventOf<'results'>;
export type MomentEvent = SimEventOf<'moment'>;

/** Below this share of the move, no single cause explains it. */
const NOISE_SHARE = 0.25;
/** Moves in the recap. */
const TOP_MOVES = 3;

export interface ResultsDeps {
  config: GameConfig;
  universe: Universe;
  priceOf(symbol: SymbolId): number | undefined;
  players(): readonly SimPlayer[];
  equityOf(id: PlayerId): number;
  positionsOf(id: PlayerId): Position[];
  eliminatedOf(id: PlayerId): boolean;
}

/** What M5 (cards, SEC) adds to a quarter's results. */
export interface QuarterExtra {
  arrests?: Arrest[];
  fines?: Partial<Record<PlayerId, number>>;
  cardSpend?: Partial<Record<PlayerId, number>>;
  jailed?: Partial<Record<PlayerId, boolean>>;
  /** Card name per published headline id, for "card authors revealed". */
  cardNames?: Partial<Record<string, string>>;
}

export interface FinalExtra extends QuarterExtra {
  /** Total jail days per player over the game ("Longest sentence"). */
  jailDays?: Partial<Record<PlayerId, number>>;
}

interface Trade {
  playerId: PlayerId;
  quarter: number;
  symbol: SymbolId;
  pnl: number;
  wasShort: boolean;
}

export interface Results {
  startQuarter(quarter: number): void;
  recordFill(fill: SimEventOf<'fill'>): void;
  recordEarnings(reports: readonly EarningsReport[]): void;
  /** After a closed day; `close` = closing price per symbol. Returns a crash moment at most once per quarter. */
  onCandle(day: number, close: Record<SymbolId, number>): MomentEvent | null;
  /** Records a moment made elsewhere (regime start, arrest of the leader) if the game budget allows. */
  addMoment(kind: MomentEvent['kind'], text: string): MomentEvent | null;
  closeQuarter(quarter: number, log: readonly PublishedHeadline[], extra?: QuarterExtra): ResultsEvent;
  final(log: readonly PublishedHeadline[], extra?: FinalExtra): ResultsEvent;
  /** The latest results event, for a player who (re)joins during RESULTS, SHOP or FINAL. */
  last(): ResultsEvent | null;
}

export function formatMoney(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}$${s}`;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

export function createResults(deps: ResultsDeps): Results {
  const { config, universe } = deps;
  const companyBySymbol = new Map(universe.companies.map((c) => [c.symbol, c]));
  const sectorFund = new Map(universe.funds.filter((f) => f.kind === 'sector').map((f) => [f.sector!, f]));
  const indexFund = universe.funds.find((f) => f.kind === 'index')!;
  const startCash = config.economy.startingCash;

  let quarter = 0;
  let openPrice = new Map<SymbolId, number>();
  let openEquity = new Map<PlayerId, number>();
  /** Per player, per symbol: qty at the quarter open, current qty, cash spent, ever short. */
  let book = new Map<PlayerId, Map<SymbolId, { startQty: number; qty: number; spent: number; wasShort: boolean }>>();
  /** Gaps from the last EARNINGS: they show at the open of the quarter that follows. */
  let pendingGaps: EarningsReport[] = [];
  let gapsThisQuarter: EarningsReport[] = [];
  let crashThisQuarter = false;
  let previousClose: number | undefined;
  let momentsLeft = config.presentation.maxMomentsPerGame;
  let latest: ResultsEvent | null = null;

  const trades: Trade[] = [];
  const fills = new Map<PlayerId, number>();
  const forced = new Map<PlayerId, number>();
  const lowestEquity = new Map<PlayerId, number>();
  const statementsByQuarter: Statement[][] = [];

  function slot(playerId: PlayerId, symbol: SymbolId) {
    let perPlayer = book.get(playerId);
    if (!perPlayer) book.set(playerId, (perPlayer = new Map()));
    let s = perPlayer.get(symbol);
    if (!s) perPlayer.set(symbol, (s = { startQty: 0, qty: 0, spent: 0, wasShort: false }));
    return s;
  }

  function quarterTrades(): Trade[] {
    const out: Trade[] = [];
    for (const [playerId, perPlayer] of book) {
      for (const [symbol, s] of perPlayer) {
        if (s.startQty === 0 && s.spent === 0 && s.qty === 0) continue;
        const end = deps.priceOf(symbol) ?? openPrice.get(symbol) ?? 0;
        const start = openPrice.get(symbol) ?? end;
        const pnl = s.qty * end - s.startQty * start - s.spent;
        out.push({ playerId, quarter, symbol, pnl, wasShort: s.wasShort });
      }
    }
    return out;
  }

  function leaderboard(base: (id: PlayerId) => number, extra: QuarterExtra): LeaderboardEntry[] {
    const rows = deps.players().map((p) => ({ p, equity: deps.equityOf(p.id) }));
    rows.sort((a, b) => b.equity - a.equity);
    return rows.map(({ p, equity }, i) => ({
      rank: i + 1,
      playerId: p.id,
      name: p.name,
      netWorth: equity,
      pnl: equity - base(p.id),
      eliminated: deps.eliminatedOf(p.id),
      jailed: extra.jailed?.[p.id] ?? false,
    }));
  }

  /** Log-move a published item put on a target's price. */
  function contribution(h: PublishedHeadline, kind: 'stock' | 'sector', target: string): number {
    const t = h.target;
    if (t.scope === 'market') return h.logReturn;
    if (kind === 'stock') {
      const sector = companyBySymbol.get(target)?.sector;
      if (t.scope === 'stock') return t.symbol === target ? h.logReturn : 0;
      return t.sector === sector ? h.logReturn : 0;
    }
    if (t.scope === 'sector') return t.sector === target ? h.logReturn : 0;
    const fund = sectorFund.get(target as Sector);
    const i = fund?.members.indexOf(t.symbol) ?? -1;
    return i >= 0 ? h.logReturn * fund!.weights[i]! : 0;
  }

  function causeOf(kind: 'stock' | 'sector', target: string, logMove: number, log: readonly PublishedHeadline[]): RecapCause {
    let best: { size: number; cause: RecapCause } | undefined;
    const consider = (size: number, cause: RecapCause) => {
      if (Math.sign(size) !== Math.sign(logMove) || size === 0) return;
      if (!best || Math.abs(size) > Math.abs(best.size)) best = { size, cause };
    };
    for (const h of log) {
      if (h.quarter !== quarter || h.logReturn === 0) continue;
      const kindOf: RecapCause['kind'] = h.source === 'card' ? 'card' : h.source === 'regime' ? 'regime' : 'headline';
      consider(contribution(h, kind, target), { kind: kindOf, id: h.id, text: h.text });
    }
    for (const r of gapsThisQuarter) {
      const size =
        kind === 'stock'
          ? r.symbol === target
            ? r.gap
            : 0
          : (() => {
              const fund = sectorFund.get(target as Sector);
              const i = fund?.members.indexOf(r.symbol) ?? -1;
              return i >= 0 ? r.gap * fund!.weights[i]! : 0;
            })();
      const verdict = r.surprise >= 0 ? `beat by ${(r.surprise * 100).toFixed(0)}%` : `missed by ${(-r.surprise * 100).toFixed(0)}%`;
      consider(size, { kind: 'earnings', text: `${r.symbol} earnings ${verdict}` });
    }
    if (best && Math.abs(best.size) >= NOISE_SHARE * Math.abs(logMove)) return best.cause;
    return { kind: 'noise', text: 'No single headline: the market drifted' };
  }

  function recapMoves(log: readonly PublishedHeadline[]): RecapMove[] {
    const candidates: Array<{ kind: 'stock' | 'sector'; target: string; sector: Sector; change: number }> = [];
    for (const [sector, fund] of sectorFund) {
      const open = openPrice.get(fund.symbol);
      const now = deps.priceOf(fund.symbol);
      if (open && now) candidates.push({ kind: 'sector', target: sector, sector, change: now / open - 1 });
    }
    for (const c of universe.companies) {
      const open = openPrice.get(c.symbol);
      const now = deps.priceOf(c.symbol);
      if (open && now) candidates.push({ kind: 'stock', target: c.symbol, sector: c.sector, change: now / open - 1 });
    }
    candidates.sort((a, b) => Math.abs(Math.log(1 + b.change)) - Math.abs(Math.log(1 + a.change)));
    const used = new Set<Sector>();
    const out: RecapMove[] = [];
    for (const m of candidates) {
      if (out.length >= TOP_MOVES) break;
      if (used.has(m.sector) || m.change === 0) continue;
      used.add(m.sector);
      out.push({ kind: m.kind, target: m.target, change: m.change, cause: causeOf(m.kind, m.target, Math.log(1 + m.change), log) });
    }
    return out;
  }

  function cardAuthors(log: readonly PublishedHeadline[], extra: QuarterExtra): CardReveal[] {
    const names = new Map(deps.players().map((p) => [p.id, p.name]));
    return log
      .filter((h) => h.quarter === quarter && h.ownerId !== undefined && names.has(h.ownerId))
      .map((h) => ({ playerId: h.ownerId!, name: names.get(h.ownerId!)!, cardName: extra.cardNames?.[h.id] ?? 'Card', text: h.text }));
  }

  function bestWorst(list: Trade[]): { bestTrade?: TradeSummary; worstTrade?: TradeSummary } {
    const best = list.reduce<Trade | undefined>((a, t) => (t.pnl > 0 && (!a || t.pnl > a.pnl) ? t : a), undefined);
    const worst = list.reduce<Trade | undefined>((a, t) => (t.pnl < 0 && (!a || t.pnl < a.pnl) ? t : a), undefined);
    return {
      ...(best ? { bestTrade: { symbol: best.symbol, pnl: best.pnl } } : {}),
      ...(worst ? { worstTrade: { symbol: worst.symbol, pnl: worst.pnl } } : {}),
    };
  }

  function awards(extra: FinalExtra, log: readonly PublishedHeadline[]): Award[] {
    const names = new Map(deps.players().map((p) => [p.id, p.name]));
    const out: Award[] = [];
    const give = (title: string, playerId: PlayerId | undefined, detail: string) => {
      if (playerId !== undefined && names.has(playerId)) out.push({ title, playerId, name: names.get(playerId)!, detail });
    };
    const maxBy = <T>(list: T[], score: (t: T) => number): T | undefined =>
      list.reduce<T | undefined>((a, t) => (score(t) > 0 && (!a || score(t) > score(a)) ? t : a), undefined);

    // One trade wins at most one of these two: the best short first, then the best of the rest.
    const short = maxBy(
      trades.filter((t) => t.wasShort),
      (t) => t.pnl,
    );
    if (short) give('Best short', short.playerId, `${formatMoney(short.pnl)} shorting ${short.symbol} in Q${short.quarter}`);
    const best = maxBy(
      trades.filter((t) => t !== short),
      (t) => t.pnl,
    );
    if (best) give('Best trade', best.playerId, `${formatMoney(best.pnl)} on ${best.symbol} in Q${best.quarter}`);
    const worst = maxBy(trades, (t) => -t.pnl);
    if (worst) give('Bag holder', worst.playerId, `${formatMoney(worst.pnl)} on ${worst.symbol} in Q${worst.quarter}`);

    const comeback = maxBy([...lowestEquity], ([id, low]) => (low < startCash && low > 0 ? deps.equityOf(id) / low : 0));
    if (comeback && deps.equityOf(comeback[0]) / comeback[1] >= 2) {
      give('Comeback', comeback[0], `from ${formatMoney(comeback[1])} to ${formatMoney(deps.equityOf(comeback[0]))}`);
    }

    const chaos = new Map<PlayerId, number>();
    for (const h of log) if (h.ownerId !== undefined) chaos.set(h.ownerId, (chaos.get(h.ownerId) ?? 0) + 1);
    const chaotic = maxBy([...chaos], ([, n]) => n);
    if (chaotic) give('Most chaos', chaotic[0], `${chaotic[1]} headline${chaotic[1] === 1 ? '' : 's'} planted`);

    const busiest = maxBy([...fills], ([, n]) => n);
    if (busiest) give('Busiest trader', busiest[0], `${busiest[1]} trades`);
    const called = maxBy([...forced], ([, n]) => n);
    if (called) give('Margin call magnet', called[0], `${called[1]} forced sale${called[1] === 1 ? '' : 's'}`);

    const jail = maxBy(Object.entries(extra.jailDays ?? {}) as [PlayerId, number][], ([, d]) => d);
    if (jail) give('Longest sentence', jail[0], `${jail[1]} days in jail`);
    return out;
  }

  function addMoment(kind: MomentEvent['kind'], text: string): MomentEvent | null {
    if (momentsLeft <= 0) return null;
    momentsLeft -= 1;
    return { e: 'moment', kind, text };
  }

  return {
    startQuarter(q) {
      quarter = q;
      openPrice = new Map(universe.symbols.map((s) => [s, deps.priceOf(s)!]));
      openEquity = new Map(deps.players().map((p) => [p.id, deps.equityOf(p.id)]));
      book = new Map();
      for (const p of deps.players()) {
        for (const pos of deps.positionsOf(p.id)) {
          const s = slot(p.id, pos.symbol);
          s.startQty = pos.qty;
          s.qty = pos.qty;
          s.wasShort = pos.qty < 0;
        }
      }
      gapsThisQuarter = pendingGaps;
      pendingGaps = [];
      crashThisQuarter = false;
    },

    recordFill(fill) {
      const s = slot(fill.playerId, fill.symbol);
      s.qty += fill.qty;
      s.spent += fill.qty * fill.price;
      if (s.qty < 0) s.wasShort = true;
      if (fill.reason === undefined) fills.set(fill.playerId, (fills.get(fill.playerId) ?? 0) + 1);
      else forced.set(fill.playerId, (forced.get(fill.playerId) ?? 0) + 1);
    },

    recordEarnings(reports) {
      pendingGaps = reports.filter((r) => r.gap !== 0);
    },

    onCandle(_day, close) {
      const now = close[indexFund.symbol];
      const before = previousClose;
      previousClose = now;
      if (now === undefined || before === undefined || crashThisQuarter) return null;
      const move = now / before - 1;
      if (move > -config.presentation.crashMoveThreshold) return null;
      crashThisQuarter = true;
      return addMoment('crash', `MARKET CRASH: ${indexFund.name} ${pct(move)} in a day`);
    },

    addMoment,

    closeQuarter(q, log, extra = {}) {
      quarter = q;
      const list = quarterTrades();
      trades.push(...list);
      for (const p of deps.players()) {
        const e = deps.equityOf(p.id);
        lowestEquity.set(p.id, Math.min(lowestEquity.get(p.id) ?? e, e));
      }
      const statements: Statement[] = deps.players().map((p) => {
        const startEquity = openEquity.get(p.id) ?? startCash;
        const endEquity = deps.equityOf(p.id);
        return {
          playerId: p.id,
          startEquity,
          endEquity,
          pnl: endEquity - startEquity,
          fines: extra.fines?.[p.id] ?? 0,
          cardSpend: extra.cardSpend?.[p.id] ?? 0,
          ...bestWorst(list.filter((t) => t.playerId === p.id)),
        };
      });
      statementsByQuarter.push(statements);
      latest = {
        e: 'results',
        leaderboard: leaderboard((id) => openEquity.get(id) ?? startCash, extra),
        statements,
        recap: { quarter: q, topMoves: recapMoves(log), cardAuthors: cardAuthors(log, extra) },
        arrests: extra.arrests ?? [],
      };
      return latest;
    },

    final(log, extra = {}) {
      const recap = latest?.recap ?? { quarter, topMoves: [], cardAuthors: [] };
      latest = {
        e: 'results',
        leaderboard: leaderboard(() => startCash, extra),
        statements: statementsByQuarter.at(-1) ?? [],
        recap,
        arrests: extra.arrests ?? [],
        final: true,
        awards: awards(extra, log),
      };
      return latest;
    },

    last: () => latest,
  };
}

/** Display name of a recap target (sector label or the symbol itself). */
export function recapTargetName(move: RecapMove): string {
  return move.kind === 'sector' ? SECTOR_LABELS[move.target as Sector] : move.target;
}
