/**
 * Earnings as numbers (DESIGN.md section 3). No headline text: a leak is a symbol, a market tick
 * and a log-return; whoever owns headlines turns it into a story (shocks.nearestMagnitude helps).
 *
 * Per quarter, at BRIEFING (drawEarnings):
 *   - every company draws true_surprise ~ N(0, earnings.surpriseSigma): +0.08 = beats by 8%.
 *   - earnings.leaksPerQuarter leaks go to distinct companies (a company can get only one leak per
 *     quarter; capped at the number of companies), at market ticks drawn uniformly inside TRADING but
 *     early enough that the lead time and the leak's shock (2 ramps) fit before the close.
 *   - a leak prices in a share, drawn in [leakShareMin, leakShareMax], of the surprise:
 *     amount = share * true_surprise, its move = gapFactor * amount, priced_in += amount.
 * At the close of TRADING (earningsGap): gap = gapFactor * (true_surprise - priced_in) per company. The news
 * engine applies it after a trading window at the start of the next quarter. After the final
 * quarter, the sim applies it directly to the marks used for the final leaderboard.
 * Boardroom Mole (earnings_peek) reads plan.surprise[symbol].
 */
import type { EarningsReport, GameConfig, SymbolId } from '@tg/shared';
import { msToTicks } from '@tg/shared';
import type { Rng } from './rng.ts';
import type { Universe } from './universe.ts';

export interface EarningsImpactReport extends EarningsReport {
  /** Remaining log return after published leaks, kept on the server. */
  gap: number;
}

export interface Leak {
  symbol: SymbolId;
  /** Earliest market tick its headline can publish. */
  tick: number;
  /** Surprise units priced in by this leak (signed, same sign as the surprise). */
  amount: number;
  /** Log-return of its shock: gapFactor * amount. */
  logReturn: number;
}

export interface EarningsPlan {
  quarter: number;
  /** true_surprise per company. */
  surprise: Record<SymbolId, number>;
  /** Sorted by tick. */
  leaks: Leak[];
}

/**
 * Draws a quarter's surprises and leaks. `tradingStartTick` is the market tick of the quarter's
 * first TRADING step (day * ticksPerCandle). Draw order is fixed: surprises in universe order, then
 * the leaked companies, then each leak's tick and share.
 */
export function drawEarnings(rng: Rng, config: GameConfig, universe: Universe, quarter: number, tradingStartTick: number): EarningsPlan {
  const e = config.earnings;
  const surprise: Record<SymbolId, number> = {};
  for (const c of universe.companies) surprise[c.symbol] = rng.normal() * e.surpriseSigma;

  const pool = universe.companies.map((c) => c.symbol);
  const count = Math.min(e.leaksPerQuarter, pool.length);
  const picked: SymbolId[] = [];
  for (let i = 0; i < count; i++) picked.push(pool.splice(rng.int(pool.length), 1)[0]!);

  const tradingTicks = config.time.daysPerQuarter * config.time.ticksPerCandle;
  const settleTicks = 2 * msToTicks(config, config.news.rampMs) + Math.ceil(config.news.leadMaxMs / config.time.tickMs);
  const window = Math.max(1, tradingTicks - settleTicks);
  const leaks: Leak[] = picked.map((symbol) => {
    const tick = tradingStartTick + rng.int(window);
    const share = e.leakShareMin + (e.leakShareMax - e.leakShareMin) * rng.next();
    const amount = share * surprise[symbol]!;
    return { symbol, tick, amount, logReturn: e.gapFactor * amount };
  });
  leaks.sort((a, b) => a.tick - b.tick || (a.symbol < b.symbol ? -1 : 1));
  return { quarter, surprise, leaks };
}

/** Surprise priced in per company by leaks that started at or before `uptoTick` (default: all). */
export function pricedIn(plan: EarningsPlan, uptoTick = Number.POSITIVE_INFINITY): Record<SymbolId, number> {
  const out: Record<SymbolId, number> = {};
  for (const leak of plan.leaks) if (leak.tick <= uptoTick) out[leak.symbol] = (out[leak.symbol] ?? 0) + leak.amount;
  return out;
}

/** The earnings gap per company, as log-returns: gapFactor * (true_surprise - priced_in). */
export function earningsGap(config: GameConfig, plan: EarningsPlan, priced: Record<SymbolId, number> = pricedIn(plan)): Record<SymbolId, number> {
  const out: Record<SymbolId, number> = {};
  for (const [symbol, s] of Object.entries(plan.surprise)) out[symbol] = config.earnings.gapFactor * (s - (priced[symbol] ?? 0));
  return out;
}
