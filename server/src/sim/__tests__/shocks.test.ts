import { describe, expect, it } from 'vitest';
import { defaultConfig, msToTicks } from '@tg/shared';
import { createMarket, createRng, generateUniverse } from '../index.ts';
import {
  addReturns,
  createShock,
  drawDebunkTick,
  nearestMagnitude,
  revertShock,
  shockLevel,
  shockSize,
  shockSymbols,
  stepShocks,
} from '../shocks.ts';
import type { Shock } from '../shocks.ts';

const universe = generateUniverse(createRng(5).fork(), defaultConfig);
const stock = universe.companies[0]!.symbol;
const R = msToTicks(defaultConfig, defaultConfig.news.rampMs);

/** Sum of a shock's per-tick returns on one symbol over [from, to]. */
function applied(shocks: Shock[], symbol: string, from: number, to: number): { total: number; peak: number } {
  let live = shocks;
  let total = 0;
  let peak = 0;
  for (let t = from; t <= to; t++) {
    const step = stepShocks(live, t);
    live = step.live;
    total += step.symbolReturn[symbol] ?? 0;
    if (Math.abs(total) > Math.abs(peak)) peak = total;
  }
  return { total, peak };
}

describe('shocks', () => {
  it('maps targets to companies', () => {
    expect(shockSymbols(universe, { scope: 'market' })).toHaveLength(universe.companies.length);
    expect(shockSymbols(universe, { scope: 'sector', sector: 'energy' })).toHaveLength(defaultConfig.market.companiesPerSector);
    expect(shockSymbols(universe, { scope: 'stock', symbol: stock })).toEqual([stock]);
    expect(shockSymbols(universe, { scope: 'stock', symbol: universe.funds[0]!.symbol })).toEqual([]);
  });

  it('sizes and magnitudes come from news.shock', () => {
    expect(shockSize(defaultConfig, 'large', 'down')).toBe(-defaultConfig.news.shock.large);
    expect(shockSize(defaultConfig, 'huge', 'neutral')).toBe(0);
    expect(nearestMagnitude(defaultConfig, -0.06)).toBe('medium');
    expect(nearestMagnitude(defaultConfig, 1)).toBe('huge');
    expect(nearestMagnitude(defaultConfig, 0)).toBe('small');
  });

  it('ramps in over rampMs, overshoots, then settles on exactly the move', () => {
    const m = 0.05;
    const shock = createShock(defaultConfig, universe, { id: 's', target: { scope: 'stock', symbol: stock }, logReturn: m, startTick: 100 });
    expect(shockLevel(shock, 99)).toBe(0);
    expect(shockLevel(shock, 100 + R - 1)).toBeCloseTo(m * (1 + defaultConfig.news.overshoot));
    const { total, peak } = applied([shock], stock, 90, 100 + 4 * R);
    expect(total).toBeCloseTo(m, 12);
    expect(peak).toBeCloseTo(m * (1 + defaultConfig.news.overshoot), 6);
  });

  it('a debunk reverts the move to zero', () => {
    const base = createShock(defaultConfig, universe, { id: 'f', target: { scope: 'sector', sector: 'tech' }, logReturn: -0.12, startTick: 0 });
    const fake = { ...base, revertTick: drawDebunkTick(createRng(3), defaultConfig, 0) };
    const tech = shockSymbols(universe, { scope: 'sector', sector: 'tech' })[0]!;
    expect(applied([fake], tech, 0, fake.revertTick! + 2 * R).total).toBeCloseTo(0, 12);
    expect(applied([fake], tech, 0, fake.revertTick! - 1).total).toBeCloseTo(-0.12, 12);
  });

  it('draws the debunk inside cards.fakeDebunk{Min,Max}Ms', () => {
    const min = msToTicks(defaultConfig, defaultConfig.cards.fakeDebunkMinMs);
    const max = msToTicks(defaultConfig, defaultConfig.cards.fakeDebunkMaxMs);
    const rng = createRng(9);
    for (let i = 0; i < 500; i++) {
      const d = drawDebunkTick(rng, defaultConfig, 50) - 50;
      expect(d).toBeGreaterThanOrEqual(min);
      expect(d).toBeLessThanOrEqual(max);
    }
  });

  it('a fact-check mid-ramp reverts from where it was; later debunks do not move it again', () => {
    const shock = createShock(defaultConfig, universe, { id: 'f', target: { scope: 'stock', symbol: stock }, logReturn: 0.1, startTick: 0 });
    const checked = revertShock({ ...shock, revertTick: 150 }, 10);
    expect(checked.revertTick).toBe(10);
    expect(revertShock(checked, 50)).toBe(checked);
    expect(applied([checked], stock, 0, 200).total).toBeCloseTo(0, 12);
  });

  it('drops settled shocks but keeps ones with a pending debunk', () => {
    const event = createShock(defaultConfig, universe, { id: 'e', target: { scope: 'market' }, logReturn: 0.02, startTick: 0 });
    const fake = { ...event, id: 'f', revertTick: 500 };
    const { live } = stepShocks([event, fake], 3 * R);
    expect(live.map((s) => s.id)).toEqual(['f']);
  });

  it('stacks shocks on one symbol and adds into other returns', () => {
    const a = createShock(defaultConfig, universe, { id: 'a', target: { scope: 'stock', symbol: stock }, logReturn: 0.05, startTick: 0 });
    const b = createShock(defaultConfig, universe, { id: 'b', target: { scope: 'market' }, logReturn: -0.02, startTick: 0 });
    expect(applied([a, b], stock, 0, 3 * R).total).toBeCloseTo(0.03, 12);
    expect(addReturns({ X: 0.01 }, { X: 0.02, Y: 0.03 })).toEqual({ X: 0.03, Y: 0.03 });
  });

  it('moves the real market by the shock (against the same seed without it)', () => {
    const run = (withShock: boolean) => {
      const rng = createRng(21);
      const u = generateUniverse(rng.fork(), defaultConfig);
      const market = createMarket(u, rng.fork(), defaultConfig);
      const target = u.companies[3]!.symbol;
      let shocks = withShock ? [createShock(defaultConfig, u, { id: 's', target: { scope: 'stock', symbol: target }, logReturn: 0.12, startTick: 5 })] : [];
      for (let t = 0; t < 100; t++) {
        const step = stepShocks(shocks, t);
        shocks = step.live;
        market.step({ symbolReturn: step.symbolReturn });
      }
      return market.getPrice(target)!;
    };
    expect(Math.log(run(true) / run(false))).toBeCloseTo(0.12, 9);
  });
});
