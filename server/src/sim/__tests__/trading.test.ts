/**
 * Portfolio math and order handling (milestone 3): fills and average prices, shorts and borrow fees,
 * the leverage cap, margin calls, elimination, price impact (slippage, permanent, decaying temporary)
 * and the order path through createSim (phase gate, arrival order, determinism).
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, valuePortfolio } from '@tg/shared';
import type { DeepPartial, GameConfig } from '@tg/shared';
import { createSim, createTrading } from '../index.ts';
import type { Sim, SimEvent, Trading } from '../index.ts';

/** No impact at all, so fills happen exactly at the mid and the arithmetic is easy to check. */
const NO_IMPACT: DeepPartial<GameConfig> = { impact: { lambda: 0, kPermanent: 0, kTemporary: 0 } };

interface Desk {
  trading: Trading;
  prices: Record<string, number>;
  /** Simulates one market step: apply the impact input to the prices, then afterStep. */
  step(dayClosed?: boolean): SimEvent[];
}

function desk(overrides: DeepPartial<GameConfig> = NO_IMPACT, prices: Record<string, number> = { AAA: 100, BBB: 50 }): Desk {
  const config = mergeConfig(defaultConfig, overrides);
  const state = { ...prices };
  const trading = createTrading({
    config,
    priceOf: (s) => state[s],
    advOf: (s) => (s in state ? 1e9 : undefined),
    now: () => 0,
  });
  trading.addAccount('p1');
  return {
    trading,
    prices: state,
    step(dayClosed = false) {
      const input = trading.stepInput() ?? {};
      for (const [s, r] of Object.entries(input)) state[s] = state[s]! * Math.exp(r);
      return trading.afterStep(dayClosed);
    },
  };
}

function holding(d: Desk, symbol: string) {
  return d.trading.getAccount('p1')!.holdings.get(symbol);
}

function equity(d: Desk): number {
  return d.trading.portfolio('p1')!.equity;
}

const START = defaultConfig.economy.startingCash;

describe('fills and average prices', () => {
  it('a buy moves cash into the position at the fill price; equity is unchanged without impact', () => {
    const d = desk();
    const r = d.trading.order('p1', 'AAA', 1000);
    expect(r.ok).toBe(true);
    expect(d.trading.getAccount('p1')!.cash).toBe(START - 100_000);
    expect(holding(d, 'AAA')).toMatchObject({ qty: 1000, avgPrice: 100 });
    expect(equity(d)).toBe(START);
  });

  it('adding averages the entry price; reducing keeps it and books realized P&L', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', 1000);
    d.prices.AAA = 110;
    d.trading.order('p1', 'AAA', 1000);
    expect(holding(d, 'AAA')!.avgPrice).toBeCloseTo(105, 10);
    d.prices.AAA = 120;
    d.trading.order('p1', 'AAA', -500);
    const h = holding(d, 'AAA')!;
    expect(h.qty).toBe(1500);
    expect(h.avgPrice).toBeCloseTo(105, 10);
    expect(h.realized).toBeCloseTo(500 * 15, 6);
    // equity = start + unrealized + realized
    expect(equity(d)).toBeCloseTo(START + 1500 * 15 + 500 * 15, 4);
  });

  it('a sell larger than the long flips to a short at the fill price', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', 100);
    d.prices.AAA = 90;
    d.trading.order('p1', 'AAA', -300);
    const h = holding(d, 'AAA')!;
    expect(h.qty).toBe(-200);
    expect(h.avgPrice).toBe(90);
    expect(h.realized).toBeCloseTo(-1000, 6);
  });

  it('fractional quantities are truncated to whole shares; less than one share is rejected', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', 10.9);
    expect(holding(d, 'AAA')!.qty).toBe(10);
    const r = d.trading.order('p1', 'AAA', 0.5);
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('unknown symbols are rejected', () => {
    expect(desk().trading.order('p1', 'NOPE', 10)).toMatchObject({ ok: false, code: 'unknown_symbol' });
  });
});

describe('shorts', () => {
  it('short proceeds go to cash, a falling price makes money, equity = cash + qty * price', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', -1000);
    expect(d.trading.getAccount('p1')!.cash).toBe(START + 100_000);
    d.prices.AAA = 80;
    expect(equity(d)).toBeCloseTo(START + 20_000, 6);
    d.prices.AAA = 130;
    expect(equity(d)).toBeCloseTo(START - 30_000, 6);
  });

  it('shorts pay the borrow fee once per closed day, longs do not', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', -1000);
    d.trading.order('p1', 'BBB', 1000);
    const cash = d.trading.getAccount('p1')!.cash;
    d.step(false);
    expect(d.trading.getAccount('p1')!.cash).toBe(cash);
    d.step(true);
    const fee = defaultConfig.trading.shortBorrowFeePerDay * 1000 * 100;
    expect(d.trading.getAccount('p1')!.cash).toBeCloseTo(cash - fee, 8);
    expect(d.trading.getAccount('p1')!.borrowFees).toBeCloseTo(fee, 8);
  });
});

describe('leverage cap', () => {
  const L = defaultConfig.trading.leverageCap;

  it('an order above leverageCap * equity is clipped to the largest size that fits', () => {
    const d = desk();
    const r = d.trading.order('p1', 'AAA', 10_000_000);
    expect(r.ok).toBe(true);
    expect(holding(d, 'AAA')!.qty).toBe((L * START) / 100);
    expect(d.trading.portfolio('p1')!.buyingPower).toBeCloseTo(0, 6);
  });

  it('gross counts longs and shorts; with no buying power left a new position is rejected', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', ((L * START) / 100) * 0.5);
    d.trading.order('p1', 'BBB', -((L * START) / 50) * 0.5);
    const v = valuePortfolio(defaultConfig, d.trading.getAccount('p1')!.cash, d.trading.portfolio('p1')!.positions, (s) => d.prices[s]);
    expect(v.gross).toBeCloseTo(L * START, 4);
    expect(d.trading.order('p1', 'BBB', -10)).toMatchObject({ ok: false, code: 'insufficient_buying_power' });
    expect(d.trading.order('p1', 'AAA', 10)).toMatchObject({ ok: false, code: 'insufficient_buying_power' });
  });

  it('reducing a position always goes through, even above the cap', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', (L * START) / 100);
    d.prices.AAA = 95; // equity fell, so gross is now above the cap
    expect(d.trading.order('p1', 'AAA', -100).ok).toBe(true);
  });

  it('a flip is clipped on the new side: the old position closes, the new one fits the cap', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', (L * START) / 100);
    d.trading.order('p1', 'AAA', -10_000_000);
    expect(holding(d, 'AAA')!.qty).toBe(-(L * START) / 100);
  });
});

describe('margin call and elimination', () => {
  it('equity below maintenance margin liquidates the largest position, one per tick', () => {
    const d = desk(NO_IMPACT, { AAA: 100, BBB: 100, CCC: 100 });
    d.trading.order('p1', 'AAA', 150_000); // $15M
    d.trading.order('p1', 'BBB', 100_000); // $10M
    d.trading.order('p1', 'CCC', 50_000); // $5M  -> gross $30M on $10M equity
    // Everything drops 26%: equity = 10M - 7.8M = 2.2M < 0.15 * 22.2M
    for (const s of ['AAA', 'BBB', 'CCC']) d.prices[s] = 74;
    const events = d.step();
    const fills = events.filter((e) => e.e === 'fill');
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ symbol: 'AAA', qty: -150_000, reason: 'margin_call' });
    expect(holding(d, 'AAA')!.qty).toBe(0);
    // Still under water with BBB + CCC? equity 2.2M vs 0.15 * 11.1M = 1.67M: no, so nothing more.
    expect(d.step().filter((e) => e.e === 'fill')).toHaveLength(0);
    expect(d.trading.portfolio('p1')!.eliminated).toBe(false);
  });

  it('equity below the elimination threshold closes everything and knocks the player out for good', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', (4 * START) / 100);
    d.prices.AAA = 75.2; // equity = 10M - 40M * 0.248 = 80k < 100k
    const events = d.step();
    expect(events.some((e) => e.e === 'fill' && e.reason === 'elimination')).toBe(true);
    const p = d.trading.portfolio('p1')!;
    expect(p.eliminated).toBe(true);
    expect(p.positions).toHaveLength(0);
    expect(d.trading.order('p1', 'AAA', 1)).toMatchObject({ ok: false, code: 'eliminated' });
    expect(d.step()).toHaveLength(0);
  });

  it('a short squeeze margin-calls the short', () => {
    const d = desk();
    d.trading.order('p1', 'AAA', -(4 * START) / 100);
    d.prices.AAA = 120; // equity = 10M - 8M = 2M; gross = 48M; 0.15 * 48M = 7.2M
    const fills = d.step().filter((e) => e.e === 'fill');
    expect(fills).toEqual([expect.objectContaining({ symbol: 'AAA', qty: 400_000, reason: 'margin_call' })]);
  });
});

describe('price impact', () => {
  const im = { lambda: 0.05, kPermanent: 0.02, kTemporary: 0.05, temporaryHalfLifeMs: 5_000, maxSlippage: 1, maxPermanent: 1, maxTemporary: 1 };

  it('buys fill above the mid by lambda * notional / adv, sells below', () => {
    const d = desk({ impact: im });
    d.trading.order('p1', 'AAA', 400_000); // $40M (the leverage cap) on $1B adv: x = 0.04
    expect(holding(d, 'AAA')!.avgPrice).toBeCloseTo(100 * (1 + 0.05 * 0.04), 10);
    const e = desk({ impact: im });
    e.trading.order('p1', 'AAA', -400_000);
    expect(holding(e, 'AAA')!.avgPrice).toBeCloseTo(100 * (1 - 0.05 * 0.04), 10);
  });

  it('the second buyer on the same tick pays more than the first', () => {
    const config = mergeConfig(defaultConfig, { impact: im });
    const prices: Record<string, number> = { AAA: 100 };
    const t = createTrading({ config, priceOf: (s) => prices[s], advOf: () => 1e9, now: () => 0 });
    t.addAccount('a');
    t.addAccount('b');
    t.order('a', 'AAA', 200_000);
    t.order('b', 'AAA', 200_000);
    expect(t.getAccount('b')!.holdings.get('AAA')!.avgPrice).toBeGreaterThan(t.getAccount('a')!.holdings.get('AAA')!.avgPrice);
  });

  it('the price jumps by permanent + temporary, then the temporary part decays with the half-life', () => {
    const d = desk({ impact: im });
    d.trading.order('p1', 'AAA', 400_000); // x = 0.04: perm 0.0008, temp 0.002
    const perHalfLife = im.temporaryHalfLifeMs / defaultConfig.time.tickMs;
    const logs: number[] = [];
    for (let i = 0; i < perHalfLife * 6; i++) {
      d.step();
      logs.push(Math.log(d.prices.AAA! / 100));
    }
    const perm = 0.02 * 0.04;
    const temp = 0.05 * 0.04;
    // Right after the fill: almost the full perm + temp (one tick of decay already).
    expect(logs[0]).toBeGreaterThan(perm + temp * 0.98);
    // After one half-life, half the temporary part is gone.
    expect(logs[perHalfLife - 1]).toBeCloseTo(perm + temp * 0.5, 8);
    // After six half-lives, only the permanent part remains (to within 1/64 of temp).
    expect(logs[logs.length - 1]! - perm).toBeLessThan(temp / 50);
    expect(logs[logs.length - 1]).toBeGreaterThan(perm);
  });

  it('impact terms are capped', () => {
    const config = mergeConfig(defaultConfig, { impact: { ...im, maxSlippage: 0.1, maxPermanent: 0.05, maxTemporary: 0.05 } });
    const prices: Record<string, number> = { AAA: 100 };
    const t = createTrading({ config, priceOf: (s) => prices[s], advOf: () => 1e6, now: () => 0 });
    t.addAccount('a');
    t.order('a', 'AAA', 100_000); // $10M on $1M adv: x = 10
    expect(t.getAccount('a')!.holdings.get('AAA')!.avgPrice).toBeCloseTo(110, 8);
    expect(t.stepInput()!.AAA).toBeCloseTo(0.1 - 0.05 * (1 - Math.pow(0.5, 100 / 5000)), 8);
  });
});

// ---------------------------------------------------------------------------
// Through createSim
// ---------------------------------------------------------------------------

const FAST = mergeConfig(defaultConfig, {
  time: { daysPerQuarter: 5, quarters: 2 },
  phaseMs: { BRIEFING: 300, EARNINGS: 200, RESULTS: 200, SHOP: 200 },
});

function started(seed = 7, config: GameConfig = FAST, players = ['p1', 'p2']): Sim {
  const sim = createSim(seed, config);
  for (const id of players) sim.submit({ kind: 'add_player', playerId: id, name: id });
  sim.submit({ kind: 'start', playerId: players[0]! });
  sim.tick();
  return sim;
}

function untilPhase(sim: Sim, phase: string, sink?: SimEvent[]): void {
  for (let i = 0; i < 100_000 && sim.getState().phase !== phase; i++) {
    const events = sim.tick();
    sink?.push(...events);
  }
}

describe('orders through the sim', () => {
  it('everybody gets their starting portfolio when the game starts', () => {
    const sim = createSim(1, FAST);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'A' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    const events = sim.tick();
    expect(events).toContainEqual(expect.objectContaining({ e: 'portfolio', playerId: 'p1', cash: START, equity: START }));
  });

  it('orders outside TRADING are rejected with wrong_phase', () => {
    const sim = started();
    sim.submit({ kind: 'order', playerId: 'p1', symbol: sim.getUniverse().companies[0]!.symbol, qty: 10 });
    expect(sim.tick()).toContainEqual(expect.objectContaining({ e: 'reject', code: 'wrong_phase' }));
  });

  it('in TRADING an order fills, sends a portfolio, and its impact shows in the next tick', () => {
    const sim = started();
    untilPhase(sim, 'TRADING');
    const symbol = sim.getUniverse().companies[0]!.symbol;
    const before = sim.getMarketSnapshot().prices[symbol]!;
    sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: 10_000 });
    const events = sim.tick();
    const fill = events.find((e) => e.e === 'fill');
    expect(fill).toMatchObject({ playerId: 'p1', symbol, qty: 10_000 });
    expect((fill as { price: number }).price).toBeGreaterThan(before);
    expect(events.findIndex((e) => e.e === 'fill')).toBeLessThan(events.findIndex((e) => e.e === 'tick'));
    expect(sim.getPortfolio('p1')!.positions).toEqual([expect.objectContaining({ symbol, qty: 10_000 })]);
  });

  it('orders on the same tick fill in arrival order', () => {
    const sim = started();
    untilPhase(sim, 'TRADING');
    const symbol = sim.getUniverse().companies[0]!.symbol;
    sim.submit({ kind: 'order', playerId: 'p2', symbol, qty: 50_000 });
    sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: 50_000 });
    const fills = sim.tick().filter((e) => e.e === 'fill') as Array<{ playerId: string; price: number }>;
    expect(fills.map((f) => f.playerId)).toEqual(['p2', 'p1']);
    expect(fills[1]!.price).toBeGreaterThan(fills[0]!.price);
  });

  it('a buy pushes the price above the same seed without the order (impact), and the game stays deterministic', () => {
    const run = (withOrder: boolean) => {
      const sim = started(11);
      untilPhase(sim, 'TRADING');
      const symbol = sim.getUniverse().companies[3]!.symbol;
      if (withOrder) sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: 200_000 });
      const all: SimEvent[] = [];
      for (let i = 0; i < 20; i++) all.push(...sim.tick());
      return { price: sim.getMarketSnapshot().prices[symbol]!, all };
    };
    const quiet = run(false);
    const traded = run(true);
    expect(traded.price).toBeGreaterThan(quiet.price);
    expect(run(true).all).toEqual(traded.all);
  });

  it('a full game with orders every day stays finite and ends in FINAL', () => {
    const sim = started(5, FAST);
    const universe = sim.getUniverse();
    let n = 0;
    for (let i = 0; i < 100_000 && sim.getState().phase !== 'FINAL'; i++) {
      if (sim.getState().phase === 'TRADING' && i % 7 === 0) {
        const c = universe.companies[n % universe.companies.length]!;
        sim.submit({ kind: 'order', playerId: n % 2 ? 'p1' : 'p2', symbol: c.symbol, qty: (n % 3 === 0 ? -1 : 1) * 1e9 });
        n++;
      }
      sim.tick();
    }
    expect(sim.getState().phase).toBe('FINAL');
    for (const id of ['p1', 'p2']) {
      const p = sim.getPortfolio(id)!;
      expect(Number.isFinite(p.equity)).toBe(true);
      expect(Number.isFinite(p.cash)).toBe(true);
    }
  });
});
