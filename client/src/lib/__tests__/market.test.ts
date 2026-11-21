import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, SECTORS } from '@tg/shared';
import type { SymbolInfo } from '@tg/shared';
import { chartTimeToDay, dayToChartTime, formatAxisDay, formatGameDay } from '../chartTime.ts';
import { changeDirection, formatMoneyShort, formatPercent, formatPrice } from '../format.ts';
import { groupSymbols, splitIntoColumns } from '../symbolGroups.ts';

describe('chartTime', () => {
  const configs = [
    defaultConfig,
    mergeConfig(defaultConfig, { time: { daysPerQuarter: 6 } }),
    mergeConfig(defaultConfig, { time: { daysPerQuarter: 365 } }),
    mergeConfig(defaultConfig, { time: { daysPerQuarter: 400 } }),
  ];

  it('is strictly increasing and round-trips for every day of a game', () => {
    for (const config of configs) {
      const days = config.time.daysPerQuarter * config.time.quarters;
      let previous = -Infinity;
      for (let day = 0; day < days; day++) {
        const time = dayToChartTime(config, day);
        expect(time).toBeGreaterThan(previous);
        expect(chartTimeToDay(config, time)).toBe(day);
        previous = time;
      }
    }
  });

  it('puts every quarter start on a January 1st so the axis marks quarters', () => {
    for (let quarter = 1; quarter <= 8; quarter++) {
      const date = new Date(dayToChartTime(defaultConfig, (quarter - 1) * 90) * 1000);
      expect([date.getUTCMonth(), date.getUTCDate()]).toEqual([0, 1]);
    }
  });

  it('labels game time, never dates', () => {
    expect(formatGameDay(defaultConfig, 0)).toBe('Q1 D1');
    expect(formatGameDay(defaultConfig, 106)).toBe('Q2 D17');
    expect(formatAxisDay(defaultConfig, 90)).toBe('Q2');
    expect(formatAxisDay(defaultConfig, 106)).toBe('D17');
  });
});

describe('format', () => {
  it('formats prices with fixed decimals and separators', () => {
    expect(formatPrice(1234.5, 2)).toBe('1,234.50');
    expect(formatPrice(7, 2)).toBe('7.00');
  });

  it('formats signed percentages and agrees with the direction', () => {
    expect(formatPercent(0.0123)).toBe('+1.23%');
    expect(formatPercent(-0.004)).toBe('-0.40%');
    expect(formatPercent(0)).toBe('0.00%');
    expect(formatPercent(-0.00001)).toBe('0.00%');
    expect(formatPercent(1.5)).toBe('+150.0%');
    expect(changeDirection(0.0123)).toBe('up');
    expect(changeDirection(-0.004)).toBe('down');
    expect(changeDirection(-0.00001)).toBe('flat');
  });

  it('shortens big dollar amounts', () => {
    expect(formatMoneyShort(123.44e9)).toBe('$123.4B');
    expect(formatMoneyShort(5e9)).toBe('$5.0B');
    expect(formatMoneyShort(2.5e12)).toBe('$2.5T');
    expect(formatMoneyShort(950)).toBe('$950');
  });
});

describe('symbol groups', () => {
  const universe: SymbolInfo[] = [
    { symbol: 'TG50', name: 'Index', kind: 'index', marketCap: 1 },
    ...SECTORS.map((sector): SymbolInfo => ({ symbol: `X${sector}`, name: `${sector} fund`, kind: 'sector', sector, marketCap: 1 })),
    ...SECTORS.flatMap((sector) =>
      Array.from({ length: 5 }, (_, i): SymbolInfo => ({ symbol: `${sector}${i}`, name: `${sector} ${i}`, kind: 'stock', sector, marketCap: 1 })),
    ),
  ];

  it('puts the funds first, then the sectors in server order', () => {
    const groups = groupSymbols(universe);
    expect(groups.map((g) => g.key)).toEqual(['funds', ...SECTORS]);
    expect(groups[0]!.symbols).toHaveLength(11);
    expect(groups[0]!.symbols[0]!.symbol).toBe('TG50');
    expect(groups.slice(1).every((g) => g.symbols.length === 5)).toBe(true);
    expect(groups[1]!.label).toBe('Technology');
  });

  it('splits 61 symbols into two equally tall columns without losing any', () => {
    const columns = splitIntoColumns(groupSymbols(universe), 2);
    const rows = columns.map((c) => c.reduce((n, g) => n + g.symbols.length + 1, 0));
    expect(rows).toEqual([36, 36]);
    expect(columns.flat().flatMap((g) => g.symbols.map((s) => s.symbol))).toEqual(universe.map((s) => s.symbol));
  });

  it('copes with an empty universe', () => {
    expect(groupSymbols([])).toEqual([]);
    expect(splitIntoColumns([], 2)).toEqual([[], []]);
  });
});
