/**
 * The price process: determinism, correlation, volatility, fund baskets, candles, and the hooks
 * (volMult, corrMult, dRate, sectorDriftPerDay, symbolReturn) later milestones plug into.
 */
import { describe, expect, it } from 'vitest';
import { SECTORS, defaultConfig, mergeConfig, unpackCandles } from '@tg/shared';
import type { GameConfig, OHLC } from '@tg/shared';
import { createMarket, createRng, createSim, generateUniverse } from '../index.ts';
import type { Market, MarketStepInput, Sim, SimEvent, Universe } from '../index.ts';

const mc = defaultConfig.market;
const GAME_DAYS = defaultConfig.time.daysPerQuarter * defaultConfig.time.quarters;

function marketOf(seed: number, config: GameConfig = defaultConfig): Market {
  const rng = createRng(seed);
  const universe = generateUniverse(rng.fork(), config);
  return createMarket(universe, rng.fork(), config);
}

/** Daily close-to-close log returns per symbol over `days` days. */
function dailyReturns(market: Market, days: number, config: GameConfig = defaultConfig, input?: MarketStepInput): Map<string, number[]> {
  const out = new Map<string, number[]>(market.universe.symbols.map((s) => [s, []]));
  let previous = market.getPrices();
  for (let day = 0; day < days; day++) {
    for (let t = 0; t < config.time.ticksPerCandle; t++) market.step(input);
    const now = market.getPrices();
    for (const symbol of market.universe.symbols) out.get(symbol)!.push(Math.log(now[symbol]! / previous[symbol]!));
    previous = now;
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  const mu = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (values.length - 1));
}

function correlation(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) * (a[i]! - ma);
    bb += (b[i]! - mb) * (b[i]! - mb);
  }
  return ab / Math.sqrt(aa * bb);
}

/** Average pairwise correlation of stocks: same-sector pairs, cross-sector pairs, and vs the index. */
function correlationSummary(universe: Universe, returns: Map<string, number[]>) {
  const same: number[] = [];
  const cross: number[] = [];
  const companies = universe.companies;
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const rho = correlation(returns.get(companies[i]!.symbol)!, returns.get(companies[j]!.symbol)!);
      (companies[i]!.sector === companies[j]!.sector ? same : cross).push(rho);
    }
  }
  const index = returns.get(universe.funds[0]!.symbol)!;
  const withIndex = companies.map((c) => correlation(returns.get(c.symbol)!, index));
  return { same: mean(same), cross: mean(cross), all: mean([...same, ...cross]), withIndex };
}

/** Theoretical per-day volatility of a company's log return in a quiet market. */
function modelVol(c: Universe['companies'][number], volMult = 1, corrMult = 1): number {
  const common = volMult * corrMult;
  return Math.sqrt((c.betaM * mc.marketVolPerDay * common) ** 2 + (c.betaS * mc.sectorVolPerDay * common) ** 2 + (c.sigmaI * volMult) ** 2);
}

function startedSim(seed: number, config: GameConfig = defaultConfig): Sim {
  const sim = createSim(seed, config);
  sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
  sim.submit({ kind: 'start', playerId: 'p1' });
  return sim;
}

function playToFinal(sim: Sim, onEvents?: (events: SimEvent[]) => void): void {
  for (let i = 0; i < 1_000_000 && sim.getState().phase !== 'FINAL'; i++) {
    const events = sim.tick();
    onEvents?.(events);
  }
  expect(sim.getState().phase).toBe('FINAL');
}

describe('market: determinism', () => {
  // The calm pass cut the base vols to a quarter of the first guess; the realism pass set them back to
  // half (the dynamics in createSim add the storms on top).
  it('keeps the base daily fluctuations at half of the first defaults', () => {
    const previous = mergeConfig(defaultConfig, { market: {
      marketVolPerDay: 0.01, sectorVolPerDay: 0.008, idioVolPerDayMin: 0.01, idioVolPerDayMax: 0.03,
    } });
    for (const seed of [1, 42, 2026]) {
      const calm = marketOf(seed);
      const old = marketOf(seed, previous);
      const calmReturns = dailyReturns(calm, 90);
      const oldReturns = dailyReturns(old, 90, previous);
      const calmVol = mean(calm.universe.companies.map((c) => std(calmReturns.get(c.symbol)!)));
      const oldVol = mean(old.universe.companies.map((c) => std(oldReturns.get(c.symbol)!)));
      expect(calmVol / oldVol).toBeCloseTo(0.5, 5);
    }
  });

  it('same seed -> identical price paths; different seed -> different', () => {
    const path = (seed: number) => {
      const market = marketOf(seed);
      const prices: Array<Record<string, number>> = [];
      for (let i = 0; i < 300; i++) prices.push(market.getPrices(), ...market.step().flatMap((e) => (e.e === 'tick' ? [e.prices] : [])));
      return { prices, snapshot: market.getSnapshot() };
    };
    expect(path(99)).toEqual(path(99));
    expect(path(99).prices).not.toEqual(path(100).prices);
  });

  it('same seed -> identical full game through createSim', () => {
    const closes = (seed: number) => {
      const sim = startedSim(seed);
      playToFinal(sim);
      return sim.getMarketSnapshot();
    };
    const a = closes(5);
    expect(a).toEqual(closes(5));
    expect(a.candles).not.toEqual(closes(6).candles);
  });

  it('hooks do not shift the noise stream: an input on one symbol leaves every other path untouched', () => {
    const quiet = marketOf(21);
    const nudged = marketOf(21);
    const target = quiet.universe.companies[7]!;
    const index = quiet.universe.funds[0]!.symbol;
    const sectorFund = quiet.universe.funds.find((f) => f.sector === target.sector)!.symbol;
    for (let i = 0; i < 50; i++) {
      quiet.step();
      nudged.step(i === 10 ? { symbolReturn: { [target.symbol]: 0.1 } } : undefined);
    }
    const a = quiet.getPrices();
    const b = nudged.getPrices();
    for (const symbol of quiet.universe.symbols) {
      if (symbol === target.symbol) expect(b[symbol]! / a[symbol]!).toBeCloseTo(Math.exp(0.1), 10);
      else if (symbol === index || symbol === sectorFund) expect(b[symbol]).toBeGreaterThan(a[symbol]!);
      else expect(b[symbol]).toBe(a[symbol]);
    }
  });
});

describe('market: correlation', () => {
  it('same-sector pairs are more correlated than cross-sector pairs; stocks follow the index', () => {
    for (const seed of [1, 2, 3]) {
      const market = marketOf(seed);
      const summary = correlationSummary(market.universe, dailyReturns(market, GAME_DAYS));
      expect(summary.same, `seed ${seed}`).toBeGreaterThan(summary.cross + 0.05);
      expect(summary.cross, `seed ${seed}`).toBeGreaterThan(0.03);
      for (const rho of summary.withIndex) expect(rho, `seed ${seed}`).toBeGreaterThan(0);
      expect(mean(summary.withIndex)).toBeGreaterThan(0.3);
    }
  });

  it('raising corrMult raises the average correlation', () => {
    const run = (corrMult: number) => {
      const market = marketOf(4);
      return correlationSummary(market.universe, dailyReturns(market, GAME_DAYS, defaultConfig, { corrMult }));
    };
    const low = run(0.5);
    const base = run(1);
    const high = run(2);
    expect(base.all).toBeGreaterThan(low.all + 0.05);
    expect(high.all).toBeGreaterThan(base.all + 0.1);
    expect(high.same).toBeGreaterThan(base.same);
  });
});

describe('market: volatility', () => {
  it('realised daily vol of every stock is close to the configured one', () => {
    const market = marketOf(8);
    const returns = dailyReturns(market, GAME_DAYS);
    const ratios = market.universe.companies.map((c) => std(returns.get(c.symbol)!) / modelVol(c));
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
    expect(mean(ratios)).toBeGreaterThan(0.96);
    expect(mean(ratios)).toBeLessThan(1.04);
    // A typical stock has a quiet but measurable daily move.
    const typical = mean(market.universe.companies.map((c) => std(returns.get(c.symbol)!)));
    expect(typical).toBeGreaterThan(0.0025);
    expect(typical).toBeLessThan(0.0125);
  });

  it('daily vol does not depend on the tick rate (sqrt-of-time scaling)', () => {
    for (const ticksPerCandle of [1, 4, 25]) {
      const config = mergeConfig(defaultConfig, { time: { ticksPerCandle } });
      const market = marketOf(8, config);
      const returns = dailyReturns(market, GAME_DAYS, config);
      const ratios = market.universe.companies.map((c) => std(returns.get(c.symbol)!) / modelVol(c));
      expect(mean(ratios), `ticksPerCandle ${ticksPerCandle}`).toBeGreaterThan(0.95);
      expect(mean(ratios), `ticksPerCandle ${ticksPerCandle}`).toBeLessThan(1.05);
    }
  });

  it('volMult scales volatility; volMult 0 freezes a quiet market', () => {
    const market = marketOf(8);
    const returns = dailyReturns(market, GAME_DAYS, defaultConfig, { volMult: 2 });
    const ratios = market.universe.companies.map((c) => std(returns.get(c.symbol)!) / modelVol(c));
    expect(mean(ratios)).toBeGreaterThan(1.9);
    expect(mean(ratios)).toBeLessThan(2.1);

    const frozen = marketOf(8);
    const before = frozen.getPrices();
    for (let i = 0; i < 30; i++) frozen.step({ volMult: 0 });
    expect(frozen.getPrices()).toEqual(before);
  });

  it('no NaN, zero or negative price over full 8-quarter games', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const market = marketOf(seed);
      for (let i = 0; i < GAME_DAYS * defaultConfig.time.ticksPerCandle; i++) {
        const tick = market.step()[0]!;
        if (tick.e !== 'tick') throw new Error('first event must be the tick');
        for (const symbol of market.universe.symbols) {
          const p = tick.prices[symbol]!;
          if (!(Number.isFinite(p) && p >= mc.priceFloor)) throw new Error(`bad price ${p} for ${symbol}, seed ${seed}, step ${i}`);
        }
      }
      // Still a market at the end: nobody went to the moon or to the floor in a quiet game.
      for (const c of market.universe.companies) {
        const ratio = market.getPrice(c.symbol)! / c.startPrice;
        expect(ratio).toBeGreaterThan(0.02);
        expect(ratio).toBeLessThan(50);
      }
    }
  });

  it('never goes below the price floor, even under absurd input', () => {
    const market = marketOf(3);
    const target = market.universe.companies[0]!.symbol;
    market.step({ symbolReturn: { [target]: -50 } });
    expect(market.getPrice(target)).toBe(mc.priceFloor);
    market.step({ symbolReturn: { [target]: Number.NaN, NOPE: 1 }, dRate: 0 });
    market.step({ volMult: Number.POSITIVE_INFINITY });
    for (const symbol of market.universe.symbols) {
      const p = market.getPrice(symbol)!;
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(mc.priceFloor);
    }
  });
});

describe('market: funds', () => {
  it('fund price equals the weighted basket of its members on every tick', () => {
    const market = marketOf(13);
    expect(market.getPrice(market.universe.funds[0]!.symbol)).toBeCloseTo(mc.fundStartPrice, 9);
    for (let i = 0; i < 2000; i++) {
      const tick = market.step()[0]!;
      if (tick.e !== 'tick') throw new Error('first event must be the tick');
      for (const fund of market.universe.funds) {
        const basket = fund.members.reduce((sum, member, j) => sum + fund.units[j]! * tick.prices[member]!, 0);
        expect(Math.abs(tick.prices[fund.symbol]! / basket - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('the index fund is less volatile than a typical member (diversification)', () => {
    const market = marketOf(13);
    const returns = dailyReturns(market, GAME_DAYS);
    const stockVol = mean(market.universe.companies.map((c) => std(returns.get(c.symbol)!)));
    expect(std(returns.get(market.universe.funds[0]!.symbol)!)).toBeLessThan(stockVol * 0.8);
  });

  it('symbolReturn on a fund moves only that fund (its premium over the basket)', () => {
    const quiet = marketOf(13);
    const pushed = marketOf(13);
    const fund = quiet.universe.funds[3]!;
    for (let i = 0; i < 20; i++) {
      quiet.step();
      pushed.step(i === 5 ? { symbolReturn: { [fund.symbol]: 0.02 } } : undefined);
    }
    const a = quiet.getPrices();
    const b = pushed.getPrices();
    for (const symbol of quiet.universe.symbols) {
      if (symbol === fund.symbol) expect(b[symbol]! / a[symbol]!).toBeCloseTo(Math.exp(0.02), 10);
      else expect(b[symbol]).toBe(a[symbol]);
    }
    // ... and the opposite return takes the premium away again.
    quiet.step();
    pushed.step({ symbolReturn: { [fund.symbol]: -0.02 } });
    expect(pushed.getPrice(fund.symbol)! / quiet.getPrice(fund.symbol)!).toBeCloseTo(1, 10);
  });
});

describe('market: hooks for later milestones', () => {
  const still: MarketStepInput = { volMult: 0 };

  it('dRate moves each stock by rateSensitivity * dRate and is tracked in getRate()', () => {
    const market = marketOf(17);
    const before = market.getPrices();
    expect(market.getRate()).toBe(mc.startRate);
    market.step({ ...still, dRate: mc.rateStep });
    market.step(still);
    expect(market.getRate()).toBeCloseTo(mc.startRate + mc.rateStep, 12);
    for (const c of market.universe.companies) {
      expect(Math.log(market.getPrice(c.symbol)! / before[c.symbol]!)).toBeCloseTo(c.rateSensitivity * mc.rateStep, 10);
    }
    // A hike hurts the market as a whole but helps finance.
    const fundPrice = (sector: string) => market.getPrice(market.universe.funds.find((f) => f.sector === sector)!.symbol)!;
    expect(market.getPrice(market.universe.funds[0]!.symbol)).toBeLessThan(mc.fundStartPrice);
    expect(fundPrice('finance')).toBeGreaterThan(mc.fundStartPrice);
    expect(fundPrice('tech')).toBeLessThan(mc.fundStartPrice);
  });

  it('sectorDriftPerDay is a per-day log drift on that sector only', () => {
    const market = marketOf(17);
    const before = market.getPrices();
    const days = 3;
    for (let i = 0; i < days * defaultConfig.time.ticksPerCandle; i++) market.step({ ...still, sectorDriftPerDay: { defense: 0.01, airlines: -0.02 } });
    for (const c of market.universe.companies) {
      const expected = c.sector === 'defense' ? 0.01 * days : c.sector === 'airlines' ? -0.02 * days : 0;
      expect(Math.log(market.getPrice(c.symbol)! / before[c.symbol]!)).toBeCloseTo(expected, 10);
    }
  });

  it('symbolReturn on a company moves it and the funds that hold it, once', () => {
    const market = marketOf(17);
    const target = market.universe.companies[12]!;
    const before = market.getPrices();
    market.step({ ...still, symbolReturn: { [target.symbol]: 0.05 } });
    market.step(still);
    const after = market.getPrices();
    for (const c of market.universe.companies) {
      expect(Math.log(after[c.symbol]! / before[c.symbol]!)).toBeCloseTo(c === target ? 0.05 : 0, 10);
    }
    for (const fund of market.universe.funds) {
      const j = fund.members.indexOf(target.symbol);
      if (j < 0) expect(after[fund.symbol]).toBeCloseTo(before[fund.symbol]!, 10);
      else expect(after[fund.symbol]! / before[fund.symbol]! - 1).toBeCloseTo(fund.weights[j]! * (Math.exp(0.05) - 1), 10);
    }
  });
});

describe('market: candles and a full game', () => {
  it('4 quarters: 90 candles per quarter, ticksPerCandle ticks per candle, OHLC built from the ticks', () => {
    const { ticksPerCandle, daysPerQuarter, quarters } = defaultConfig.time;
    const sim = startedSim(31);
    const symbols = sim.getUniverse().symbols;
    let phase = 'LOBBY';
    let quarter = 0;
    let dayTicks: Array<Record<string, number>> = [];
    const candlesPerQuarter = new Map<number, number>();
    const candleEvents: Array<Record<string, OHLC>> = [];

    playToFinal(sim, (events) => {
      for (const event of events) {
        if (event.e === 'phase') {
          phase = event.phase;
          quarter = event.quarter;
        } else if (event.e === 'tick') {
          expect(phase).toBe('TRADING');
          expect(event.tickOfDay).toBe(dayTicks.length + 1);
          dayTicks.push(event.prices);
        } else if (event.e === 'candle') {
          expect(phase).toBe('TRADING');
          expect(dayTicks).toHaveLength(ticksPerCandle);
          expect(event.day).toBe(candleEvents.length);
          for (const symbol of symbols) {
            const prices = dayTicks.map((t) => t[symbol]!);
            const { o, h, l, c } = event.ohlc[symbol]!;
            if (o !== prices[0] || c !== prices[prices.length - 1] || h !== Math.max(...prices) || l !== Math.min(...prices)) {
              throw new Error(`candle of ${symbol} on day ${event.day} does not match its ticks`);
            }
            if (!(l <= o && l <= c && o <= h && c <= h && l > 0)) throw new Error(`OHLC invariant broken for ${symbol} on day ${event.day}`);
          }
          candleEvents.push(event.ohlc);
          candlesPerQuarter.set(quarter, (candlesPerQuarter.get(quarter) ?? 0) + 1);
          dayTicks = [];
        }
      }
    });

    expect(dayTicks).toHaveLength(0);
    expect([...candlesPerQuarter.keys()]).toEqual(Array.from({ length: quarters }, (_, i) => i + 1));
    for (const n of candlesPerQuarter.values()) expect(n).toBe(daysPerQuarter);
    expect(daysPerQuarter).toBe(90);

    // History kept in the sim for snapshots == what was emitted.
    const snapshot = sim.getMarketSnapshot();
    expect(snapshot.day).toBe(daysPerQuarter * quarters);
    expect(snapshot.current).toBeNull();
    for (const symbol of symbols) {
      expect(unpackCandles(snapshot.candles[symbol]!)).toEqual(candleEvents.map((ohlc) => ohlc[symbol]));
      expect(snapshot.prices[symbol]).toBe(candleEvents[candleEvents.length - 1]![symbol]!.c);
    }
  });

  it('prices are frozen outside TRADING: the first open of a quarter continues from the last close', () => {
    const config = mergeConfig(defaultConfig, {
      time: { daysPerQuarter: 5, quarters: 2 },
      phaseMs: { BRIEFING: 300, EARNINGS: 200, RESULTS: 200, SHOP: 200 },
    });
    const sim = startedSim(2, config);
    let phase = 'LOBBY';
    let frozen: Record<string, number> | null = null;
    playToFinal(sim, (events) => {
      for (const event of events) if (event.e === 'phase') phase = event.phase;
      const prices = sim.getMarketSnapshot().prices;
      if (phase !== 'TRADING' && !events.some((e) => e.e === 'tick')) {
        if (frozen !== null) expect(prices).toEqual(frozen);
        frozen = prices;
      } else {
        frozen = null;
      }
    });
    expect(sim.getMarketSnapshot().day).toBe(10);
  });

  it('a full 8-quarter headless game is fast', () => {
    // Generous bound (CI noise, cold JIT); the measured time is a few tens of ms.
    const sim = startedSim(77);
    let events = 0;
    const samples: number[] = [];
    const t0 = performance.now();
    playToFinal(sim, (batch) => (events += batch.length));
    samples.push(performance.now() - t0);
    expect(events).toBeGreaterThan(GAME_DAYS * (defaultConfig.time.ticksPerCandle + 1));
    expect(samples[0]).toBeLessThan(1000);
  });

  it('covers all ten sectors in the correlation structure', () => {
    // Each sector fund is more correlated with its own members than with the other stocks.
    const market = marketOf(6);
    const returns = dailyReturns(market, GAME_DAYS);
    for (const sector of SECTORS) {
      const fund = market.universe.funds.find((f) => f.sector === sector)!;
      const fundReturns = returns.get(fund.symbol)!;
      const own = mean(market.universe.companies.filter((c) => c.sector === sector).map((c) => correlation(returns.get(c.symbol)!, fundReturns)));
      const others = mean(market.universe.companies.filter((c) => c.sector !== sector).map((c) => correlation(returns.get(c.symbol)!, fundReturns)));
      expect(own, sector).toBeGreaterThan(others + 0.2);
    }
  });
});
