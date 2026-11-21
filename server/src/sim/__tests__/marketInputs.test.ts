/** Absurd MarketStepInput values must not corrupt the market (review of milestone 2). */
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@tg/shared';
import { createMarket, createRng, generateUniverse } from '../index.ts';
import type { Market } from '../index.ts';

function marketOf(seed: number): Market {
  const rng = createRng(seed);
  return createMarket(generateUniverse(rng.fork(), defaultConfig), rng.fork(), defaultConfig);
}

describe('market step input sanitizing', () => {
  it('ignores a non-finite dRate instead of poisoning the rate', () => {
    const m = marketOf(1);
    m.step({ dRate: Number.NaN });
    m.step({ dRate: Number.POSITIVE_INFINITY });
    expect(m.getRate()).toBe(defaultConfig.market.startRate);
    m.step({ dRate: defaultConfig.market.rateStep });
    expect(m.getRate()).toBeCloseTo(defaultConfig.market.startRate + defaultConfig.market.rateStep);
  });

  it('treats non-finite multipliers and drifts as a quiet step (same prices as no input)', () => {
    const a = marketOf(2);
    const b = marketOf(2);
    for (let i = 0; i < 50; i++) {
      a.step();
      b.step({ volMult: Number.POSITIVE_INFINITY, corrMult: Number.NaN, sectorDriftPerDay: { tech: Number.NaN } });
    }
    expect(b.getPrices()).toEqual(a.getPrices());
  });
});
