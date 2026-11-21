import { describe, expect, it } from 'vitest';
import { SECTORS, defaultConfig, mergeConfig } from '@tg/shared';
import type { CardCatalogEntry, LobbyingEffect, RegimeEffect } from '@tg/shared/cards';
import catalogJson from '@tg/shared/data/cards.json';
import { createMarket, createRng, generateUniverse } from '../index.ts';
import { emptyRegimeState, endQuarter, marketInputFor, startRegime } from '../regimes.ts';
import type { RegimeState } from '../regimes.ts';

const catalog = catalogJson as CardCatalogEntry[];
function effectOf(defId: string): RegimeEffect | LobbyingEffect {
  const fx = catalog.find((c) => c.defId === defId)!.effect;
  if (fx.kind !== 'regime' && fx.kind !== 'lobbying') throw new Error(`${defId} is not a regime card`);
  return fx;
}
function start(state: RegimeState, defId: string, extra: { sector?: string; ownerId?: string } = {}) {
  return startRegime(defaultConfig, state, { id: `r_${defId}_${state.active.length}`, defId, name: defId, effect: effectOf(defId), ...extra });
}

describe('regimes', () => {
  it('a quiet state is a quiet market input', () => {
    expect(marketInputFor(emptyRegimeState())).toEqual({ volMult: 1, corrMult: 1, sectorDriftPerDay: {} });
  });

  it('starts a regime from a card and combines active regimes', () => {
    const war = start(emptyRegimeState(), 'war', { ownerId: 'p1' });
    if (!war.ok) throw new Error(war.reason);
    expect(war.regime.regime).toMatchObject({ ownerId: 'p1', quartersLeft: 2, volMult: 1.4 });
    expect(war.startHeadline).toBe('h_seed_0020');
    expect(war.dRate).toBe(0);

    const both = start(war.state, 'pandemic');
    if (!both.ok) throw new Error(both.reason);
    const input = marketInputFor(both.state);
    expect(input.volMult).toBeCloseTo(1.4 * 1.3);
    expect(input.corrMult).toBeCloseTo(1.3 * 1.2);
    expect(input.sectorDriftPerDay!.airlines).toBeCloseTo(-0.003 - 0.004);
    expect(input.sectorDriftPerDay!.defense).toBeCloseTo(0.003);
    expect(emptyRegimeState().active).toHaveLength(0);
  });

  it('refuses a regime past regimes.maxActive', () => {
    let state = emptyRegimeState();
    for (let i = 0; i < defaultConfig.regimes.maxActive; i++) {
      const r = start(state, 'war');
      if (!r.ok) throw new Error(r.reason);
      state = r.state;
    }
    expect(start(state, 'pandemic')).toEqual({ ok: false, reason: 'regime_cap' });
  });

  it('a coup moves the rate up at start and back down when it ends', () => {
    const coup = start(emptyRegimeState(), 'coup');
    if (!coup.ok) throw new Error(coup.reason);
    expect(coup.dRate).toBe(0.005);
    const end = endQuarter(createRng(1), defaultConfig, coup.state);
    expect(end.dRate).toBe(-0.005);
    expect(end.ended.map((e) => e.headline)).toEqual(['h_seed_0012']);
    expect(end.state.active).toEqual([]);
  });

  it('counts down and ends after its quarters', () => {
    const war = start(emptyRegimeState(), 'war');
    if (!war.ok) throw new Error(war.reason);
    const q1 = endQuarter(createRng(1), defaultConfig, war.state);
    expect(q1.ended).toEqual([]);
    expect(q1.state.active[0]!.regime.quartersLeft).toBe(1);
    expect(war.state.active[0]!.regime.quartersLeft).toBe(2);
    const q2 = endQuarter(createRng(1), defaultConfig, q1.state);
    expect(q2.ended.map((e) => e.regime.defId)).toEqual(['war']);
    expect(marketInputFor(q2.state)).toEqual({ volMult: 1, corrMult: 1, sectorDriftPerDay: {} });
  });

  it('lobbying needs a sector and, if it passes, leaves a permanent drift', () => {
    expect(start(emptyRegimeState(), 'lobbying')).toEqual({ ok: false, reason: 'needs_sector' });
    expect(start(emptyRegimeState(), 'lobbying', { sector: 'crypto' })).toEqual({ ok: false, reason: 'unknown_sector' });

    const always = mergeConfig(defaultConfig, { regimes: { lobbyPassProbability: 1 } });
    const never = mergeConfig(defaultConfig, { regimes: { lobbyPassProbability: 0 } });
    const bill = start(emptyRegimeState(), 'lobbying', { sector: 'health' });
    if (!bill.ok) throw new Error(bill.reason);
    expect(marketInputFor(bill.state).sectorDriftPerDay).toEqual({});

    const fx = effectOf('lobbying') as LobbyingEffect;
    let state = bill.state;
    for (let q = 1; q < fx.quarters; q++) state = endQuarter(createRng(1), always, state).state;
    const passed = endQuarter(createRng(1), always, state);
    expect(passed.ended[0]).toMatchObject({ passed: true, headline: fx.headlines.passed });
    expect(marketInputFor(passed.state).sectorDriftPerDay).toEqual({ health: fx.driftIfPassed });

    const failed = endQuarter(createRng(1), never, state);
    expect(failed.ended[0]).toMatchObject({ passed: false, headline: fx.headlines.failed });
    expect(failed.state.permanentDrift).toEqual({});
  });

  it('a war actually lifts defense against airlines in the market', () => {
    const war = start(emptyRegimeState(), 'war');
    if (!war.ok) throw new Error(war.reason);
    const input = marketInputFor(war.state);
    let defenseMinusAirlines = 0;
    for (let seed = 0; seed < 10; seed++) {
      const rng = createRng(seed);
      const universe = generateUniverse(rng.fork(), defaultConfig);
      const market = createMarket(universe, rng.fork(), defaultConfig);
      const fund = (s: (typeof SECTORS)[number]) => universe.funds.find((f) => f.sector === s)!.symbol;
      const before = market.getPrices();
      for (let t = 0; t < defaultConfig.time.daysPerQuarter * defaultConfig.time.ticksPerCandle; t++) market.step(input);
      const after = market.getPrices();
      defenseMinusAirlines += Math.log(after[fund('defense')]! / before[fund('defense')]!) - Math.log(after[fund('airlines')]! / before[fund('airlines')]!);
    }
    // Expected about 90 days * (0.003 + 0.003) = 0.54 per seed; noise averages out over 10 seeds.
    expect(defenseMinusAirlines / 10).toBeGreaterThan(0.3);
  });
});
