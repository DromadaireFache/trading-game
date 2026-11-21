import { describe, expect, it } from 'vitest';
import { QUARTER_PHASES, defaultConfig, mergeConfig, phaseTicks, quarterTicks } from '@tg/shared';
import type { GameConfig, Phase } from '@tg/shared';
import { createSim, nextPhase } from '../index.ts';
import type { Sim, SimEvent, SimEventOf } from '../index.ts';

/** Small, uneven phase lengths so an off-by-one in any phase shows up. */
const fast: GameConfig = mergeConfig(defaultConfig, {
  time: { tickMs: 100, ticksPerCandle: 2, daysPerQuarter: 3, quarters: 3 },
  phaseMs: { BRIEFING: 300, EARNINGS: 100, RESULTS: 400, SHOP: 200 },
  lobby: { minPlayers: 1, maxPlayers: 4 },
});

interface Logged {
  tick: number;
  event: SimEvent;
}

function startedSim(config: GameConfig, seed = 1): { sim: Sim; log: Logged[] } {
  const sim = createSim(seed, config);
  const log: Logged[] = [];
  sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
  sim.submit({ kind: 'start', playerId: 'p1' });
  return { sim, log };
}

function run(sim: Sim, log: Logged[], ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const tick = sim.getState().tick;
    for (const event of sim.tick()) log.push({ tick, event });
  }
}

function phaseEvents(log: Logged[]): Array<{ tick: number } & SimEventOf<'phase'>> {
  const out: Array<{ tick: number } & SimEventOf<'phase'>> = [];
  for (const { tick, event } of log) if (event.e === 'phase') out.push({ tick, ...event });
  return out;
}

describe('phase order', () => {
  it('nextPhase walks LOBBY -> quarter phases x N -> FINAL', () => {
    const seen: string[] = [];
    let at = { phase: 'LOBBY' as Phase, quarter: 0 };
    for (let i = 0; i < 100 && at.phase !== 'FINAL'; i++) {
      at = nextPhase(fast, at);
      seen.push(`${at.phase}:${at.quarter}`);
    }
    const expected = [1, 2, 3].flatMap((q) => QUARTER_PHASES.map((p) => `${p}:${q}`)).concat('FINAL:3');
    expect(seen).toEqual(expected);
    expect(nextPhase(fast, { phase: 'FINAL', quarter: 3 })).toEqual({ phase: 'FINAL', quarter: 3 });
  });

  it('plays the full cycle in order with the configured tick counts', () => {
    const { sim, log } = startedSim(fast);
    run(sim, log, quarterTicks(fast) * fast.time.quarters + 10);

    const phases = phaseEvents(log);
    const expected: Array<{ phase: Phase; quarter: number; durationTicks: number | null }> = [
      { phase: 'LOBBY', quarter: 0, durationTicks: null },
    ];
    for (let q = 1; q <= fast.time.quarters; q++) {
      for (const phase of QUARTER_PHASES) expected.push({ phase, quarter: q, durationTicks: phaseTicks(fast, phase) });
    }
    expected.push({ phase: 'FINAL', quarter: fast.time.quarters, durationTicks: null });

    expect(phases.map(({ phase, quarter, durationTicks }) => ({ phase, quarter, durationTicks }))).toEqual(expected);

    // Every timed phase lasts exactly durationTicks tick() calls.
    for (let i = 1; i < phases.length - 1; i++) {
      expect(phases[i + 1]!.tick - phases[i]!.tick, `${phases[i]!.phase} q${phases[i]!.quarter}`).toBe(phases[i]!.durationTicks);
    }
    // LOBBY and BRIEFING are both announced by the first tick() (start was queued before it).
    expect(phases[0]!.tick).toBe(0);
    expect(phases[1]!.tick).toBe(0);
    // FINAL arrives exactly one full game after the start.
    expect(phases.at(-1)!.tick).toBe(quarterTicks(fast) * fast.time.quarters);
  });

  it('reaches FINAL after N quarters and stays there', () => {
    for (const quarters of [1, 2, 5]) {
      const config = mergeConfig(fast, { time: { quarters } });
      const { sim, log } = startedSim(config);
      run(sim, log, quarterTicks(config) * quarters); // call 0 only enters BRIEFING
      expect(sim.getState().phase).toBe('SHOP');
      expect(sim.getState().quarter).toBe(quarters);
      expect(sim.getState().ticksLeft).toBe(1);

      run(sim, log, 1);
      expect(sim.getState()).toMatchObject({ phase: 'FINAL', quarter: quarters, phaseTicks: null, ticksLeft: null });

      const before = log.length;
      run(sim, log, 50);
      expect(log.length).toBe(before);
      expect(sim.getState().phase).toBe('FINAL');
      expect(phaseEvents(log).filter((p) => p.phase === 'BRIEFING')).toHaveLength(quarters);
    }
  });

  it('uses the default lengths from config (150 / 900 / 50 / 200 / 300 ticks)', () => {
    const { sim, log } = startedSim(defaultConfig);
    run(sim, log, quarterTicks(defaultConfig) + 1);
    const phases = phaseEvents(log).slice(1, 7);
    expect(phases.map((p) => [p.phase, p.quarter, p.tick])).toEqual([
      ['BRIEFING', 1, 0],
      ['TRADING', 1, 150],
      ['EARNINGS', 1, 1050],
      ['RESULTS', 1, 1100],
      ['SHOP', 1, 1300],
      ['BRIEFING', 2, 1600],
    ]);
  });
});

describe('state snapshot', () => {
  it('counts phaseTick up and ticksLeft down inside a phase', () => {
    const { sim, log } = startedSim(fast);
    run(sim, log, 1);
    expect(sim.getState()).toMatchObject({ phase: 'BRIEFING', quarter: 1, tick: 1, phaseTick: 0, phaseTicks: 3, ticksLeft: 3 });
    run(sim, log, 1);
    expect(sim.getState()).toMatchObject({ phase: 'BRIEFING', phaseTick: 1, ticksLeft: 2 });
    run(sim, log, 2);
    expect(sim.getState()).toMatchObject({ phase: 'TRADING', quarter: 1, phaseTick: 0, phaseTicks: 6, ticksLeft: 6 });
  });

  it('does not advance time in LOBBY', () => {
    const sim = createSim(1, fast);
    const first = sim.tick();
    expect(first).toEqual([{ e: 'phase', phase: 'LOBBY', quarter: 0, durationTicks: null }]);
    for (let i = 0; i < 100; i++) expect(sim.tick()).toEqual([]);
    expect(sim.getState()).toMatchObject({ phase: 'LOBBY', quarter: 0, tick: 101, phaseTick: 0, phaseTicks: null, ticksLeft: null });
  });

  it('returns a copy of the roster', () => {
    const sim = createSim(1, fast);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    sim.tick();
    sim.getState().players.push({ id: 'x', name: 'x' });
    expect(sim.getState().players).toEqual([{ id: 'p1', name: 'Ann' }]);
  });
});

describe('lobby intents', () => {
  it('submit only queues; intents are applied on the next tick in arrival order', () => {
    const sim = createSim(1, fast);
    sim.submit({ kind: 'start', playerId: 'p1' }); // before p1 exists
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    expect(sim.getState().players).toEqual([]);
    const events = sim.tick();
    expect(events.filter((e) => e.e === 'reject')).toEqual([
      { e: 'reject', playerId: 'p1', intent: 'start', code: 'unknown_player', message: expect.any(String) },
    ]);
    expect(sim.getState().phase).toBe('LOBBY');
    expect(sim.getState().players).toEqual([{ id: 'p1', name: 'Ann' }]);
  });

  it('needs minPlayers to start and caps the roster at maxPlayers', () => {
    const config = mergeConfig(fast, { lobby: { minPlayers: 2, maxPlayers: 3 } });
    const sim = createSim(1, config);
    sim.tick();
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    expect(sim.tick()).toEqual([expect.objectContaining({ e: 'reject', intent: 'start', code: 'not_enough_players' })]);

    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Again' });
    sim.submit({ kind: 'add_player', playerId: 'p2', name: 'Bob' });
    sim.submit({ kind: 'add_player', playerId: 'p3', name: 'Cy' });
    sim.submit({ kind: 'add_player', playerId: 'p4', name: 'Di' });
    expect(sim.tick().map((e) => (e.e === 'reject' ? [e.playerId, e.code] : e.e))).toEqual([
      ['p1', 'invalid'],
      ['p4', 'game_full'],
    ]);

    sim.submit({ kind: 'remove_player', playerId: 'p3' });
    sim.submit({ kind: 'remove_player', playerId: 'nobody' });
    expect(sim.tick()).toEqual([expect.objectContaining({ e: 'reject', playerId: 'nobody', code: 'unknown_player' })]);
    expect(sim.getState().players.map((p) => p.id)).toEqual(['p1', 'p2']);

    sim.submit({ kind: 'start', playerId: 'p2' });
    // Milestone 3: the start also hands every player their opening portfolio. Milestone 4: the briefing.
    expect(sim.tick().map((e) => (e.e === 'portfolio' ? `portfolio:${e.playerId}` : e.e === 'briefing' ? 'briefing' : e))).toEqual([
      { e: 'phase', phase: 'BRIEFING', quarter: 1, durationTicks: 3 },
      'briefing',
      'portfolio:p1',
      'portfolio:p2',
    ]);
  });

  it('rejects lobby intents after the start, and later-milestone intents for now', () => {
    const { sim, log } = startedSim(fast);
    run(sim, log, 1);
    sim.submit({ kind: 'add_player', playerId: 'p2', name: 'Bob' });
    sim.submit({ kind: 'remove_player', playerId: 'p1' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    sim.submit({ kind: 'order', playerId: 'p1', symbol: 'ACME', qty: 10 });
    sim.submit({ kind: 'buy_card', playerId: 'ghost', offerId: 'o1' });
    const codes = sim.tick().map((e) => (e.e === 'reject' ? `${e.intent}:${e.code}` : e.e));
    expect(codes).toEqual([
      'add_player:wrong_phase',
      'remove_player:wrong_phase',
      'start:wrong_phase',
      'order:wrong_phase', // milestone 3: orders exist, but only in TRADING
      'buy_card:unknown_player',
    ]);
    expect(sim.getState().players).toEqual([{ id: 'p1', name: 'Ann' }]);
  });
});

describe('determinism', () => {
  function script(seed: number): { events: Logged[]; state: unknown } {
    const sim = createSim(seed, fast);
    const log: Logged[] = [];
    run(sim, log, 3);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    run(sim, log, 2);
    sim.submit({ kind: 'add_player', playerId: 'p2', name: 'Bob' });
    sim.submit({ kind: 'order', playerId: 'p2', symbol: 'ACME', qty: -5 });
    run(sim, log, 4);
    sim.submit({ kind: 'start', playerId: 'p2' });
    run(sim, log, 7);
    sim.submit({ kind: 'start', playerId: 'p1' });
    run(sim, log, quarterTicks(fast) * fast.time.quarters + 5);
    return { events: log, state: sim.getState() };
  }

  it('same seed + config + intents on the same ticks => identical events and state', () => {
    const a = script(42);
    const b = script(42);
    expect(a.events.length).toBeGreaterThan(10);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not share state between sim instances', () => {
    const one = createSim(7, fast);
    const two = createSim(7, fast);
    one.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    one.submit({ kind: 'start', playerId: 'p1' });
    one.tick();
    two.tick();
    expect(one.getState().phase).toBe('BRIEFING');
    expect(two.getState().phase).toBe('LOBBY');
    expect(two.getState().players).toEqual([]);
  });
});

describe('purity', () => {
  it('sim sources use no I/O, clock, timers or Math.random', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const banned = /\b(Date\.now|new Date|Math\.random|setTimeout|setInterval|setImmediate|console\.|process\.|performance\.)|from '(node:|ws|fs|\.\.\/)/;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(`${dir}/${file}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code.match(banned)?.[0], file).toBeUndefined();
    }
  });
});
