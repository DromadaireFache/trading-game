/**
 * Balance harness (M7): plays whole games headless through createSim with simple bot players, so the
 * economy can be tuned toward DESIGN's target of a median winner of $1B-3B.
 *
 * Everything is deterministic: same seeds + config + bots => same report. Bots only submit `order`
 * intents. Headlines and earnings run inside the sim (M4); cards, regimes and the SEC are not wired
 * yet (M5), so today's numbers are the baseline M5 adds to.
 *
 * Timing: the sim processes intents queued before tick() at the start of that tick, before the market
 * step. So a bot that sees `ticksLeft === 1` in TRADING trades on the last step of the quarter.
 */
import { mergeConfig } from '@tg/shared';
import type { GameConfig, Phase, PlayerId, SymbolId } from '@tg/shared';
import { createRng, createSim } from '@tg/server/sim';
import type { Rng, SimEventOf, Universe } from '@tg/server/sim';

export type Portfolio = SimEventOf<'portfolio'>;

export interface BotView {
  config: GameConfig;
  universe: Universe;
  phase: Phase;
  quarter: number;
  /** Market day (continues across quarters) and tick within it, of the last market step. */
  day: number;
  tickOfDay: number;
  /** Ticks left in the current phase. */
  ticksLeft: number;
  prices: Record<SymbolId, number>;
  portfolio: Portfolio;
}

export interface OrderIntent {
  symbol: SymbolId;
  qty: number;
}

export interface Bot {
  name: string;
  /** Called once per TRADING tick; returns market orders in shares (< 0 = sell / short). */
  decide(view: BotView): OrderIntent[];
}

export type BotFactory = (rng: Rng) => Bot;

export interface BotResult {
  name: string;
  netWorth: number;
  eliminated: boolean;
  marginCalls: number;
  orders: number;
  rejects: number;
}

export interface GameResult {
  seed: number;
  bots: BotResult[];
  winner: BotResult;
}

/** Shares to trade to get from the current position to `targetNotional` dollars (signed) of a symbol. */
export function sharesToTarget(view: BotView, symbol: SymbolId, targetNotional: number): number {
  const price = view.prices[symbol];
  if (!(price! > 0)) return 0;
  const held = view.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  return Math.trunc(targetNotional / price!) - held;
}

/** Orders that close every position except `keep`. */
export function closeOthers(view: BotView, keep: SymbolId | undefined): OrderIntent[] {
  return view.portfolio.positions.filter((p) => p.symbol !== keep && p.qty !== 0).map((p) => ({ symbol: p.symbol, qty: -p.qty }));
}

/** Plays one full game with one player per bot. */
export function playGame(seed: number, baseConfig: GameConfig, factories: readonly BotFactory[]): GameResult {
  const config = mergeConfig(baseConfig, { lobby: { maxPlayers: Math.max(baseConfig.lobby.maxPlayers, factories.length) } });
  const sim = createSim(seed, config);
  const universe = sim.getUniverse();
  // Every bot gets its own stream, so two bots of the same strategy still differ.
  const bots = factories.map((make, i) => make(createRng((seed * 7919 + i * 104729) >>> 0)));
  const ids: PlayerId[] = bots.map((_, i) => `bot${i}`);
  const stats = new Map<PlayerId, BotResult>(
    bots.map((b, i) => [ids[i]!, { name: b.name, netWorth: 0, eliminated: false, marginCalls: 0, orders: 0, rejects: 0 }]),
  );

  ids.forEach((id, i) => sim.submit({ kind: 'add_player', playerId: id, name: bots[i]!.name }));
  sim.submit({ kind: 'start', playerId: ids[0]! });

  let prices: Record<SymbolId, number> = sim.getMarketSnapshot().prices;
  let day = 0;
  let tickOfDay = 0;
  const maxTicks = 10_000_000;
  for (let n = 0; n < maxTicks; n++) {
    for (const event of sim.tick()) {
      if (event.e === 'tick') {
        prices = event.prices;
        day = event.day;
        tickOfDay = event.tickOfDay;
      } else if (event.e === 'fill' && event.reason === 'margin_call') {
        stats.get(event.playerId)!.marginCalls++;
      } else if (event.e === 'reject') {
        const s = stats.get(event.playerId);
        if (s) s.rejects++;
      }
    }
    const state = sim.getState();
    if (state.phase === 'FINAL') break;
    if (state.phase !== 'TRADING') continue;
    bots.forEach((bot, i) => {
      const portfolio = sim.getPortfolio(ids[i]!)!;
      if (portfolio.eliminated) return;
      const view: BotView = { config, universe, phase: state.phase, quarter: state.quarter, day, tickOfDay, ticksLeft: state.ticksLeft ?? 0, prices, portfolio };
      for (const order of bot.decide(view)) {
        if (!Number.isFinite(order.qty) || Math.trunc(order.qty) === 0) continue;
        sim.submit({ kind: 'order', playerId: ids[i]!, symbol: order.symbol, qty: order.qty });
        stats.get(ids[i]!)!.orders++;
      }
    });
  }
  if (sim.getState().phase !== 'FINAL') throw new Error(`seed ${seed}: game did not reach FINAL`);

  const results = ids.map((id) => {
    const s = stats.get(id)!;
    const p = sim.getPortfolio(id)!;
    return { ...s, netWorth: p.equity, eliminated: p.eliminated === true };
  });
  const winner = results.reduce((best, r) => (r.netWorth > best.netWorth ? r : best));
  return { seed, bots: results, winner };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface Summary {
  games: number;
  startingCash: number;
  winner: { p10: number; median: number; p90: number; byBot: Record<string, number> };
  bots: Record<string, { p10: number; median: number; p90: number; eliminated: number; marginCalls: number; rejects: number }>;
}

export function summarize(config: GameConfig, games: readonly GameResult[]): Summary {
  const sortedNw = (values: number[]) => [...values].sort((a, b) => a - b);
  const winners = sortedNw(games.map((g) => g.winner.netWorth));
  const byBot: Record<string, number> = {};
  for (const g of games) byBot[g.winner.name] = (byBot[g.winner.name] ?? 0) + 1;
  const names = [...new Set(games.flatMap((g) => g.bots.map((b) => b.name)))];
  const bots: Summary['bots'] = {};
  for (const name of names) {
    const rows = games.flatMap((g) => g.bots.filter((b) => b.name === name));
    const nw = sortedNw(rows.map((r) => r.netWorth));
    bots[name] = {
      p10: quantile(nw, 0.1),
      median: quantile(nw, 0.5),
      p90: quantile(nw, 0.9),
      eliminated: rows.filter((r) => r.eliminated).length / rows.length,
      marginCalls: rows.reduce((s, r) => s + r.marginCalls, 0) / rows.length,
      rejects: rows.reduce((s, r) => s + r.rejects, 0) / rows.length,
    };
  }
  return {
    games: games.length,
    startingCash: config.economy.startingCash,
    winner: { p10: quantile(winners, 0.1), median: quantile(winners, 0.5), p90: quantile(winners, 0.9), byBot },
    bots,
  };
}
