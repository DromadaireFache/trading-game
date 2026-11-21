import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, phaseTicks, quarterTicks, scalePhaseLengths, validateConfig } from '../index.ts';

describe('config', () => {
  it('derives the design phase lengths in ticks', () => {
    expect(defaultConfig.time).toEqual({ tickMs: 100, ticksPerCandle: 10, daysPerQuarter: 90, quarters: 4 });
    expect(defaultConfig.phaseMs).toEqual({ BRIEFING: 5_000, EARNINGS: 5_000, RESULTS: 20_000, SHOP: 30_000 });
    expect(phaseTicks(defaultConfig, 'BRIEFING')).toBe(50);
    expect(phaseTicks(defaultConfig, 'TRADING')).toBe(900);
    expect(phaseTicks(defaultConfig, 'EARNINGS')).toBe(50);
    expect(phaseTicks(defaultConfig, 'RESULTS')).toBe(200);
    expect(phaseTicks(defaultConfig, 'SHOP')).toBe(300);
    expect(quarterTicks(defaultConfig)).toBe(1500);
  });

  it('keeps the news sparse (about 3 headlines a quarter) with time to react', () => {
    // 8 to 11 s between a headline and its move: time to read it, find the stock and act.
    expect(defaultConfig.news.randomHeadlinesPerQuarter).toBe(1);
    expect(defaultConfig.news.scheduledBeatsPerQuarter).toBe(1);
    expect(defaultConfig.news.minGapMs).toBe(6_000);
    expect(defaultConfig.news.leadMinMs).toBe(8_000);
    expect(defaultConfig.news.leadMaxMs).toBe(11_000);
    expect(defaultConfig.earnings.leaksPerQuarter).toBe(1);
  });

  it('mergeConfig deep-merges without mutating the base and drops unknown keys', () => {
    const merged = mergeConfig(defaultConfig, { time: { quarters: 2 }, bogus: 1 } as never);
    expect(merged.time.quarters).toBe(2);
    expect(merged.time.tickMs).toBe(defaultConfig.time.tickMs);
    expect(defaultConfig.time.quarters).toBe(4);
    expect('bogus' in merged).toBe(false);
  });

  it('accepts the default config and rejects configs that cannot run a game', () => {
    expect(validateConfig(defaultConfig)).toBe(defaultConfig);
    const bad: Array<[unknown, string]> = [
      [{ time: { tickMs: 0 } }, 'time.tickMs'],
      [{ time: { tickMs: 0.5 } }, 'time.tickMs'],
      [{ time: { daysPerQuarter: -1 } }, 'time.daysPerQuarter'],
      [{ time: { quarters: 'x' } }, 'time.quarters'],
      [{ time: null }, 'config.time'],
      [{ phaseMs: null }, 'config.phaseMs'],
      [{ phaseMs: { SHOP: 0 } }, 'phaseMs.SHOP'],
      [{ lobby: { maxPlayers: null } }, 'lobby.maxPlayers'],
      [{ lobby: { minPlayers: 5 } }, 'lobby.minPlayers'],
      [{ trading: { quickSizePct: [0.1, 'half'] } }, 'trading.quickSizePct[1]'],
      [{ trading: { quickSizePct: 0.5 } }, 'trading.quickSizePct'],
      [{ net: { wsPath: 7 } }, 'net.wsPath'],
      [{ net: { maxMessagesPerSecond: 0 } }, 'net.maxMessagesPerSecond'],
    ];
    for (const [override, where] of bad) {
      expect(() => mergeConfig(defaultConfig, override as never), JSON.stringify(override)).toThrow(where);
    }
    expect(mergeConfig(defaultConfig, { trading: { quickSizePct: [0.5] }, lobby: { ghostGraceMs: 0 } }).trading.quickSizePct).toEqual([0.5]);
  });

  it('scalePhaseLengths shortens every phase and never reaches zero', () => {
    const fast = scalePhaseLengths(defaultConfig, 0.1);
    expect(phaseTicks(fast, 'BRIEFING')).toBe(5);
    expect(phaseTicks(fast, 'TRADING')).toBe(90);
    const tiny = scalePhaseLengths(defaultConfig, 0.0001);
    expect(phaseTicks(tiny, 'EARNINGS')).toBe(1);
    expect(tiny.time.daysPerQuarter).toBe(1);
  });
});
