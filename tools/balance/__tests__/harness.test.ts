import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import { DEFAULT_BOTS, holdIndex, lastTickPump, leveredIndex } from '../bots.ts';
import { playGame, quantile, summarize } from '../harness.ts';

const short = mergeConfig(defaultConfig, { time: { quarters: 2, daysPerQuarter: 10 } });

describe('balance harness', () => {
  it('is deterministic per seed and plays to FINAL with every bot', () => {
    const a = playGame(3, short, DEFAULT_BOTS);
    const b = playGame(3, short, DEFAULT_BOTS);
    expect(a).toEqual(b);
    expect(a.bots).toHaveLength(DEFAULT_BOTS.length);
    for (const bot of a.bots) {
      expect(Number.isFinite(bot.netWorth)).toBe(true);
      expect(bot.orders).toBeGreaterThan(0);
    }
    expect(a.winner.netWorth).toBe(Math.max(...a.bots.map((x) => x.netWorth)));
  });

  it('hold-index tracks the index fund', () => {
    const g = playGame(5, short, [holdIndex]);
    expect(g.bots[0]!.netWorth / short.economy.startingCash).toBeGreaterThan(0.7);
    expect(g.bots[0]!.netWorth / short.economy.startingCash).toBeLessThan(1.4);
  });

  it('the last-tick pump only differs from levered-index on the final step', () => {
    const a = playGame(7, short, [leveredIndex]).bots[0]!;
    const b = playGame(7, short, [lastTickPump]).bots[0]!;
    expect(b.orders).toBeGreaterThan(a.orders);
    expect(b.netWorth).not.toBe(a.netWorth);
  });

  it('summarizes quantiles and wins', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const games = [1, 2, 3].map((seed) => playGame(seed, short, [holdIndex, leveredIndex]));
    const s = summarize(short, games);
    expect(s.games).toBe(3);
    expect(Object.values(s.winner.byBot).reduce((x, y) => x + y, 0)).toBe(3);
    expect(Object.keys(s.bots)).toEqual(['hold-index', 'levered-index']);
  });
});
