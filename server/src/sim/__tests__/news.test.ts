/**
 * Milestone 4: headline lookup (matching, no repeats, fallbacks), slot filling, and the news engine
 * through createSim (global queue gap, determinism, beats and the rate decision, earnings reports and
 * the gap at the next open).
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, msToTicks } from '@tg/shared';
import type { GameConfig, HeadlineTemplate } from '@tg/shared';
import { DEFAULT_HEADLINES, DEFAULT_PLACEHOLDERS } from '../data/headlineData.ts';
import { createHeadlineBook, createRng, createSim, fillHeadline, generateUniverse } from '../index.ts';
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
  phaseMs: { BRIEFING: 200, EARNINGS: 200, RESULTS: 200, SHOP: 200 },
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

describe('news through the sim', () => {
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

  it('reports earnings for every company at EARNINGS, and the gap is surprise minus what the published leaks priced in', () => {
    const { sim, events } = playGame(11, mergeConfig(CONFIG, { time: { quarters: 1 } }));
    const report = only(events, 'earnings')[0]!;
    expect(report.reports).toHaveLength(sim.getUniverse().companies.length);
    const plan = sim.news.plan()!;
    const leaks = sim.news.log().filter((p) => p.source === 'leak');
    for (const r of report.reports) {
      const leaked = leaks.filter((p) => p.target.scope === 'stock' && p.target.symbol === r.symbol).reduce((s, p) => s + p.logReturn, 0);
      expect(r.surprise).toBeCloseTo(plan.surprise[r.symbol]!, 12);
      expect(r.gap + leaked).toBeCloseTo(CONFIG.earnings.gapFactor * r.surprise, 10);
    }
    // Sorted by |gap|.
    expect(Math.abs(report.reports[0]!.gap)).toBeGreaterThanOrEqual(Math.abs(report.reports.at(-1)!.gap));
    // After the last quarter the gap waits (M6 marks the final leaderboard with it).
    expect(sim.news.pendingGap()).not.toBeNull();
  });

  it("the earnings gap shows on the next quarter's first tick", () => {
    const config = mergeConfig(CONFIG, { time: { quarters: 2 }, news: { randomHeadlinesPerQuarter: 0, scheduledBeatsPerQuarter: 0 }, earnings: { leaksPerQuarter: 0 } });
    const sim = createSim(13, config);
    sim.submit({ kind: 'add_player', playerId: 'p1', name: 'Ann' });
    sim.submit({ kind: 'start', playerId: 'p1' });
    let gap: Record<string, number> | null = null;
    let before: Record<string, number> | null = null;
    for (let i = 0; i < 100_000; i++) {
      const events = sim.tick();
      // The quarter's last tick comes in the same tick() as the EARNINGS event: look at later ones.
      const tick = gap ? events.find((e) => e.e === 'tick') : undefined;
      if (events.some((e) => e.e === 'earnings')) {
        gap = sim.news.pendingGap();
        before = sim.getMarketSnapshot().prices;
      }
      if (gap && before && tick && tick.e === 'tick') {
        // One tick of noise is small next to the gap of the biggest movers.
        const [symbol, g] = Object.entries(gap).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]!;
        const moved = Math.log(tick.prices[symbol]! / before[symbol]!);
        expect(Math.abs(moved - g)).toBeLessThan(0.02);
        expect(Math.abs(g)).toBeGreaterThan(0.05);
        return;
      }
    }
    throw new Error('no tick after earnings');
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
