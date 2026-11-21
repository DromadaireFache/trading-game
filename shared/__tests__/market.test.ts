import { describe, expect, it } from 'vitest';
import {
  candleAt,
  candleCount,
  dayOfQuarter,
  dayToQuarter,
  defaultConfig,
  mergeConfig,
  packCandle,
  quarterFirstDay,
  roundPrice,
  roundSnapshot,
  totalTradingDays,
  unpackCandles,
} from '../index.ts';
import type { MarketSnapshot } from '../index.ts';

describe('market helpers', () => {
  it('maps 0-based days to quarters', () => {
    expect(dayToQuarter(defaultConfig, 0)).toBe(1);
    expect(dayToQuarter(defaultConfig, 89)).toBe(1);
    expect(dayToQuarter(defaultConfig, 90)).toBe(2);
    expect(dayOfQuarter(defaultConfig, 0)).toBe(1);
    expect(dayOfQuarter(defaultConfig, 179)).toBe(90);
    expect(quarterFirstDay(defaultConfig, 3)).toBe(180);
    expect(totalTradingDays(defaultConfig)).toBe(360);
  });

  it('packs and unpacks candles', () => {
    const flat: number[] = [];
    packCandle(flat, { o: 1, h: 3, l: 0.5, c: 2 });
    packCandle(flat, { o: 2, h: 4, l: 2, c: 4 });
    expect(candleCount(flat)).toBe(2);
    expect(candleAt(flat, 1)).toEqual({ o: 2, h: 4, l: 2, c: 4 });
    expect(candleAt(flat, 2)).toBeUndefined();
    expect(unpackCandles(flat)).toEqual([
      { o: 1, h: 3, l: 0.5, c: 2 },
      { o: 2, h: 4, l: 2, c: 4 },
    ]);
  });

  it('rounds prices and snapshots to config.market.priceDecimals without touching the input', () => {
    expect(roundPrice(defaultConfig, 12.3456)).toBe(12.35);
    expect(roundPrice(mergeConfig(defaultConfig, { market: { priceDecimals: 0 } }), 12.5)).toBe(13);
    const snap: MarketSnapshot = {
      universe: { symbols: [{ symbol: 'AAA', name: 'A', kind: 'stock', sector: 'tech', marketCap: 1 }] },
      day: 1,
      tickOfDay: 1,
      prices: { AAA: 1.239 },
      candles: { AAA: [1.001, 1.006, 0.994, 1.004] },
      current: { AAA: { o: 1.004, h: 1.239, l: 1.004, c: 1.239 } },
    };
    const rounded = roundSnapshot(defaultConfig, snap);
    expect(rounded.prices).toEqual({ AAA: 1.24 });
    expect(rounded.candles).toEqual({ AAA: [1, 1.01, 0.99, 1] });
    expect(rounded.current).toEqual({ AAA: { o: 1, h: 1.24, l: 1, c: 1.24 } });
    expect(snap.prices.AAA).toBe(1.239);
  });

  it('rejects market configs that cannot generate a universe', () => {
    expect(() => mergeConfig(defaultConfig, { market: { sectors: 9 } })).toThrow('market.sectors');
    expect(() => mergeConfig(defaultConfig, { market: { marketCapMin: 1e12 } })).toThrow('marketCapMin');
    expect(() => mergeConfig(defaultConfig, { market: { priceFloor: 0 } })).toThrow('priceFloor');
    expect(() => mergeConfig(defaultConfig, { market: { fundWeighting: 'best' as never } })).toThrow('fundWeighting');
    expect(mergeConfig(defaultConfig, { market: { fundWeighting: 'equal' } }).market.fundWeighting).toBe('equal');
  });
});
