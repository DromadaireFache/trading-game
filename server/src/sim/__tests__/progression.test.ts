import { describe, expect, it } from 'vitest';
import { defaultConfig, quarterRamp } from '@tg/shared';
import type { CardCatalogEntry, RegimeEffect } from '@tg/shared/cards';
import catalogJson from '@tg/shared/data/cards.json';
import { emptyRegimeState, startRegime } from '../regimes.ts';
import { drawShopSelection, priceShopOffers, underdogs } from '../shop.ts';
import { createRng } from '../index.ts';

const catalog = catalogJson as CardCatalogEntry[];

describe('quarter progression', () => {
  it('ramps linearly from 1 in Q1 to the last-quarter value', () => {
    const c = defaultConfig; // 4 quarters
    [1, 4 / 3, 5 / 3, 2].forEach((want, i) => expect(quarterRamp(c, i + 1, 2)).toBeCloseTo(want));
    expect(quarterRamp({ ...defaultConfig, time: { ...defaultConfig.time, quarters: 1 } }, 1, 2)).toBe(1);
  });

  it('a regime played with more power drifts further and boosts vol further from 1', () => {
    const war = catalog.find((e) => e.defId === 'war')!.effect as RegimeEffect;
    const base = startRegime(defaultConfig, emptyRegimeState(), { id: 'a', defId: 'war', name: 'war', effect: war });
    const strong = startRegime(defaultConfig, emptyRegimeState(), { id: 'b', defId: 'war', name: 'war', effect: war, power: 2 });
    if (!base.ok || !strong.ok) throw new Error('regime did not start');
    expect(strong.regime.regime.volMult - 1).toBeCloseTo(2 * (base.regime.regime.volMult - 1));
    for (const [sector, d] of Object.entries(base.regime.regime.sectorDrift)) {
      expect(strong.regime.regime.sectorDrift[sector as keyof typeof base.regime.regime.sectorDrift]).toBeCloseTo(2 * (d as number));
    }
  });

  it('the bottom half by net worth shops at a discount', () => {
    expect([...underdogs([{ id: 'a', equity: 5 }, { id: 'b', equity: 9 }, { id: 'c', equity: 1 }, { id: 'd', equity: 7 }])].sort()).toEqual(['a', 'c']);
    expect([...underdogs([{ id: 'a', equity: 5 }, { id: 'b', equity: 9 }, { id: 'c', equity: 1 }])]).toEqual(['c']);
    expect(underdogs([{ id: 'a', equity: 5 }]).size).toBe(0);
    const selection = drawShopSelection(createRng(1), catalog, defaultConfig, { quarter: 1, activeRegimes: 0 });
    const full = priceShopOffers(selection, defaultConfig, 10_000_000);
    const cheap = priceShopOffers(selection, defaultConfig, 10_000_000, 0.25);
    cheap.forEach((o, i) => {
      expect(o.price).toBe(Math.round(full[i]!.price * 0.75));
      expect(o.discount).toBe(0.25);
    });
    expect(full[0]!.discount).toBeUndefined();
  });
});

describe('game length', () => {
  it('keeps the days of a quarter and stretches the day, with the tick near the base', async () => {
    const { withGameLength, quarterSeconds } = await import('@tg/shared');
    expect(quarterSeconds(defaultConfig)).toBe(90);
    expect(withGameLength(defaultConfig, 4, 90).time).toEqual(defaultConfig.time);
    for (const seconds of [30, 60, 180]) {
      const t = withGameLength(defaultConfig, 8, seconds).time;
      expect(t.quarters).toBe(8);
      expect(t.daysPerQuarter).toBe(90);
      expect(t.daysPerQuarter * t.ticksPerCandle * t.tickMs).toBeCloseTo(seconds * 1000, 6);
      expect(t.tickMs).toBeGreaterThan(80);
      expect(t.tickMs).toBeLessThan(125);
    }
  });
});
