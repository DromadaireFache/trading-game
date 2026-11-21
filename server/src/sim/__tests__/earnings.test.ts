import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, msToTicks, validateConfig } from '@tg/shared';
import { createRng, generateUniverse } from '../index.ts';
import { drawEarnings, earningsGap, pricedIn } from '../earnings.ts';

const universe = generateUniverse(createRng(8).fork(), defaultConfig);
const e = defaultConfig.earnings;
const tradingTicks = defaultConfig.time.daysPerQuarter * defaultConfig.time.ticksPerCandle;

describe('earnings', () => {
  it('is deterministic and draws one surprise per company', () => {
    const a = drawEarnings(createRng(1), defaultConfig, universe, 1, 0);
    const b = drawEarnings(createRng(1), defaultConfig, universe, 1, 0);
    expect(a).toEqual(b);
    expect(Object.keys(a.surprise)).toEqual(universe.companies.map((c) => c.symbol));
  });

  it('surprises have the configured spread', () => {
    const rng = createRng(2);
    const values: number[] = [];
    for (let q = 0; q < 200; q++) values.push(...Object.values(drawEarnings(rng, defaultConfig, universe, q, 0).surprise));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(Math.abs(mean)).toBeLessThan(0.005);
    expect(sd).toBeCloseTo(e.surpriseSigma, 2);
  });

  it('leaks hit distinct companies inside the quarter and settle before the close', () => {
    const settle = 2 * msToTicks(defaultConfig, defaultConfig.news.rampMs);
    const rng = createRng(3);
    for (let q = 0; q < 100; q++) {
      const start = q * tradingTicks;
      const plan = drawEarnings(rng, defaultConfig, universe, q, start);
      expect(plan.leaks).toHaveLength(e.leaksPerQuarter);
      expect(new Set(plan.leaks.map((l) => l.symbol)).size).toBe(plan.leaks.length);
      for (const [i, leak] of plan.leaks.entries()) {
        expect(leak.tick).toBeGreaterThanOrEqual(start);
        expect(leak.tick + settle).toBeLessThanOrEqual(start + tradingTicks);
        if (i > 0) expect(leak.tick).toBeGreaterThanOrEqual(plan.leaks[i - 1]!.tick);
        const share = leak.amount / plan.surprise[leak.symbol]!;
        expect(share).toBeGreaterThanOrEqual(e.leakShareMin);
        expect(share).toBeLessThanOrEqual(e.leakShareMax);
        expect(leak.logReturn).toBeCloseTo(e.gapFactor * leak.amount);
      }
    }
  });

  it('leak moves plus the gap add up to the full surprise', () => {
    const config = mergeConfig(defaultConfig, { earnings: { gapFactor: 1.5 } });
    const plan = drawEarnings(createRng(4), config, universe, 1, 0);
    const gap = earningsGap(config, plan);
    for (const [symbol, s] of Object.entries(plan.surprise)) {
      const leaked = plan.leaks.filter((l) => l.symbol === symbol).reduce((sum, l) => sum + l.logReturn, 0);
      expect(leaked + gap[symbol]!).toBeCloseTo(1.5 * s, 12);
    }
  });

  it('pricedIn only counts leaks up to a tick', () => {
    const plan = drawEarnings(createRng(5), defaultConfig, universe, 1, 0);
    const first = plan.leaks[0]!;
    expect(pricedIn(plan, first.tick - 1)).toEqual({});
    expect(pricedIn(plan, first.tick)[first.symbol]).toBeCloseTo(first.amount);
  });

  it('caps leaks at the number of companies and allows none', () => {
    const many = mergeConfig(defaultConfig, { earnings: { leaksPerQuarter: 999 } });
    expect(drawEarnings(createRng(6), many, universe, 1, 0).leaks).toHaveLength(universe.companies.length);
    const none = mergeConfig(defaultConfig, { earnings: { leaksPerQuarter: 0 } });
    expect(drawEarnings(createRng(6), none, universe, 1, 0).leaks).toEqual([]);
  });

  it('config rejects an impossible leak share range', () => {
    expect(() => validateConfig({ ...defaultConfig, earnings: { ...e, leakShareMin: 0.8, leakShareMax: 0.5 } })).toThrow('leakShareMin');
    expect(() => validateConfig({ ...defaultConfig, earnings: { ...e, leakShareMax: 1.5 } })).toThrow('leakShareMin');
  });
});
