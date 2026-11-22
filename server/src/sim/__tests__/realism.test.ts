/**
 * Market realism: volatility clustering, fat tails and unexplained jumps (market.ts dynamics), and an
 * uncertain reaction to news plus misleading leaks (news.ts reaction). Compared with the same seeds
 * without the dynamics stream.
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import { DEFAULT_HEADLINES } from '../data/headlineData.ts';
import { createMarket, createRng, createSim, generateUniverse } from '../index.ts';
import type { Market } from '../index.ts';

const DAYS = 720;

function markets(seed: number): { plain: Market; real: Market } {
  const build = (dynamics: boolean) => {
    const rng = createRng(seed);
    const universe = generateUniverse(rng.fork(), defaultConfig);
    const marketRng = rng.fork();
    return createMarket(universe, marketRng, defaultConfig, dynamics ? createRng(seed + 1_000_003) : undefined);
  };
  return { plain: build(false), real: build(true) };
}

/** Daily log returns per symbol. */
function daily(market: Market, days = DAYS): Map<string, number[]> {
  const out = new Map<string, number[]>(market.universe.symbols.map((s) => [s, []]));
  let prev = market.getPrices();
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < defaultConfig.time.ticksPerCandle; t++) market.step();
    const now = market.getPrices();
    for (const s of market.universe.symbols) out.get(s)!.push(Math.log(now[s]! / prev[s]!));
    prev = now;
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function kurtosis(xs: number[]): number {
  const m = mean(xs);
  const v = mean(xs.map((x) => (x - m) ** 2));
  return mean(xs.map((x) => (x - m) ** 4)) / (v * v);
}
/** Mean autocorrelation of squared returns over lags 1..5 (volatility clustering). */
function clustering(xs: number[]): number {
  const sq = xs.map((x) => x * x);
  const m = mean(sq);
  const v = mean(sq.map((x) => (x - m) ** 2));
  let total = 0;
  for (let lag = 1; lag <= 5; lag++) {
    let c = 0;
    for (let i = lag; i < sq.length; i++) c += (sq[i]! - m) * (sq[i - lag]! - m);
    total += c / (sq.length - lag) / v;
  }
  return total / 5;
}

describe('price dynamics', () => {
  it('volatility clusters: calm stretches and storms, unlike the plain model', () => {
    let real = 0;
    let plain = 0;
    for (const seed of [1, 2, 3, 4]) {
      const m = markets(seed);
      const index = m.real.universe.funds[0]!.symbol;
      real += clustering(daily(m.real).get(index)!);
      plain += clustering(daily(m.plain).get(index)!);
    }
    // Measured on the index: with 30 companies (6 sectors) single-company noise dilutes it more.
    // (The predictability pass cut vol-of-vol to 0.09, so the bars are 0.02 and +0.05.)
    expect(real / 4).toBeGreaterThan(0.02);
    expect(real).toBeGreaterThan(plain + 0.05);
  });

  it('returns have fat tails (jumps with no headline), and the long-run volatility stays near the configured one', () => {
    const m = markets(7);
    const real = daily(m.real);
    const plain = daily(m.plain);
    const stocks = m.real.universe.companies.map((c) => c.symbol);
    const kReal = mean(stocks.map((s) => kurtosis(real.get(s)!)));
    const kPlain = mean(stocks.map((s) => kurtosis(plain.get(s)!)));
    expect(kPlain).toBeLessThan(3.5);
    expect(kReal).toBeGreaterThan(4);
    const vol = (r: Map<string, number[]>) => mean(stocks.map((s) => Math.sqrt(mean(r.get(s)!.map((x) => x * x)))));
    const ratio = vol(real) / vol(plain);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.5);
  });

  it('stays finite and above the floor through a long game', () => {
    const { real } = markets(11);
    daily(real, 2000);
    for (const p of Object.values(real.getPrices())) {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(defaultConfig.market.priceFloor);
    }
  });
});

describe('news reaction', () => {
  const config = mergeConfig(defaultConfig, {
    time: { daysPerQuarter: 60, quarters: 6 },
    phaseMs: { BRIEFING: 200, RESULTS: 200, SHOP: 200 },
    news: { randomHeadlinesPerQuarter: 20, minGapMs: 500 },
    earnings: { leaksPerQuarter: 10 },
  });

  function play(seed: number) {
    const sim = createSim(seed, config);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    for (let i = 0; i < 1_000_000 && sim.getState().phase !== 'FINAL'; i++) sim.tick();
    return sim;
  }

  it('the same kind of headline moves prices by different amounts, and now and then the other way', () => {
    const byId = new Map(DEFAULT_HEADLINES.map((h) => [h.id, h]));
    const ratios: number[] = [];
    let against = 0;
    let total = 0;
    for (const seed of [1, 2]) {
      for (const p of play(seed).news.log()) {
        if (p.source !== 'random' || p.logReturn === 0) continue;
        const t = byId.get(p.templateId);
        if (t === undefined || t.direction === 'neutral') continue;
        total += 1;
        const planned = config.news.shock[t.magnitude] * (t.direction === 'up' ? 1 : -1);
        if (Math.sign(p.logReturn) !== Math.sign(planned)) against += 1;
        else ratios.push(p.logReturn / planned);
      }
    }
    expect(total).toBeGreaterThan(50);
    const m = mean(ratios);
    const sd = Math.sqrt(mean(ratios.map((r) => (r - m) ** 2)));
    expect(sd).toBeGreaterThan(0.25); // shockJitter alone (uniform +-25%) gives about 0.14
    expect(against / total).toBeGreaterThan(0.02);
    expect(against / total).toBeLessThan(0.2);
  });

  it('some earnings leaks point the wrong way, and the report corrects them', () => {
    let wrong = 0;
    let leaks = 0;
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const sim = play(seed);
      // Every quarter's plan is gone by now except the last; check that one exactly.
      const plan = sim.news.plan()!;
      for (const p of sim.news.log()) {
        if (p.source !== 'leak' || p.quarter !== plan.quarter || p.target.scope !== 'stock') continue;
        leaks += 1;
        if (Math.sign(p.logReturn) !== Math.sign(plan.surprise[p.target.symbol]!)) wrong += 1;
      }
    }
    expect(leaks).toBeGreaterThan(10);
    expect(wrong).toBeGreaterThan(0);
    expect(wrong / leaks).toBeLessThan(0.6);
  });
});
