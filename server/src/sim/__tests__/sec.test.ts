import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import { createRng } from '../rng.ts';
import { addHeat, catchProbability, isJailed, jailDaysFor, resolveSec } from '../sec.ts';
import type { SecPlayer } from '../sec.ts';

const sec = defaultConfig.sec;
const certain = mergeConfig(defaultConfig, { sec: { catchProbabilityPerHeat: 1, maxCatchProbability: 1 } });

describe('sec', () => {
  it('addHeat adds config heat and tracks sources without mutating', () => {
    const sources = {};
    const a = addHeat(defaultConfig, 0, sources, 'insiderTip');
    const b = addHeat(defaultConfig, a.heat, a.sources, 'insiderTip');
    expect(b.heat).toBe(2 * sec.heat.insiderTip);
    expect(b.sources).toEqual({ insiderTip: 2 * sec.heat.insiderTip });
    expect(sources).toEqual({});
  });

  it('richer players are watched more closely, capped at maxCatchProbability', () => {
    expect(catchProbability(defaultConfig, 50, 0)).toBeCloseTo(50 * sec.catchProbabilityPerHeat * sec.rankMultiplier[0]!);
    expect(catchProbability(defaultConfig, 50, 0)).toBeGreaterThan(catchProbability(defaultConfig, 50, 3));
    expect(catchProbability(defaultConfig, 50, 99)).toBe(catchProbability(defaultConfig, 50, sec.rankMultiplier.length - 1));
    expect(catchProbability(defaultConfig, 1e6, 0)).toBe(sec.maxCatchProbability);
    expect(catchProbability(defaultConfig, 0, 0)).toBe(0);
    expect(catchProbability(defaultConfig, -10, 0)).toBe(0);
  });

  it('jail lasts jailQuarters quarters of trading days', () => {
    expect(jailDaysFor(defaultConfig)).toBe(sec.jailQuarters * defaultConfig.time.daysPerQuarter);
  });

  it('a caught player is fined, jailed from the next trading day and loses their heat', () => {
    const players: SecPlayer[] = [{ playerId: 'p1', name: 'Ada', heat: 30, netWorth: 50e6, sources: { fakeHeadline: 30 } }];
    const { outcomes, arrests } = resolveSec(createRng(1), certain, players, 180);
    expect(outcomes[0]).toMatchObject({ caught: true, fine: 50e6 * sec.fineShareOfNetWorth, jailDays: jailDaysFor(defaultConfig), jailedUntil: 180 + jailDaysFor(defaultConfig), heatAfter: 0 });
    expect(arrests).toHaveLength(1);
    expect(arrests[0]!.text).toBe(`Ada arrested for spreading fake news. ${jailDaysFor(defaultConfig)} days.`);
  });

  it('picks the reason from the largest heat source', () => {
    const players: SecPlayer[] = [{ playerId: 'p1', name: 'Bo', heat: 80, netWorth: 1e6, sources: { insiderTip: 20, illegalEvent: 40, fakeHeadline: 20 } }];
    expect(resolveSec(createRng(1), certain, players, 0).arrests[0]!.reason).toBe('sabotage');
  });

  it('clean players are never caught and nobody is rolled twice while in jail', () => {
    const players: SecPlayer[] = [
      { playerId: 'clean', name: 'C', heat: 0, netWorth: 1e9 },
      { playerId: 'jailed', name: 'J', heat: 100, netWorth: 1e6, jailedUntil: 200 },
    ];
    const { outcomes, arrests } = resolveSec(createRng(1), certain, players, 180);
    expect(arrests).toEqual([]);
    expect(outcomes.find((o) => o.playerId === 'jailed')).toMatchObject({ caught: false, probability: 0, heatAfter: 100 * sec.heatDecayPerQuarter });
  });

  it('ranks by net worth, skips eliminated players and decays heat when not caught', () => {
    const never = mergeConfig(defaultConfig, { sec: { catchProbabilityPerHeat: 0 } });
    const players: SecPlayer[] = [
      { playerId: 'poor', name: 'P', heat: 40, netWorth: 1e6 },
      { playerId: 'out', name: 'O', heat: 40, netWorth: 5e9, eliminated: true },
      { playerId: 'rich', name: 'R', heat: 40, netWorth: 2e9 },
    ];
    const { outcomes } = resolveSec(createRng(1), never, players, 0);
    expect(outcomes.map((o) => [o.playerId, o.rank])).toEqual([['poor', 1], ['rich', 0]]);
    for (const o of outcomes) expect(o.heatAfter).toBe(40 * sec.heatDecayPerQuarter);
  });

  it('catch rate matches the probability over many rolls', () => {
    const rng = createRng(42);
    const players: SecPlayer[] = [{ playerId: 'p', name: 'P', heat: 50, netWorth: 1e6 }];
    let caught = 0;
    const runs = 20_000;
    for (let i = 0; i < runs; i++) if (resolveSec(rng, defaultConfig, players, 0).arrests.length) caught++;
    expect(caught / runs).toBeCloseTo(catchProbability(defaultConfig, 50, 0), 1);
  });

  it('a player who played no illegal card this quarter is not rolled', () => {
    const config = mergeConfig(defaultConfig, { sec: { catchProbabilityPerHeat: 1, maxCatchProbability: 1 } });
    const players = [
      { playerId: 'a', name: 'A', heat: 100, netWorth: 1, playedIllegal: false },
      { playerId: 'b', name: 'B', heat: 100, netWorth: 1, playedIllegal: true },
    ];
    const { outcomes } = resolveSec(createRng(1), config, players, 90);
    expect(outcomes.map((o) => o.caught)).toEqual([false, true]);
    expect(outcomes[0]!.probability).toBe(0);
    expect(outcomes[0]!.heatAfter).toBe(100 * config.sec.heatDecayPerQuarter);
  });

  it('isJailed is true until the release day', () => {
    expect(isJailed(undefined, 10)).toBe(false);
    expect(isJailed(100, 99.5)).toBe(true);
    expect(isJailed(100, 100)).toBe(false);
  });
});
