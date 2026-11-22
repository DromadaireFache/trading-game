/**
 * Milestone 4: headline lookup (matching, no repeats, fallbacks), slot filling, and the news engine
 * through createSim (global queue gap, determinism, beats and the rate decision, earnings reports and
 * the delayed gap in the next quarter).
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, msToTicks, phaseTicks } from '@tg/shared';
import type { GameConfig, HeadlineTemplate } from '@tg/shared';
import { DEFAULT_HEADLINES, DEFAULT_PLACEHOLDERS } from '../data/headlineData.ts';
import { createHeadlineBook, createNews, createRng, createSim, fillHeadline, generateUniverse } from '../index.ts';
import type { Sim, SimEvent, SimEventOf } from '../index.ts';

const T = (id: string, over: Partial<HeadlineTemplate>): HeadlineTemplate => ({
  id,
  text: `${id} {COMPANY}`,
  scope: 'stock',
  direction: 'up',
  magnitude: 'medium',
  category: 'contract',
  kind: 'real',
  ...over,
});

describe('sector-specific headlines', () => {
  it('only selects matching sector or generic templates', () => {
    const templates = [
      { id: 'energy', text: '{COMPANY} wins an energy deal', scope: 'stock', sector: 'energy', direction: 'up', magnitude: 'small', category: 'contract', kind: 'real' },
      { id: 'airline', text: '{COMPANY} wins an airline deal', scope: 'stock', sector: 'airlines', direction: 'up', magnitude: 'small', category: 'contract', kind: 'real' },
    ] as const;
    const book = createHeadlineBook(templates, createRng(1));
    const query = { kind: 'real', scope: 'stock', direction: 'up', magnitude: 'small', sector: 'airlines' } as const;
    expect(book.pick(query)?.id).toBe('airline');
    expect(book.pick(query)?.id).toBe('airline');
    expect(book.pick({ ...query, sector: 'tech' })).toBeUndefined();
  });
});

describe('headline lookup', () => {
  const db = [
    T('a', {}),
    T('b', {}),
    T('c', { category: 'legal' }),
    T('big', { magnitude: 'huge' }),
    T('down', { direction: 'down' }),
    T('fake', { kind: 'fake_template' }),
    T('sector', { scope: 'sector', text: '{SECTOR} rallies' }),
  ];

  it('matches kind, scope and direction exactly, and the category when it can', () => {
    const book = createHeadlineBook(db, createRng(1));
    expect(book.pick({ kind: 'real', scope: 'stock', direction: 'up', magnitude: 'medium', category: 'legal' })!.id).toBe('c');
    expect(book.pick({ kind: 'real', scope: 'stock', direction: 'down', magnitude: 'medium' })!.id).toBe('down');
    expect(book.pick({ kind: 'fake_template', scope: 'stock', direction: 'up' })!.id).toBe('fake');
    expect(book.pick({ kind: 'real', scope: 'sector', direction: 'up' })!.id).toBe('sector');
    expect(book.pick({ kind: 'real', scope: 'market', direction: 'up' })).toBeUndefined();
    expect(book.pick({ kind: 'debunk', scope: 'stock', direction: 'up' })).toBeUndefined();
  });

  it('never repeats while an unused match exists, then reuses the one used longest ago', () => {
    const book = createHeadlineBook(db, createRng(2));
    const q = { kind: 'real', scope: 'stock', direction: 'up', magnitude: 'medium' } as const;
    const firstFour = [1, 2, 3, 4].map(() => book.pick(q)!.id);
    expect(new Set(firstFour).size).toBe(4); // a, b, c (same size), then 'big' (closest size left)
    expect(firstFour.slice(0, 3).sort()).toEqual(['a', 'b', 'c']);
    expect(firstFour[3]).toBe('big');
    expect(book.pick(q)!.id).toBe(firstFour[0]);
    expect(book.pick(q)!.id).toBe(firstFour[1]);
  });

  it('falls back to the closest magnitude, and prefers texts that pass `prefer`', () => {
    const book = createHeadlineBook(
      [T('m', { magnitude: 'medium' }), T('l', { magnitude: 'large' }), T('h', { magnitude: 'huge' }), T('rate', { magnitude: 'huge', text: 'Rate cut' })],
      createRng(3),
    );
    expect(book.pick({ kind: 'real', scope: 'stock', direction: 'up', magnitude: 'large' })!.id).toBe('l');
    expect(book.pick({ kind: 'real', scope: 'stock', direction: 'up', magnitude: 'huge', prefer: /rate/i })!.id).toBe('rate');
    expect(book.pick({ kind: 'real', scope: 'stock', direction: 'up', magnitude: 'huge' })!.id).toBe('h');
  });

  it('the shipped database has a real headline for every scope x direction, and lookup never repeats until a pool runs dry', () => {
    const book = createHeadlineBook(DEFAULT_HEADLINES, createRng(4));
    for (const scope of ['market', 'sector', 'stock'] as const) {
      for (const direction of ['up', 'down', 'neutral'] as const) {
        const pool = DEFAULT_HEADLINES.filter((h) => h.kind === 'real' && h.scope === scope && h.direction === direction);
        expect(pool.length, `${scope}/${direction}`).toBeGreaterThan(0);
        const seen = new Set<string>();
        for (let i = 0; i < pool.length; i++) seen.add(book.pick({ kind: 'real', scope, direction, magnitude: 'medium' })!.id);
        expect(seen.size, `${scope}/${direction}`).toBe(pool.length);
      }
    }
  });
});

describe('slot filling', () => {
  const universe = generateUniverse(createRng(9), defaultConfig);
  const company = universe.companies[7]!;

  it('fills company slots from the target, sector from its sector, and keeps one value per slot', () => {
    const text = fillHeadline('{COMPANY} ({TICKER}) CEO {CEO} snubs {RIVAL}; {COMPANY} shares jump in {CITY}, {CITY} cheers', createRng(1), {
      universe,
      lists: DEFAULT_PLACEHOLDERS,
      company,
    });
    expect(text).toContain(`${company.name} (${company.symbol}) CEO ${company.ceo} snubs `);
    expect(text.split(company.name).length - 1).toBe(2);
    const city = DEFAULT_PLACEHOLDERS.CITY!.find((c) => text.includes(`in ${c}, ${c} cheers`));
    expect(city).toBeDefined();
    const rival = universe.companies.find((c) => c.symbol !== company.symbol && text.includes(`snubs ${c.name};`));
    expect(rival?.sector).toBe(company.sector);
  });

  it('capitalizes the first letter', () => {
    expect(fillHeadline('{GOV_AGENCY} acts', createRng(1), { universe, lists: { GOV_AGENCY: ['the Board'] } })).toBe('The Board acts');
  });

  it('every template of the shipped database fills with no slot left over', () => {
    const rng = createRng(5);
    for (const h of DEFAULT_HEADLINES) {
      const filled = fillHeadline(h.text, rng, { universe, lists: DEFAULT_PLACEHOLDERS, company, sector: company.sector });
      expect(filled, h.id).not.toMatch(/\{[A-Z_]+\}/);
    }
  });
});

// ---------------------------------------------------------------------------
// Through createSim
// ---------------------------------------------------------------------------

const CONFIG: GameConfig = mergeConfig(defaultConfig, {
  time: { daysPerQuarter: 30, quarters: 3 },
  phaseMs: { BRIEFING: 200, RESULTS: 200, SHOP: 200 },
  // Short quarters: the old, busier news pace so every quarter has plenty of headlines.
  news: { minGapMs: 2_000, scheduledBeatsPerQuarter: 3, randomHeadlinesPerQuarter: 3 },
  earnings: { leaksPerQuarter: 4 },
});

function playGame(seed: number, config: GameConfig = CONFIG): { sim: Sim; events: SimEvent[] } {
  const sim = createSim(seed, config);
  sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
  sim.submit({ kind: 'start', playerId: 'p1' });
  const events: SimEvent[] = [];
  for (let i = 0; i < 1_000_000 && sim.getState().phase !== 'FINAL'; i++) events.push(...sim.tick());
  return { sim, events };
}

const only = <E extends SimEvent['e']>(events: SimEvent[], e: E) => events.filter((x): x is SimEventOf<E> => x.e === e);

const quiet = { randomHeadlinesPerQuarter: 0, scheduledBeatsPerQuarter: 0 };

function testNews(config: GameConfig, seed: number, earningsSeed = seed) {
  const rng = createRng(seed);
  const universe = generateUniverse(rng.fork(), config);
  const news = createNews({
    config,
    universe,
    book: createHeadlineBook(DEFAULT_HEADLINES, rng.fork()),
    lists: DEFAULT_PLACEHOLDERS,
    rng,
    earningsRng: createRng(earningsSeed),
    earningsLeadRng: createRng(seed),
    earningsOrderRng: createRng(seed).fork(),
  });
  return { news, universe };
}

describe('news through the sim', () => {
  it('draws seeded headline lead times between news.leadMinMs and leadMaxMs', () => {
    const config = mergeConfig(CONFIG, { news: { randomHeadlinesPerQuarter: 0, scheduledBeatsPerQuarter: 0 }, earnings: { leaksPerQuarter: 0 } });
    const delays = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const { news, universe } = testNews(config, seed);
      news.startQuarter(1, 0, config.market.startRate);
      news.enqueue({ tick: 0, source: 'random', query: { kind: 'real', scope: 'stock', direction: 'up' }, target: { scope: 'stock', symbol: universe.companies[0]!.symbol }, logReturn: 0.05 });
      expect(news.beforeStep(0, config.market.startRate).events).toHaveLength(1);
      let firstMove = -1;
      const minTicks = config.news.leadMinMs / config.time.tickMs;
      const maxTicks = config.news.leadMaxMs / config.time.tickMs;
      for (let tick = 1; tick <= maxTicks + 10; tick++) {
        if (news.beforeStep(tick, config.market.startRate).symbolReturn) { firstMove = tick; break; }
      }
      expect(firstMove).toBeGreaterThanOrEqual(minTicks);
      expect(firstMove).toBeLessThanOrEqual(maxTicks);
      delays.add(firstMove);
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  it('publishes before both the price shock and policy rate change', () => {
    const config = mergeConfig(CONFIG, {
      news: { leadMinMs: 2_000, leadMaxMs: 2_000, randomHeadlinesPerQuarter: 0, scheduledBeatsPerQuarter: 0 },
      earnings: { leaksPerQuarter: 0 },
    });
    const { news, universe } = testNews(config, 77, 78);
    news.startQuarter(1, 0, config.market.startRate);
    news.enqueue({ tick: 0, source: 'rate', query: { kind: 'real', scope: 'market', direction: 'up' }, target: { scope: 'market' }, logReturn: 0.05, dRate: -0.0025 });
    const first = news.beforeStep(0, config.market.startRate);
    expect(first.events).toHaveLength(1);
    expect(first.symbolReturn).toBeUndefined();
    expect(first.dRate).toBe(0);
    for (let tick = 1; tick < 20; tick++) {
      const step = news.beforeStep(tick, config.market.startRate);
      expect(step.symbolReturn).toBeUndefined();
      expect(step.dRate).toBe(0);
    }
    const effect = news.beforeStep(20, config.market.startRate);
    expect(effect.symbolReturn?.[universe.companies[0]!.symbol]).toBeGreaterThan(0);
    expect(effect.dRate).toBeCloseTo(-0.0025);
  });

  it('does not publish a leak too late to settle before earnings', () => {
    const config = mergeConfig(CONFIG, { news: { randomHeadlinesPerQuarter: 0, scheduledBeatsPerQuarter: 0, maxGapMs: 0 }, earnings: { leaksPerQuarter: 0 } });
    const { news, universe } = testNews(config, 99, 100);
    news.startQuarter(1, 0, config.market.startRate);
    const symbol = universe.companies[0]!.symbol;
    const end = config.time.daysPerQuarter * config.time.ticksPerCandle;
    news.enqueue({ tick: end - 1, source: 'leak', query: { kind: 'real', scope: 'stock', direction: 'up' }, target: { scope: 'stock', symbol }, logReturn: 0.1, leakAmount: 0.1 });
    expect(news.beforeStep(end - 1, config.market.startRate).events).toHaveLength(0);
    const report = news.closeQuarter().find((item) => item.symbol === symbol)!;
    expect(report.gap).toBeCloseTo(config.earnings.gapFactor * report.surprise, 12);
  });

  it('is deterministic: the same seed publishes the same headlines', () => {
    const a = only(playGame(3).events, 'headline');
    const b = only(playGame(3).events, 'headline');
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
    expect(only(playGame(4).events, 'headline').map((h) => h.text)).not.toEqual(a.map((h) => h.text));
  });

  it('publishes only in TRADING, with at least news.minGapMs between headlines, and fills every slot', () => {
    const { events } = playGame(6);
    let phase = '';
    let lastTs: number | null = null;
    const gapDays = msToTicks(CONFIG, CONFIG.news.minGapMs) / CONFIG.time.ticksPerCandle;
    for (const e of events) {
      if (e.e === 'phase') phase = e.phase;
      if (e.e !== 'headline') continue;
      expect(phase).toBe('TRADING');
      expect(e.text).not.toMatch(/\{[A-Z_]+\}/);
      if (lastTs !== null) expect(e.ts - lastTs).toBeGreaterThanOrEqual(gapDays - 1e-9);
      lastTs = e.ts;
    }
  });

  it('with the default pace, headlines come 5 to 20 s apart, 10 s on average, from the open to the close', () => {
    const config = mergeConfig(defaultConfig, { phaseMs: { BRIEFING: 200, RESULTS: 200, SHOP: 200 } });
    const msPerDay = config.time.tickMs * config.time.ticksPerCandle;
    const allGaps: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim } = playGame(seed, config);
      for (let q = 1; q <= config.time.quarters; q++) {
        const open = (q - 1) * config.time.daysPerQuarter;
        const close = q * config.time.daysPerQuarter;
        const times = [open, ...sim.news.log().filter((p) => p.quarter === q).map((p) => p.ts), close];
        const gaps = times.slice(1).map((t, i) => (t - times[i]!) * msPerDay);
        // The edges (open to first, last to close) only have the upper bound.
        expect(Math.max(...gaps)).toBeLessThanOrEqual(config.news.maxGapMs + 2 * config.news.minGapMs);
        for (const gap of gaps.slice(1, -1)) expect(gap).toBeGreaterThanOrEqual(config.news.minGapMs - 1e-6);
        expect(times.length - 2).toBeGreaterThanOrEqual(Math.floor((config.time.daysPerQuarter * msPerDay) / config.news.maxGapMs));
        allGaps.push(...gaps.slice(1, -1));
      }
    }
    const mean = allGaps.reduce((a, b) => a + b, 0) / allGaps.length;
    expect(mean).toBeGreaterThan(config.news.meanGapMs * 0.8);
    expect(mean).toBeLessThan(config.news.meanGapMs * 1.2);
  });

  it('a stock headline names its company and moves it; its log records the cause', () => {
    const { sim, events } = playGame(8);
    const stock = sim.news.log().find((p) => p.target.scope === 'stock' && p.logReturn !== 0 && p.source === 'random')!;
    expect(stock).toBeDefined();
    const company = sim.getUniverse().companies.find((c) => stock.target.scope === 'stock' && c.symbol === stock.target.symbol)!;
    const template = DEFAULT_HEADLINES.find((h) => h.id === stock.templateId)!;
    if (/\{COMPANY\}/.test(template.text)) expect(stock.text).toContain(company.name);
    const event = only(events, 'headline').find((h) => h.id === stock.id)!;
    expect(event).toMatchObject({ symbol: company.symbol, sector: company.sector });
  });

  it('announces the beats at BRIEFING and keeps the rate inside [rateMin, rateMax]', () => {
    const tight = mergeConfig(CONFIG, { time: { quarters: 6 }, market: { startRate: 0, rateMin: 0, rateMax: 0.005 } });
    const { sim, events } = playGame(2, tight);
    const briefings = only(events, 'briefing');
    expect(briefings.map((b) => b.quarter)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const b of briefings) {
      expect(b.beats).toHaveLength(tight.news.scheduledBeatsPerQuarter);
      expect(b.beats[0]!.title).toBe(tight.news.beatTitles[0]);
      const first = (b.quarter - 1) * tight.time.daysPerQuarter;
      for (const beat of b.beats) expect(beat.day).toBeGreaterThanOrEqual(first);
      expect(b.rate).toBeGreaterThanOrEqual(0);
      expect(b.rate).toBeLessThanOrEqual(0.005 + 1e-12);
    }
    const rates = sim.news.log().filter((p) => p.source === 'rate');
    expect(rates.length).toBe(6);
    // Each rate decision says where it left the rate, inside the bounds, and the market agrees.
    for (const p of rates) expect(p.rate! >= 0 && p.rate! <= 0.005 + 1e-12).toBe(true);
    const published = only(events, 'headline').filter((h) => h.rate !== undefined);
    expect(published.map((h) => h.rate)).toEqual(rates.map((p) => p.rate));
    expect(only(events, 'briefing').slice(1).map((b) => b.rate)).toEqual(rates.slice(0, -1).map((p) => p.rate));
  });

  it('reports earnings for every company at the close of trading, and the gap is surprise minus what the published leaks priced in', () => {
    const { sim, events } = playGame(11, mergeConfig(CONFIG, { time: { quarters: 1 } }));
    const report = only(events, 'earnings')[0]!;
    expect(report.reports.map((r) => r.symbol).sort()).toEqual(sim.getUniverse().companies.map((c) => c.symbol).sort());
    const plan = sim.news.plan()!;
    const leaks = sim.news.log().filter((p) => p.source === 'leak');
    for (const r of report.reports) {
      const leaked = leaks.filter((p) => p.target.scope === 'stock' && p.target.symbol === r.symbol).reduce((s, p) => s + p.logReturn, 0);
      expect(r.surprise).toBeCloseTo(plan.surprise[r.symbol]!, 12);
      expect(r.gap + leaked).toBeCloseTo(CONFIG.earnings.gapFactor * r.surprise, 10);
    }
    // After the last quarter the gap waits (M6 marks the final leaderboard with it).
    expect(sim.news.pendingGap()).not.toBeNull();
  });

  it('shuffles earnings once per quarter and keeps the order when replayed', () => {
    const config = mergeConfig(CONFIG, { news: quiet, earnings: { surpriseSigma: 0, leaksPerQuarter: 0 } });
    const open = config.time.daysPerQuarter * config.time.ticksPerCandle;
    const rate = config.market.startRate;
    const { news, universe } = testNews(config, 11);
    news.startQuarter(1, 0, rate);
    const q1 = news.closeQuarter();
    expect(q1.map((r) => r.symbol)).not.toEqual(universe.companies.map((c) => c.symbol));
    news.startQuarter(2, open, rate);
    expect(news.earnings()).toEqual({ quarter: 1, reports: q1 });
    expect(news.closeQuarter().map((r) => r.symbol)).not.toEqual(q1.map((r) => r.symbol));
  });

  it('draws seeded earnings delays in the configured range', () => {
    const config = mergeConfig(CONFIG, { news: quiet, earnings: { leaksPerQuarter: 0 } });
    const open = config.time.daysPerQuarter * config.time.ticksPerCandle;
    function delay(seed: number): number {
      const { news } = testNews(config, seed);
      const rate = config.market.startRate;
      news.startQuarter(1, 0, rate);
      news.closeQuarter();
      news.startQuarter(2, open, rate);
      for (let tick = open; tick < open + maxTicks; tick++) {
        if (news.beforeStep(tick, rate).symbolReturn !== undefined) return tick - open + 1;
      }
      throw new Error('no earnings move within the configured delay');
    }
    const minTicks = Math.max(1, config.earnings.gapDelayMinMs / config.time.tickMs);
    const maxTicks = config.earnings.gapDelayMaxMs / config.time.tickMs;
    const delays = Array.from({ length: 12 }, (_, seed) => delay(seed));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(minTicks);
    expect(Math.max(...delays)).toBeLessThanOrEqual(maxTicks);
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(delay(3)).toBe(delays[3]);
  });

  it.each([
    { days: 10, delayMs: 0, effectStep: 0 },
    { days: 10, delayMs: 3_000, effectStep: 29 },
    { days: 1, delayMs: 3_000, effectStep: 9 },
  ])('processes opening orders and applies earnings on step $effectStep ($days trading days)', ({ days, delayMs, effectStep }) => {
    const config = mergeConfig(CONFIG, {
      time: { daysPerQuarter: days, quarters: 2 },
      news: quiet,
      earnings: { leaksPerQuarter: 0, gapDelayMinMs: delayMs, gapDelayMaxMs: delayMs },
    });
    const sim = createSim(13, config);
    const control = createSim(13, mergeConfig(config, { earnings: { gapFactor: 0 } }));
    for (const game of [sim, control]) {
      game.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
      game.submit({ kind: 'start', playerId: 'p1' });
    }
    const tradingTicks = days * config.time.ticksPerCandle;
    const quickBetCloseStep = Math.min(days, config.trading.quickBetDays) * config.time.ticksPerCandle - 1;
    const beforeOpen: SimEvent[] = [];
    while (sim.getState().quarter !== 2 || sim.getState().phase !== 'TRADING') {
      beforeOpen.push(...sim.tick());
      control.tick();
      if (beforeOpen.length > 10_000) throw new Error('Q2 did not open');
    }
    const earnings = only(beforeOpen, 'earnings')[0]!;
    const beat = earnings.reports.find((r) => r.surprise > 0)!;
    const miss = earnings.reports.find((r) => r.surprise < 0)!;
    const quickBet = earnings.reports.find((r) => r.symbol !== beat.symbol && r.symbol !== miss.symbol)!;
    for (const game of [sim, control]) {
      game.submit({ kind: 'order', playerId: 'p1', symbol: beat.symbol, qty: 1 });
      game.submit({ kind: 'order', playerId: 'p1', symbol: miss.symbol, qty: -1 });
      game.submit({ kind: 'order', playerId: 'p1', symbol: quickBet.symbol, qty: 1, holdDays: config.trading.quickBetDays });
    }

    for (let t = 0; t < tradingTicks; t++) {
      const events = sim.tick();
      const price = only(events, 'tick')[0]!.prices;
      const baseline = only(control.tick(), 'tick')[0]!.prices;
      if (t === 0) expect(only(events, 'fill').map((e) => e.qty)).toEqual([1, -1, 1]);
      expect(only(events, 'bet_result')).toHaveLength(t === quickBetCloseStep ? 1 : 0);
      for (const r of [beat, miss]) {
        const move = Math.log(price[r.symbol]! / baseline[r.symbol]!);
        expect(move).toBeCloseTo(t < effectStep ? 0 : r.gap, 10);
      }
    }

    expect(sim.getState().phase).toBe('FINAL');
    const recap = sim.getResults()!.recap;
    expect(recap.quarter).toBe(2);
    expect(recap.topMoves.some((move) => move.cause.kind === 'earnings')).toBe(true);
  });

  it('the briefing carries the earnings consensus: expected quarterly EPS of every company', () => {
    const { sim, events } = playGame(5, mergeConfig(CONFIG, { time: { quarters: 1 } }));
    const consensus = only(events, 'briefing')[0]!.consensus!;
    const companies = sim.getUniverse().companies;
    expect(Object.keys(consensus).sort()).toEqual(companies.map((c) => c.symbol).sort());
    for (const c of companies) {
      const f = c.fundamentals;
      expect(consensus[c.symbol]).toBeCloseTo((f.revenue * f.margin) / 4 / f.shares, 2);
      expect(consensus[c.symbol]).toBeGreaterThan(0);
    }
  });

  it('serves a snapshot for (re)joining clients', () => {
    const sim = createSim(1, CONFIG);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    for (let i = 0; i < 25 * CONFIG.time.ticksPerCandle; i++) sim.tick(); // day ~23 of quarter 1
    const snap = sim.getNewsSnapshot();
    expect(snap.briefing?.quarter).toBe(1);
    expect(snap.headlines.length).toBeGreaterThan(0);
    expect(snap.headlines.length).toBeLessThanOrEqual(CONFIG.news.replayHeadlines);
  });
});

describe('headlines only name what exists', () => {
  it('with the full catalog, every published headline names a stock and a sector of this universe', async () => {
    const { readHeadlines, HEADLINE_SEED, GENERATED_HEADLINES } = await import('../../headline-files.ts');
    const { SECTORS } = await import('@tg/shared');
    const catalog = [...readHeadlines(HEADLINE_SEED), ...readHeadlines(GENERATED_HEADLINES, true)];
    for (const h of catalog) if (h.sector !== undefined) expect(SECTORS).toContain(h.sector);
    const config = mergeConfig(defaultConfig, {
      time: { daysPerQuarter: 40, quarters: 4 },
      phaseMs: { BRIEFING: 200, RESULTS: 200, SHOP: 200 },
      news: { randomHeadlinesPerQuarter: 12, minGapMs: 500 },
      earnings: { leaksPerQuarter: 6 },
    });
    for (const seed of [1, 2, 3]) {
      const sim = createSim(seed, config, { headlines: catalog });
      const symbols = new Set(sim.getUniverse().companies.map((c) => c.symbol));
      const names = sim.getUniverse().companies.map((c) => c.name);
      sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
      sim.submit({ kind: 'start', playerId: 'p1' });
      const events: SimEvent[] = [];
      for (let i = 0; i < 1_000_000 && sim.getState().phase !== 'FINAL'; i++) events.push(...sim.tick());
      const published = only(events, 'headline');
      expect(published.length).toBeGreaterThan(20);
      for (const h of published) {
        if (h.symbol !== undefined) {
          expect(symbols.has(h.symbol)).toBe(true);
          const company = sim.getUniverse().companies.find((c) => c.symbol === h.symbol)!;
          expect(h.sector).toBe(company.sector);
        }
        if (h.sector !== undefined) expect(SECTORS).toContain(h.sector);
        expect(h.text).not.toMatch(/\{[A-Z_]+\}/);
      }
      // A stock headline that names a company names one of this game's companies.
      for (const p of sim.news.log()) {
        if (p.target.scope !== 'stock') continue;
        const template = catalog.find((t) => t.id === p.templateId)!;
        if (/\{COMPANY\}/.test(template.text)) expect(names.some((n) => p.text.includes(n))).toBe(true);
      }
    }
  });
});
