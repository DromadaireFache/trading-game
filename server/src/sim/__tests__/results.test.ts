import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import { createResults, createSim, generateUniverse, createRng } from '../index.ts';
import type { Sim, SimEvent, SimEventOf } from '../index.ts';

const config = mergeConfig(defaultConfig, {
  time: { quarters: 2, daysPerQuarter: 20 },
  phaseMs: { BRIEFING: 200, EARNINGS: 200, RESULTS: 200, SHOP: 200 },
  lobby: { minPlayers: 2 },
});

/** Plays a whole game; `trade` may submit intents on each TRADING tick. Returns every event. */
function play(seed: number, trade?: (sim: Sim, tick: number) => void): { sim: Sim; events: SimEvent[] } {
  const sim = createSim(seed, config);
  sim.submit({ kind: 'add_player', playerId: 'a', name: 'Ada' });
  sim.submit({ kind: 'add_player', playerId: 'b', name: 'Bo' });
  sim.submit({ kind: 'start', playerId: 'a' });
  const events: SimEvent[] = [];
  for (let t = 0; t < 100_000 && sim.getState().phase !== 'FINAL'; t++) {
    if (sim.getState().phase === 'TRADING') trade?.(sim, t);
    events.push(...sim.tick());
  }
  return { sim, events };
}

const resultsOf = (events: SimEvent[]) => events.filter((e): e is SimEventOf<'results'> => e.e === 'results');

describe('results', () => {
  it('one results event per quarter, with only the final standings in the last quarter', () => {
    const { events, sim } = play(1);
    const all = resultsOf(events);
    expect(all.map((r) => r.recap.quarter)).toEqual([1, 2]);
    expect(all.slice(0, -1).every((r) => !r.final)).toBe(true);
    expect(all.at(-1)!.final).toBe(true);
    expect(all.at(-1)!.awards).toBeDefined();
    expect(sim.getResults()).toBe(all.at(-1));
    // The first quarter's results come right after the RESULTS phase event.
    const idx = events.findIndex((e) => e.e === 'phase' && e.phase === 'RESULTS');
    expect(events[idx + 1]!.e).toBe('results');
  });

  it('recap: 3 moves in different sectors, each with a cause, matching real price changes', () => {
    const { events, sim } = play(2);
    const universe = sim.getUniverse();
    const q1 = resultsOf(events)[0]!;
    expect(q1.recap.quarter).toBe(1);
    expect(q1.recap.topMoves).toHaveLength(3);
    const sectors = q1.recap.topMoves.map((m) => (m.kind === 'sector' ? m.target : universe.companies.find((c) => c.symbol === m.target)!.sector));
    expect(new Set(sectors).size).toBe(3);
    for (const m of q1.recap.topMoves) {
      expect(m.cause.text.length).toBeGreaterThan(0);
      expect(['headline', 'regime', 'earnings', 'card', 'noise']).toContain(m.cause.kind);
    }
    // Sorted by size.
    const sizes = q1.recap.topMoves.map((m) => Math.abs(Math.log(1 + m.change)));
    expect([...sizes].sort((x, y) => y - x)).toEqual(sizes);
    // Most big moves come from a headline, not "noise" (huge shocks are common).
    const causes = resultsOf(play(3).events).flatMap((r) => r.recap.topMoves.map((m) => m.cause.kind));
    expect(causes.filter((k) => k !== 'noise').length).toBeGreaterThan(causes.length / 2);
  });

  it('leaderboard and statements agree with the portfolios', () => {
    let bought = false;
    const { events, sim } = play(4, (s) => {
      if (bought) return;
      bought = true;
      const symbol = s.getUniverse().companies[0]!.symbol;
      s.submit({ kind: 'order', playerId: 'a', symbol, qty: 10_000 });
    });
    const q1 = resultsOf(events)[0]!;
    const board = q1.leaderboard;
    expect(board.map((r) => r.rank)).toEqual([1, 2]);
    expect(board[0]!.netWorth).toBeGreaterThanOrEqual(board[1]!.netWorth);
    const a = q1.statements.find((x) => x.playerId === 'a')!;
    const b = q1.statements.find((x) => x.playerId === 'b')!;
    expect(a.startEquity).toBe(config.economy.startingCash);
    expect(a.pnl).toBeCloseTo(a.endEquity - a.startEquity, 6);
    expect(b.pnl).toBe(0);
    expect(b.bestTrade).toBeUndefined();
    // A's only trade explains its P&L (impact and fair-price marks aside, within a few %).
    const trade = a.bestTrade ?? a.worstTrade;
    expect(trade?.symbol).toBe(sim.getUniverse().companies[0]!.symbol);
    expect(Math.abs(trade!.pnl - a.pnl)).toBeLessThan(Math.max(50_000, Math.abs(a.pnl) * 0.2));
  });

  it('final leaderboard counts P&L from the starting cash; awards name real players', () => {
    let n = 0;
    const { events } = play(5, (s) => {
      if (n++ % 50 !== 0) return;
      const symbol = s.getUniverse().companies[n % 50]!.symbol;
      s.submit({ kind: 'order', playerId: 'a', symbol, qty: n % 2 ? 20_000 : -20_000 });
    });
    const fin = resultsOf(events).at(-1)!;
    for (const row of fin.leaderboard) expect(row.pnl).toBeCloseTo(row.netWorth - config.economy.startingCash, 6);
    const titles = fin.awards!.map((a) => a.title);
    expect(titles).toContain('Busiest trader');
    expect(new Set(titles).size).toBe(titles.length);
    // The best short and the best trade are never the same trade.
    const best = fin.awards!.find((a) => a.title === 'Best trade');
    const short = fin.awards!.find((a) => a.title === 'Best short');
    if (best && short) expect(best.detail.replace('on ', '')).not.toBe(short.detail.replace('shorting ', ''));
    for (const award of fin.awards!) {
      expect(['a', 'b']).toContain(award.playerId);
      expect(award.detail.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    expect(resultsOf(play(6).events)).toEqual(resultsOf(play(6).events));
  });

  it('a crash moment fires once per quarter and the game budget caps moments', () => {
    const universe = generateUniverse(createRng(1).fork(), defaultConfig);
    const index = universe.funds.find((f) => f.kind === 'index')!.symbol;
    const tight = mergeConfig(defaultConfig, { presentation: { maxMomentsPerGame: 2 } });
    const r = createResults({
      config: tight,
      universe,
      priceOf: () => 100,
      players: () => [],
      equityOf: () => 0,
      positionsOf: () => [],
      eliminatedOf: () => false,
    });
    r.startQuarter(1);
    expect(r.onCandle(0, { [index]: 100 })).toBeNull();
    expect(r.onCandle(1, { [index]: 95 })).toBeNull(); // -5%: not a crash
    const crash = r.onCandle(2, { [index]: 80 }); // -15.8%
    expect(crash).toMatchObject({ e: 'moment', kind: 'crash' });
    expect(crash!.text).toContain('-15.8%');
    expect(r.onCandle(3, { [index]: 60 })).toBeNull(); // one per quarter
    r.startQuarter(2);
    expect(r.onCandle(4, { [index]: 40 })).not.toBeNull();
    expect(r.addMoment('regime', 'War!')).toBeNull(); // budget of 2 used up
  });
});

describe('final standings include the last earnings gap', () => {
  it('values positions after the last EARNINGS gap, which no market step applies', () => {
    const sim = createSim(9, config);
    sim.submit({ kind: 'add_player', playerId: 'a', name: 'Ada' });
    sim.submit({ kind: 'add_player', playerId: 'b', name: 'Bo' });
    sim.submit({ kind: 'start', playerId: 'a' });
    let bought: string | null = null;
    const events: SimEvent[] = [];
    let quarterEquity = 0;
    let priceBefore = 0;
    for (let t = 0; t < 100_000 && sim.getState().phase !== 'FINAL'; t++) {
      const s = sim.getState();
      // Last quarter, early in TRADING: buy the stock whose earnings surprise is largest.
      if (s.phase === 'TRADING' && s.quarter === config.time.quarters && bought === null && s.phaseTick > 5) {
        const plan = sim.news.plan()!;
        bought = Object.entries(plan.surprise).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]![0];
        sim.submit({ kind: 'order', playerId: 'a', symbol: bought, qty: 20_000 });
      }
      if (s.phase === 'EARNINGS' && s.quarter === config.time.quarters) {
        quarterEquity = sim.getPortfolio('a')!.equity;
        priceBefore = sim.getMarketSnapshot().prices[bought!]!;
      }
      events.push(...sim.tick());
    }
    const gap = sim.news.pendingGap()![bought!]!;
    expect(Math.abs(gap)).toBeGreaterThan(0.01);
    const qty = sim.getPortfolio('a')!.positions.find((p) => p.symbol === bought)!.qty;
    const finalEquity = sim.getPortfolio('a')!.equity;
    // Within 0.1%: the position is valued at the fair price, which still nets out a trace of the order's own temporary impact.
    const expected = qty * priceBefore * (Math.exp(gap) - 1);
    expect(Math.abs(finalEquity - quarterEquity - expected)).toBeLessThan(Math.abs(expected) * 1e-3);
    // The final standings and the last portfolio message say the same.
    const fin = resultsOf(events).at(-1)!;
    expect(fin.final).toBe(true);
    expect(fin.leaderboard.find((r) => r.playerId === 'a')!.netWorth).toBeCloseTo(finalEquity, 6);
    const statement = fin.statements.find((s) => s.playerId === 'a')!;
    expect((statement.bestTrade ?? statement.worstTrade)?.symbol).toBe(bought);
    const lastPortfolio = events.filter((e): e is SimEventOf<'portfolio'> => e.e === 'portfolio' && e.playerId === 'a').at(-1)!;
    expect(lastPortfolio.equity).toBeCloseTo(finalEquity, 6);
    // No price moved on the wire: FINAL sends no tick.
    const finalIdx = events.findIndex((e) => e.e === 'phase' && e.phase === 'FINAL');
    expect(events.slice(finalIdx).some((e) => e.e === 'tick' || e.e === 'candle')).toBe(false);
  });
});
