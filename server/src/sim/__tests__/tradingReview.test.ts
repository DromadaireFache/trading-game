/** M3 review: the leverage clip must account for the order's own slippage. */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, valuePortfolio } from '@tg/shared';
import { createMarket, createRng, createTrading, generateUniverse } from '../index.ts';

function setup(startingCash: number) {
  const config = mergeConfig(defaultConfig, { economy: { startingCash } });
  const rng = createRng(1);
  const universe = generateUniverse(rng.fork(), config);
  const market = createMarket(universe, rng.fork(), config);
  const adv = new Map([...universe.companies.map((c) => [c.symbol, c.adv] as const), ...universe.funds.map((f) => [f.symbol, f.adv] as const)]);
  const trading = createTrading({ config, priceOf: (s) => market.getPrice(s), advOf: (s) => adv.get(s), now: () => 0 });
  trading.addAccount('p');
  const byAdv = [...universe.companies].sort((a, b) => a.adv - b.adv);
  const leverageAtMid = () => {
    const a = trading.getAccount('p')!;
    const positions = [...a.holdings].filter(([, h]) => h.qty !== 0).map(([symbol, h]) => ({ symbol, qty: h.qty, avgPrice: h.avgPrice }));
    return valuePortfolio(config, a.cash, positions, (s) => market.getPrice(s)).leverage;
  };
  return { config, trading, market, smallCap: byAdv[0]!.symbol, bigCap: byAdv[byAdv.length - 1]!.symbol, leverageAtMid };
}

describe('leverage clip with slippage', () => {
  for (const cash of [10e6, 100e6, 1e9]) {
    it(`a max-size buy or short at $${cash / 1e6}M stays within the cap at mid`, () => {
      for (const side of [1, -1]) {
        for (const pick of ['smallCap', 'bigCap'] as const) {
          const s = setup(cash);
          expect(s.trading.order('p', s[pick], side * 1e15).ok).toBe(true);
          expect(s.leverageAtMid()).toBeLessThanOrEqual(s.config.trading.leverageCap + 1e-9);
          expect(s.leverageAtMid()).toBeGreaterThan(s.config.trading.leverageCap * 0.5);
        }
      }
    });
  }

  it('a max-size order cannot raise its own net worth through its price impact', () => {
    for (const cash of [10e6, 100e6, 1e9]) {
      const s = setup(cash);
      s.trading.order('p', s.smallCap, 1e15);
      // Value right at the fill and again after the impact went into the price (the game could end here).
      expect(s.trading.portfolio('p')!.equity).toBeLessThan(cash);
      const input = s.trading.stepInput();
      s.market.step(input === undefined ? undefined : { symbolReturn: input });
      expect(s.trading.portfolio('p')!.equity).toBeLessThan(cash);
    }
  });

  it('flipping a position at the cap is still clipped, and at worst closes it', () => {
    const s = setup(100e6);
    s.trading.order('p', s.smallCap, 1e15);
    expect(s.trading.order('p', s.smallCap, -1e15).ok).toBe(true);
    expect(s.leverageAtMid()).toBeLessThanOrEqual(s.config.trading.leverageCap + 1e-9);
  });
});
