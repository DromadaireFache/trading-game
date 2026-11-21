/**
 * Milestone 5 through createSim: shop offers, buying, the hand limit, playing each kind of card
 * (insider preview, fake + debunk, event, regime), heat, the SEC roll, fines, jail, and reveals.
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig, msToTicks } from '@tg/shared';
import type { DeepPartial, GameConfig, Phase } from '@tg/shared';
import type { CardCatalogEntry } from '@tg/shared/cards';
import { DEFAULT_CATALOG } from '../data/cardData.ts';
import { createSim } from '../index.ts';
import type { Sim, SimEvent, SimEventOf } from '../index.ts';

const BASE: GameConfig = mergeConfig(defaultConfig, {
  time: { daysPerQuarter: 30, quarters: 3 },
  phaseMs: { BRIEFING: 200, EARNINGS: 200, RESULTS: 200, SHOP: 200 },
  lobby: { minPlayers: 1 },
  // Short quarters: a tighter news gap and lead so card headlines land within a few steps.
  news: { minGapMs: 2_000, leadMinMs: 1_000, leadMaxMs: 5_000 },
});

const card = (defId: string): CardCatalogEntry => DEFAULT_CATALOG.find((c) => c.defId === defId)!;

interface Game {
  sim: Sim;
  log: SimEvent[];
  /** Ticks until `phase` starts (or `extra` ticks into it), collecting events. */
  to(phase: Phase, quarter?: number, extra?: number): SimEvent[];
  step(n?: number): SimEvent[];
}

function game(catalog: CardCatalogEntry[], overrides: DeepPartial<GameConfig> = {}, players = ['p1', 'p2'], seed = 3): Game {
  const sim = createSim(seed, mergeConfig(BASE, overrides), { catalog });
  for (const id of players) sim.submit({ kind: 'add_player', playerId: id, name: id.toUpperCase() });
  sim.submit({ kind: 'start', playerId: players[0]! });
  const log: SimEvent[] = [];
  const step = (n = 1) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...sim.tick());
    log.push(...out);
    return out;
  };
  return {
    sim,
    log,
    step,
    to(phase, quarter, extra = 0) {
      const out: SimEvent[] = [];
      for (let i = 0; i < 200_000; i++) {
        const s = sim.getState();
        if (s.phase === phase && (quarter === undefined || s.quarter === quarter)) break;
        out.push(...step());
      }
      if (extra > 0) out.push(...step(extra));
      return out;
    },
  };
}

const only = <E extends SimEvent['e']>(events: SimEvent[], e: E) => events.filter((x): x is SimEventOf<E> => x.e === e);
const rejects = (events: SimEvent[]) => only(events, 'reject').map((r) => r.code);

/** Buys every offer it can in SHOP of `quarter` for `player`; returns the hand afterwards. */
function buyAll(g: Game, player: string, quarter = 1) {
  const shop = g.to('SHOP', quarter).concat(g.step());
  const mine = only(g.log, 'shop').filter((s) => s.playerId === player).at(-1)!;
  for (const offer of mine.offers) g.sim.submit({ kind: 'buy_card', playerId: player, offerId: offer.offerId });
  const after = g.step();
  void shop;
  return { offers: mine.offers, events: after, hand: g.sim.getPortfolio(player)!.hand ?? [] };
}

describe('shop and hand', () => {
  it('every player sees the same cards, priced by their own net worth; the last quarter has no shop', () => {
    const g = game(DEFAULT_CATALOG);
    g.to('SHOP', 1);
    g.step();
    const shops = only(g.log, 'shop');
    expect(shops.map((s) => s.playerId).sort()).toEqual(['p1', 'p2']);
    expect(shops[0]!.offers.map((o) => o.offerId)).toEqual(shops[1]!.offers.map((o) => o.offerId));
    expect(shops[0]!.offers.length).toBe(BASE.cards.offersPerShop);
    for (const o of shops[0]!.offers) expect(o.price).toBeGreaterThanOrEqual(BASE.cards.minPrice);
    expect(g.sim.getShop('p1')?.offers).toEqual(shops.find((s) => s.playerId === 'p1')!.offers);
    g.to('RESULTS', 3);
    expect(g.sim.getShop('p1')).toBeNull();
    expect(g.to('FINAL').some((event) => event.e === 'shop')).toBe(false);
  });

  it('buying charges the price, puts the card in the hand, and stops at the hand limit', () => {
    const catalog = ['insider_tip', 'planted_rumor', 'lucky_strike', 'act_of_god'].map(card);
    const g = game(catalog, { cards: { offersPerShop: 4 } });
    g.to('SHOP', 1);
    g.step();
    const before = g.sim.getPortfolio('p1')!;
    const offers = only(g.log, 'shop').find((s) => s.playerId === 'p1')!.offers;
    expect(offers).toHaveLength(4);
    for (const o of offers) g.sim.submit({ kind: 'buy_card', playerId: 'p1', offerId: o.offerId });
    g.sim.submit({ kind: 'buy_card', playerId: 'p1', offerId: offers[0]!.offerId });
    const events = g.step();
    const after = g.sim.getPortfolio('p1')!;
    expect(after.hand).toHaveLength(BASE.cards.handLimit);
    expect(rejects(events)).toEqual(['hand_full', 'invalid']);
    const paid = offers.slice(0, 3).reduce((s, o) => s + o.price, 0);
    expect(before.cash - after.cash).toBeCloseTo(paid, 6);
    expect(only(events, 'portfolio').filter((p) => p.playerId === 'p1').at(-1)!.hand).toHaveLength(3);
  });

  it('cards are bought only in SHOP and played only in TRADING', () => {
    const g = game([card('lucky_strike')]);
    g.sim.submit({ kind: 'buy_card', playerId: 'p1', offerId: 'q1_0_lucky_strike' });
    expect(rejects(g.step())).toEqual(['wrong_phase']);
    const { hand } = buyAll(g, 'p1');
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: g.sim.getUniverse().companies[0]!.symbol });
    expect(rejects(g.step())).toEqual(['wrong_phase']);
  });
});

describe('playing cards', () => {
  it('an event card publishes its headline and moves its target for good; the author is revealed at RESULTS', () => {
    const g = game([card('lucky_strike')]);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 5);
    const symbol = g.sim.getUniverse().companies[4]!.symbol;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: symbol });
    g.step(3);
    const published = g.sim.news.log().find((p) => p.source === 'card')!;
    expect(published).toMatchObject({ ownerId: 'p1', target: { scope: 'stock', symbol } });
    expect(published.logReturn).toBeCloseTo(BASE.news.shock.large, 12);
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(0);
    g.to('RESULTS', 2, 1);
    const results = only(g.log, 'results').at(-1)!;
    expect(results.recap.cardAuthors).toEqual([expect.objectContaining({ playerId: 'p1', cardName: card('lucky_strike').name })]);
  });

  it('a fake headline moves the target, then a debunk reverts it; playing it adds heat', () => {
    const g = game([card('planted_rumor')], { cards: { fakeDebunkMinMs: 3000, fakeDebunkMaxMs: 4000 } });
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 5);
    const symbol = g.sim.getUniverse().companies[2]!.symbol;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: symbol, direction: 'down' });
    g.step(120);
    const log = g.sim.news.log();
    const fake = log.find((p) => p.fake)!;
    const debunk = log.find((p) => p.reverts === fake.id)!;
    expect(fake.logReturn).toBeLessThan(0);
    expect(debunk).toBeDefined();
    expect(debunk.tick - fake.tick).toBeGreaterThanOrEqual(30);
    expect(g.sim.getPortfolio('p1')!.heat).toBe(BASE.sec.heat.fakeHeadline);
  });

  it('a fake that the close interrupts is debunked first thing next quarter', () => {
    const g = game([card('planted_rumor')], { cards: { fakeDebunkMinMs: 60_000, fakeDebunkMaxMs: 60_000 } });
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 250); // 5 days before the close; the debunk is due 60 days later
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: g.sim.getUniverse().companies[1]!.symbol, direction: 'up' });
    g.to('TRADING', 3, 30);
    const fake = g.sim.news.log().find((p) => p.fake)!;
    const debunk = g.sim.news.log().find((p) => p.reverts === fake.id)!;
    expect(fake.quarter).toBe(2);
    expect(debunk.quarter).toBe(3);
  });

  it('an insider tip shows the next real headline, word for word, to the holder alone and early', () => {
    const g = game([card('long_lunch')]);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 30);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId });
    g.step();
    // Read before RESULTS: the SEC roll there may arrest (heat 0) or decay the heat.
    expect(g.sim.getPortfolio('p1')!.heat).toBe(BASE.sec.heat.insiderTip);
    g.step(400);
    const early = only(g.log, 'headline').filter((h) => h.early);
    expect(early).toHaveLength(1);
    expect(early[0]!.to).toBe('p1');
    const pub = only(g.log, 'headline').find((h) => !h.early && h.text === early[0]!.text);
    expect(pub).toBeDefined();
    expect(pub!.ts - early[0]!.ts).toBeGreaterThan(0);
    expect(only(g.log, 'headline').filter((h) => h.to !== undefined && h.to !== 'p1')).toHaveLength(0);
  });

  it('card headlines go before a backlog of engine headlines', () => {
    // 30-day quarters with ~20 engine headlines and a 2 s gap: the queue runs behind.
    const g = game([card('lucky_strike')], { news: { randomHeadlinesPerQuarter: 12 } });
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 250);
    expect(g.sim.news.upcoming().some((i) => i.tick < 2 * BASE.time.daysPerQuarter * BASE.time.ticksPerCandle - 60)).toBe(true);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: g.sim.getUniverse().companies[0]!.symbol });
    g.step(BASE.news.minGapMs / BASE.time.tickMs + 2);
    expect(g.sim.news.log().some((p) => p.source === 'card')).toBe(true);
  });

  it('a regime card starts a regime: projector moment, listed at the next briefing, ends after its quarters', () => {
    const g = game([card('war')], { time: { quarters: 5 } });
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 10);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId });
    const events = g.step();
    expect(only(events, 'moment')).toEqual([expect.objectContaining({ kind: 'regime' })]);
    expect(g.sim.cards.activeRegimeNames()).toEqual([card('war').name]);
    g.to('BRIEFING', 3, 1);
    expect(only(g.log, 'briefing').at(-1)!.regimes).toEqual([card('war').name]);
    g.to('BRIEFING', 4, 1); // war lasts 2 quarters: counted down at RESULTS of Q2 and Q3
    expect(g.sim.cards.activeRegimeNames()).toEqual([]);
  });

  it('a card needing a target or a direction is refused without one, and kept', () => {
    const g = game([card('planted_rumor')]);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 5);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: g.sim.getUniverse().companies[0]!.symbol });
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, direction: 'up' });
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: 'nope', direction: 'up' });
    expect(rejects(g.step())).toEqual(['no_target', 'no_target', 'unknown_card']);
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(1);
  });
});

describe('SEC', () => {
  const certain: DeepPartial<GameConfig> = { sec: { catchProbabilityPerHeat: 1, maxCatchProbability: 1, rankMultiplier: [1, 1, 1, 1] } };

  it('heat gets you arrested at RESULTS: fine charged, jailed for the next quarter, orders delayed', () => {
    const g = game([card('insider_tip')], certain);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 30);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId });
    g.step();
    const before = g.sim.getPortfolio('p1')!;
    g.to('RESULTS', 2, 1);
    const results = only(g.log, 'results').at(-1)!;
    expect(results.arrests).toEqual([expect.objectContaining({ playerId: 'p1', reason: 'insider trading', jailDays: BASE.sec.jailQuarters * BASE.time.daysPerQuarter })]);
    expect(results.leaderboard.find((r) => r.playerId === 'p1')!.jailed).toBe(true);
    const after = g.sim.getPortfolio('p1')!;
    expect(after.heat).toBe(0);
    expect(after.jailedUntil).toBe((2 + BASE.sec.jailQuarters) * BASE.time.daysPerQuarter);
    expect(before.cash - after.cash).toBeCloseTo(results.arrests[0]!.fine, 4);
    g.to('TRADING', 3, 2);
    const symbol = g.sim.getUniverse().companies[0]!.symbol;
    const otherSymbol = g.sim.getUniverse().companies[1]!.symbol;
    g.sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: 10 });
    g.sim.submit({ kind: 'order', playerId: 'p1', symbol: otherSymbol, qty: -10 });
    g.sim.submit({ kind: 'order', playerId: 'p2', symbol: g.sim.getUniverse().companies[0]!.symbol, qty: 10 });
    // p2 fills at once; p1's order waits sec.jailOrderDelayMs, then fills.
    const initial = g.step();
    expect(only(initial, 'fill').map((f) => f.playerId)).toEqual(['p2']);
    expect(only(initial, 'reject')).toContainEqual(expect.objectContaining({ playerId: 'p1', code: 'jailed' }));
    expect(g.sim.getPendingOrder('p1').order).toMatchObject({ symbol, qty: 10 });
    g.sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: -10 });
    const later: SimEvent[] = [];
    for (let i = 0; i <= msToTicks(BASE, BASE.sec.jailOrderDelayMs); i++) later.push(...g.step());
    expect(only(later, 'fill').map((f) => f.playerId)).toEqual(['p1']);
    expect(only(later, 'reject')).toContainEqual(expect.objectContaining({ playerId: 'p1', code: 'jailed' }));
    expect(g.sim.getPendingOrder('p1').order).toBeNull();
  });

  it('cancels a delayed jail order when the market closes', () => {
    const g = game([card('insider_tip')], certain);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 30);
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId });
    g.step();
    g.to('TRADING', 3);
    g.step(g.sim.getState().ticksLeft! - 2);
    g.sim.submit({ kind: 'order', playerId: 'p1', symbol: g.sim.getUniverse().companies[0]!.symbol, qty: 10 });
    expect(g.step().some((event) => event.e === 'pending_order' && event.order !== null)).toBe(true);
    const close = g.step();
    expect(close).toContainEqual(expect.objectContaining({ e: 'pending_order', playerId: 'p1', order: null, cancelled: true }));
    expect(g.sim.getPendingOrder('p1').order).toBeNull();
    expect(only(g.step(40), 'fill').filter((fill) => fill.playerId === 'p1')).toHaveLength(0);
  });

  it('trading a stock you manipulated adds heat once per stock per quarter', () => {
    const g = game([card('planted_rumor')]);
    const { hand } = buyAll(g, 'p1');
    g.to('TRADING', 2, 5);
    const symbol = g.sim.getUniverse().companies[3]!.symbol;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: symbol, direction: 'up' });
    g.step();
    for (let i = 0; i < 3; i++) g.sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: 100 });
    g.step();
    expect(g.sim.getPortfolio('p1')!.heat).toBe(BASE.sec.heat.fakeHeadline + BASE.sec.heat.tradeManipulatedTarget);
  });

  it('self-dealing: a card on a stock you hold adds heat, more when it moves your way; legal cards too', () => {
    const heatAfter = (defId: string, held: number, target: (g: Game) => string) => {
      const g = game([card(defId)]);
      const { hand } = buyAll(g, 'p1');
      g.to('TRADING', 2, 5);
      const symbol = g.sim.getUniverse().companies[3]!.symbol;
      if (held !== 0) g.sim.submit({ kind: 'order', playerId: 'p1', symbol, qty: held });
      g.step();
      g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: target(g), direction: 'up' });
      g.step();
      return g.sim.getPortfolio('p1')!.heat;
    };
    const stock = (g: Game) => g.sim.getUniverse().companies[3]!.symbol;
    const other = (g: Game) => g.sim.getUniverse().companies[20]!.symbol;
    const { selfDeal, selfDealInFavor } = BASE.sec.heat;
    // Lucky Strike (legal, up): free on someone else's stock, heat on yours, more if you are long.
    expect(heatAfter('lucky_strike', 0, stock)).toBe(0);
    expect(heatAfter('lucky_strike', 100, other)).toBe(0);
    expect(heatAfter('lucky_strike', -100, stock)).toBe(selfDeal);
    expect(heatAfter('lucky_strike', 100, stock)).toBe(selfDeal + selfDealInFavor);
    // Act of God (legal, down) on a stock you are short.
    expect(heatAfter('act_of_god', -100, stock)).toBe(selfDeal + selfDealInFavor);
    // An illegal card keeps its own heat on top.
    expect(heatAfter('planted_rumor', 100, stock)).toBe(BASE.sec.heat.fakeHeadline + selfDeal + selfDealInFavor);
  });

  it('a whole game with cards is deterministic', () => {
    const play = () => {
      const g = game(DEFAULT_CATALOG, {}, ['p1', 'p2'], 9);
      const { hand } = buyAll(g, 'p1');
      g.to('TRADING', 2, 50);
      const target = g.sim.getUniverse().companies[0]!.symbol;
      for (const c of hand) g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: c.cardId, target, direction: 'up' });
      g.to('FINAL');
      return g.log;
    };
    expect(play()).toEqual(play());
  });
});
