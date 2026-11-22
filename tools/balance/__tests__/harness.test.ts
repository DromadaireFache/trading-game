import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import { DEFAULT_BOTS, holdIndex, lastTickPump, leveredIndex, newsTrader } from '../bots.ts';
import { eventPlayer, insiderTrader, manipulator } from '../cardBots.ts';
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

describe('card bots', () => {
  const cardGame = mergeConfig(defaultConfig, { time: { quarters: 3, daysPerQuarter: 20 } });

  it('buy cards in SHOP, play them in TRADING, and the harness counts spend, fines and jail', () => {
    // Enough games that every bot is offered the cards it wants (the shop draws from the whole catalog, Mayhem included).
    const games = [11, 12, 13, 14, 15, 16].map((seed) => playGame(seed, cardGame, [newsTrader(), insiderTrader(), manipulator(), eventPlayer()]));
    const rows = games.flatMap((g) => g.bots);
    const of = (name: string) => rows.filter((r) => r.name === name);
    for (const name of ['insider-trader', 'manipulator', 'event-player']) {
      const r = of(name);
      expect(r.reduce((s, x) => s + x.cardsBought, 0)).toBeGreaterThan(0);
      expect(r.reduce((s, x) => s + x.cardsPlayed, 0)).toBeGreaterThan(0);
      expect(r.reduce((s, x) => s + x.cardSpend, 0)).toBeGreaterThan(0);
    }
    for (const r of of('news-trader')) expect(r).toMatchObject({ cardsBought: 0, cardSpend: 0, arrests: 0 });
    for (const r of rows) {
      expect(r.cardsPlayed).toBeLessThanOrEqual(r.cardsBought);
      expect(r.fines).toBeGreaterThanOrEqual(0);
    }
  });

  it('is still deterministic with cards and the shuffled submission order', () => {
    const run = () => playGame(21, cardGame, [newsTrader(), manipulator(), eventPlayer()]);
    expect(run()).toEqual(run());
  });
});
