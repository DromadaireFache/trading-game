/**
 * Contract of the market as seen from OUTSIDE the sim (server shell, client, harness). Written by
 * the milestone-2 foundation: these must keep passing whatever the sim-market track does inside
 * universe.ts / market.ts. The statistical tests (correlation, volatility, ...) live elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { SECTORS, candleCount, defaultConfig, mergeConfig, phaseTicks, unpackCandles } from '@tg/shared';
import type { GameConfig } from '@tg/shared';
import { createSim } from '../index.ts';
import type { Sim, SimEvent } from '../index.ts';

const fast: GameConfig = mergeConfig(defaultConfig, {
  time: { tickMs: 100, ticksPerCandle: 4, daysPerQuarter: 3, quarters: 2 },
  phaseMs: { BRIEFING: 200, EARNINGS: 100, RESULTS: 100, SHOP: 100 },
});

function started(config: GameConfig, seed = 7): Sim {
  const sim = createSim(seed, config);
  sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
  sim.submit({ kind: 'start', playerId: 'p1' });
  return sim;
}

function playToFinal(sim: Sim): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < 10_000 && sim.getState().phase !== 'FINAL'; i++) all.push(...sim.tick());
  return all;
}

describe('market contract', () => {
  it('universe: canonical order, unique tickers, public view hides sim parameters', () => {
    const sim = createSim(1, defaultConfig);
    const universe = sim.getUniverse();
    const info = sim.getMarketSnapshot().universe;

    expect(universe.companies).toHaveLength(30);
    expect(universe.funds).toHaveLength(7);
    expect(new Set(universe.symbols).size).toBe(37);
    expect(info.symbols.map((s) => s.symbol)).toEqual(universe.symbols);
    expect(info.symbols.map((s) => s.kind)).toEqual(['index', ...SECTORS.map(() => 'sector'), ...universe.companies.map(() => 'stock')]);
    expect(info.symbols.slice(1, 7).map((s) => s.sector)).toEqual([...SECTORS]);
    expect(info.symbols.slice(7).map((s) => s.sector)).toEqual(SECTORS.flatMap((s) => [s, s, s, s, s]));

    const allowed = new Set(['symbol', 'name', 'kind', 'sector', 'marketCap', 'ceo', 'members']);
    for (const symbol of info.symbols) {
      for (const key of Object.keys(symbol)) expect(allowed.has(key), key).toBe(true);
    }
  });

  it('lobby snapshot: start prices, no candles', () => {
    const snap = createSim(1, defaultConfig).getMarketSnapshot();
    expect(snap.day).toBe(0);
    expect(snap.tickOfDay).toBe(0);
    expect(snap.current).toBeNull();
    for (const { symbol } of snap.universe.symbols) {
      expect(snap.candles[symbol]).toEqual([]);
      expect(snap.prices[symbol]).toBeGreaterThan(0);
    }
  });

  it('ticks only in TRADING; candles numbered on across quarters; tick -> candle -> phase order', () => {
    const sim = started(fast);
    let phase = 'LOBBY';
    const candleDays: number[] = [];
    const tickKeys: string[] = [];
    for (let i = 0; i < 10_000 && sim.getState().phase !== 'FINAL'; i++) {
      const events = sim.tick();
      const kinds = events.map((e) => e.e);
      if (kinds.includes('candle')) expect(kinds.indexOf('candle')).toBe(kinds.indexOf('tick') + 1);
      if (kinds.includes('phase') && kinds.includes('tick')) expect(kinds.indexOf('phase')).toBeGreaterThan(kinds.indexOf('tick'));
      for (const event of events) {
        if (event.e === 'tick') {
          expect(phase).toBe('TRADING');
          expect(Object.keys(event.prices)).toEqual(sim.getUniverse().symbols);
          tickKeys.push(`${event.day}:${event.tickOfDay}`);
        } else if (event.e === 'candle') {
          expect(phase).toBe('TRADING');
          candleDays.push(event.day);
        } else if (event.e === 'phase') {
          phase = event.phase;
        }
      }
    }
    expect(candleDays).toEqual([0, 1, 2, 3, 4, 5]);
    const expectedTicks: string[] = [];
    for (let day = 0; day < 6; day++) for (let t = 1; t <= 4; t++) expectedTicks.push(`${day}:${t}`);
    expect(tickKeys).toEqual(expectedTicks);
    expect(tickKeys).toHaveLength(phaseTicks(fast, 'TRADING') * fast.time.quarters);
  });

  it('snapshot history equals the candle events, including the partial day', () => {
    const sim = started(fast);
    const candles: Array<{ day: number; o: number; h: number; l: number; c: number }> = [];
    const symbol = sim.getUniverse().symbols[0]!;
    let midDayChecked = false;
    for (let i = 0; i < 10_000 && sim.getState().phase !== 'FINAL'; i++) {
      for (const event of sim.tick()) {
        if (event.e === 'candle') candles.push({ day: event.day, ...event.ohlc[symbol]! });
        if (event.e === 'tick' && event.day === 4 && event.tickOfDay === 2) {
          const snap = sim.getMarketSnapshot();
          expect(snap.day).toBe(4);
          expect(snap.tickOfDay).toBe(2);
          expect(candleCount(snap.candles[symbol]!)).toBe(4);
          expect(snap.current?.[symbol]?.c).toBe(event.prices[symbol]);
          expect(snap.prices[symbol]).toBe(event.prices[symbol]);
          midDayChecked = true;
        }
      }
    }
    expect(midDayChecked).toBe(true);
    const snap = sim.getMarketSnapshot();
    expect(snap.day).toBe(6);
    expect(snap.current).toBeNull();
    expect(unpackCandles(snap.candles[symbol]!)).toEqual(candles.map(({ o, h, l, c }) => ({ o, h, l, c })));
    for (const { symbol: s } of snap.universe.symbols) expect(candleCount(snap.candles[s]!)).toBe(6);
  });

  it('same seed -> same events; different seed -> different prices', () => {
    const a = playToFinal(started(fast, 42));
    const b = playToFinal(started(fast, 42));
    const c = playToFinal(started(fast, 43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
