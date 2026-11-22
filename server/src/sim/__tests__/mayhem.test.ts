/**
 * Mayhem cards through createSim: Freeze, Ice Age, Pickpocket, Flashbang, Uno Reverse, Freak the F-
 * Out, HODL, and the Jensen Special market crash.
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import type { DeepPartial, GameConfig, Phase } from '@tg/shared';
import type { CardCatalogEntry } from '@tg/shared/cards';
import { validateCardCatalog } from '@tg/shared/cards';
import { DEFAULT_CATALOG } from '../data/cardData.ts';
import { DEFAULT_HEADLINES } from '../data/headlineData.ts';
import { createSim } from '../index.ts';
import type { Sim, SimEvent, SimEventOf } from '../index.ts';

const BASE: GameConfig = mergeConfig(defaultConfig, {
  time: { daysPerQuarter: 30, quarters: 3 },
  phaseMs: { BRIEFING: 200, RESULTS: 200, SHOP: 200 },
  lobby: { minPlayers: 1 },
  // No engine news in the way: prices only move with noise and the cards.
  news: { maxGapMs: 0, randomHeadlinesPerQuarter: 0 },
  cards: { offersPerShop: 4 },
});
const tpc = BASE.time.ticksPerCandle;
const card = (defId: string): CardCatalogEntry => DEFAULT_CATALOG.find((c) => c.defId === defId)!;
const only = <E extends SimEvent['e']>(events: SimEvent[], e: E) => events.filter((x): x is SimEventOf<E> => x.e === e);
const rejects = (events: SimEvent[]) => only(events, 'reject').map((r) => r.code);

interface Game {
  sim: Sim;
  log: SimEvent[];
  to(phase: Phase, quarter?: number, extra?: number): SimEvent[];
  step(n?: number): SimEvent[];
  /** Plays p1's first card in TRADING of Q2, on `target`. */
  play(target?: string): SimEvent[];
  stock: string;
}

/** Both players buy everything in the Q1 shop (each sees only `catalog`), then trading of Q2 starts. */
function game(catalog: CardCatalogEntry[], overrides: DeepPartial<GameConfig> = {}): Game {
  const sim = createSim(5, mergeConfig(BASE, overrides), { catalog });
  for (const id of ['p1', 'p2']) sim.submit({ kind: 'add_player', playerId: id, name: id.toUpperCase() });
  sim.submit({ kind: 'start', playerId: 'p1' });
  const log: SimEvent[] = [];
  const step = (n = 1) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...sim.tick());
    log.push(...out);
    return out;
  };
  const to = (phase: Phase, quarter?: number, extra = 0) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < 200_000; i++) {
      const s = sim.getState();
      if (s.phase === phase && (quarter === undefined || s.quarter === quarter)) break;
      out.push(...step());
    }
    if (extra > 0) out.push(...step(extra));
    return out;
  };
  to('SHOP', 1);
  step();
  for (const id of ['p1', 'p2']) {
    const offers = only(log, 'shop').filter((s) => s.playerId === id).at(-1)!.offers;
    for (const o of offers) sim.submit({ kind: 'buy_card', playerId: id, offerId: o.offerId });
  }
  step();
  to('TRADING', 2, 3);
  const stock = sim.getUniverse().companies[2]!.symbol;
  return {
    sim,
    log,
    to,
    step,
    stock,
    play(target) {
      const hand = sim.getPortfolio('p1')!.hand!;
      sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, ...(target ? { target } : {}) });
      return step();
    },
  };
}

const order = (g: Game, playerId: string, qty: number) => {
  g.sim.submit({ kind: 'order', playerId, symbol: g.stock, qty });
  return g.step();
};
const held = (g: Game, playerId: string) => g.sim.getPortfolio(playerId)!.positions.find((p) => p.symbol === g.stock)?.qty ?? 0;
const hits = (events: SimEvent[]) => only(events, 'card_hit');

describe('mayhem cards', () => {
  it('the shipped catalog is valid with the new cards', () => {
    expect(validateCardCatalog(DEFAULT_CATALOG, DEFAULT_HEADLINES, defaultConfig)).toEqual([]);
    for (const id of ['freeze', 'ice_age', 'pickpocket', 'flashbang', 'uno_reverse', 'freak_out', 'jensen_special', 'hodl', 'force_buy', 'are_you_human', 'monkeytype', 'surprise_bill']) {
      expect(card(id), id).toBeDefined();
    }
  });

  it('a hit names who played the card and which card it was (the victim sees it)', () => {
    const g = game([card('pickpocket')]);
    expect(hits(g.play('p2'))).toEqual([expect.objectContaining({ to: 'p2', by: 'p1', played: card('pickpocket').name, kind: 'stolen' })]);
  });

  it('Freeze stops the rival trading for a tenth of the quarter, then thaws', () => {
    const g = game([card('freeze')]);
    const events = g.play('p2');
    expect(hits(events)).toEqual([expect.objectContaining({ to: 'p2', kind: 'frozen' })]);
    const thaw = hits(events)[0]!.untilDay!;
    expect(thaw * tpc - g.sim.getMarketSnapshot().day * tpc).toBeGreaterThan(0);
    expect(rejects(order(g, 'p2', 10))).toEqual(['frozen']);
    expect(rejects(order(g, 'p1', 10))).toEqual([]);
    expect(g.sim.getPortfolio('p2')!.frozenUntil).toBeCloseTo(thaw, 9);
    // A tenth of a 30-day quarter = 3 trading days.
    expect(thaw - (g.sim.getMarketSnapshot().day + g.sim.getMarketSnapshot().tickOfDay / tpc)).toBeLessThanOrEqual(3 + 1e-9);
    g.step(3 * tpc + 2);
    expect(rejects(order(g, 'p2', 10))).toEqual([]);
    expect(g.sim.getPortfolio('p2')!.frozenUntil).toBeUndefined();
  });

  it('Freeze and HODL never carry into the next quarter', () => {
    const g = game([card('freeze'), card('hodl')]);
    // Two days before Q2 closes: both would outlast the quarter.
    g.to('TRADING', 2, BASE.time.daysPerQuarter * tpc - 2 * tpc - 4);
    order(g, 'p2', 100);
    for (const c of g.sim.getPortfolio('p1')!.hand!) {
      g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: c.cardId, target: 'p2' });
      g.step();
    }
    const closeDay = 2 * BASE.time.daysPerQuarter;
    const p2 = g.sim.getPortfolio('p2')!;
    expect(p2.frozenUntil).toBeLessThanOrEqual(closeDay);
    expect(p2.hodlUntil).toBeLessThanOrEqual(closeDay);
    g.to('TRADING', 3, 2);
    expect(g.sim.getPortfolio('p2')!.frozenUntil).toBeUndefined();
    expect(g.sim.getPortfolio('p2')!.hodlUntil).toBeUndefined();
    expect(rejects(order(g, 'p2', -100))).toEqual([]);
  });

  it('jail: the arrest leaves one card, which can still be played; orders are delayed', () => {
    const g = game([card('freeze'), card('pickpocket'), card('uno_reverse')], {
      sec: { catchProbabilityPerHeat: 1, maxCatchProbability: 1, rankMultiplier: [1, 1, 1, 1] },
    });
    expect(g.sim.getPortfolio('p1')!.hand!.length).toBeGreaterThan(2);
    // An illegal card in Q2 gets p1 arrested at RESULTS.
    const freeze = g.sim.getPortfolio('p1')!.hand!.find((c) => c.card.defId === 'freeze')!;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: freeze.cardId, target: 'p2' });
    g.step();
    g.to('RESULTS', 2, 1);
    expect(only(g.log, 'results').at(-1)!.arrests).toEqual([expect.objectContaining({ playerId: 'p1' })]);
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(BASE.sec.jailHandLimit);
    g.to('TRADING', 3, 2);
    expect(g.sim.getPortfolio('p1')!.jailedUntil).toBeGreaterThan(g.sim.getMarketSnapshot().day);
    const kept = g.sim.getPortfolio('p1')!.hand![0]!;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: kept.cardId, target: 'p2' });
    expect(rejects(g.step())).not.toContain('jailed');
    expect(BASE.sec.jailOrderDelayMs).toBe(3_000);
  });

  it('a player card refuses a missing or wrong target and stays in the hand', () => {
    const g = game([card('freeze')]);
    const before = g.sim.getPortfolio('p1')!.hand!.length;
    expect(rejects(g.play())).toEqual(['no_target']);
    expect(rejects(g.play('p1'))).toEqual(['no_target']);
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(before);
  });

  it('Ice Age freezes every other player, not the one who plays it', () => {
    const g = game([card('ice_age')]);
    expect(hits(g.play()).map((h) => [h.to, h.kind])).toEqual([['p2', 'frozen']]);
    expect(rejects(order(g, 'p2', 10))).toEqual(['frozen']);
    expect(rejects(order(g, 'p1', 10))).toEqual([]);
  });

  it('Pickpocket moves a random card from the rival to the thief; an empty hand has nothing to steal', () => {
    const g = game([card('pickpocket')]);
    const before = g.sim.getPortfolio('p2')!.hand!.length;
    const mine = g.sim.getPortfolio('p1')!.hand!.length;
    const events = g.play('p2');
    expect(hits(events)).toEqual([expect.objectContaining({ to: 'p2', kind: 'stolen', cardName: 'Pickpocket' })]);
    expect(g.sim.getPortfolio('p2')!.hand).toHaveLength(before - 1);
    // The thief played one card and took one: the hand size holds.
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(mine);
    // Empty the rival's hand (they play their own Pickpockets on p1), then steal again: refused, card kept.
    for (const c of g.sim.getPortfolio('p2')!.hand!) {
      g.sim.submit({ kind: 'play_card', playerId: 'p2', cardId: c.cardId, target: 'p1' });
      g.step();
    }
    const p1Before = g.sim.getPortfolio('p1')!.hand!.length;
    if (g.sim.getPortfolio('p2')!.hand!.length === 0 && p1Before > 0) {
      expect(rejects(g.play('p2'))).toEqual(['nothing_to_steal']);
      expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(p1Before);
    }
  });

  it('Flashbang blinds every other player', () => {
    const g = game([card('flashbang')]);
    expect(hits(g.play())).toEqual([expect.objectContaining({ to: 'p2', kind: 'flashbang', ms: card('flashbang').effect.kind === 'flashbang' ? 4500 : 0 })]);
  });

  it('Uno Reverse flips the rival biggest bet at market', () => {
    const g = game([card('uno_reverse')]);
    order(g, 'p2', 500);
    expect(held(g, 'p2')).toBe(500);
    const events = g.play('p2');
    expect(held(g, 'p2')).toBe(-500);
    expect(only(events, 'fill')).toEqual([expect.objectContaining({ playerId: 'p2', qty: -1000, reason: 'card' })]);
    expect(hits(events)).toEqual([expect.objectContaining({ to: 'p2', kind: 'reversed', symbol: g.stock })]);
  });

  it('Uno Reverse on a rival with no bets is refused and kept', () => {
    const g = game([card('uno_reverse')]);
    const before = g.sim.getPortfolio('p1')!.hand!.length;
    expect(rejects(g.play('p2'))).toEqual(['nothing_to_reverse']);
    expect(g.sim.getPortfolio('p1')!.hand).toHaveLength(before);
  });

  it('Freak the F- Out sells everyone, the player included', () => {
    const g = game([card('freak_out')]);
    order(g, 'p1', 300);
    order(g, 'p2', -200);
    const events = g.play();
    expect(held(g, 'p1')).toBe(0);
    expect(held(g, 'p2')).toBe(0);
    expect(only(events, 'fill').every((f) => f.reason === 'card')).toBe(true);
    expect(hits(events).map((h) => [h.to, h.kind])).toEqual([['p2', 'freak_out']]);
  });

  it('HODL stops the rival selling or cashing out, not buying more', () => {
    const g = game([card('hodl')]);
    order(g, 'p2', 400);
    expect(hits(g.play('p2'))).toEqual([expect.objectContaining({ to: 'p2', kind: 'hodl' })]);
    expect(rejects(order(g, 'p2', -400))).toEqual(['hodl']);
    expect(rejects(order(g, 'p2', 100))).toEqual([]);
    expect(held(g, 'p2')).toBe(500);
    expect(g.sim.getPortfolio('p2')!.hodlUntil).toBeGreaterThan(0);
  });

  it('Jensen Special crashes the whole market, and the authors of mayhem are revealed at RESULTS', () => {
    const g = game([card('jensen_special'), card('flashbang')]);
    const hand = g.sim.getPortfolio('p1')!.hand!;
    for (const c of hand) {
      g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: c.cardId });
      g.step(3);
    }
    const crash = g.sim.news.log().find((p) => p.cardName === 'Jensen Special');
    expect(crash).toMatchObject({ target: { scope: 'market' } });
    expect(crash!.logReturn).toBeLessThan(0);
    if (hand.some((c) => c.card.defId === 'flashbang')) {
      g.to('RESULTS', 2, 1);
      const results = only(g.log, 'results').at(-1)!;
      expect(results.recap.cardAuthors).toContainEqual(expect.objectContaining({ playerId: 'p1', cardName: 'Flashbang' }));
    }
  });
});

describe('mayhem cards, round two', () => {
  it('Force Buy puts every other player all in on the stock, in the chosen direction', () => {
    const g = game([card('force_buy')]);
    const hand = g.sim.getPortfolio('p1')!.hand!;
    g.sim.submit({ kind: 'play_card', playerId: 'p1', cardId: hand[0]!.cardId, target: g.stock, direction: 'down' });
    const events = g.step();
    expect(held(g, 'p2')).toBeLessThan(0);
    expect(held(g, 'p1')).toBe(0);
    const p2 = g.sim.getPortfolio('p2')!;
    // All of the buying power: what is left is a sliver of the leverage cap.
    expect(p2.buyingPower!).toBeLessThan(0.05 * BASE.trading.leverageCap * p2.equity);
    expect(only(events, 'fill').every((f) => f.playerId === 'p2' && f.reason === 'card')).toBe(true);
    expect(hits(events)).toEqual([expect.objectContaining({ to: 'p2', kind: 'forced', symbol: g.stock })]);
  });

  for (const [defId, kind] of [['are_you_human', 'captcha'], ['monkeytype', 'typing']] as const) {
    it(`${defId}: every other player must pass a ${kind} before trading again`, () => {
      const g = game([card(defId)]);
      expect(hits(g.play())).toEqual([expect.objectContaining({ to: 'p2', kind: 'challenge' })]);
      const challenge = g.sim.getPortfolio('p2')!.challenge!;
      expect(challenge).toMatchObject({ kind });
      expect(g.sim.getPortfolio('p1')!.challenge).toBeUndefined();
      expect(rejects(order(g, 'p2', 10))).toEqual(['challenge']);
      expect(rejects(order(g, 'p1', 10))).toEqual([]);
      g.sim.submit({ kind: 'solve_challenge', playerId: 'p2', challengeId: 'nope' });
      expect(rejects(g.step())).toEqual(['invalid']);
      g.sim.submit({ kind: 'solve_challenge', playerId: 'p2', challengeId: challenge.id });
      g.step();
      expect(g.sim.getPortfolio('p2')!.challenge).toBeUndefined();
      expect(rejects(order(g, 'p2', 10))).toEqual([]);
    });
  }

  it('an unsolved challenge ends with the quarter', () => {
    const g = game([card('are_you_human')]);
    g.play();
    expect(g.sim.getPortfolio('p2')!.challenge).toBeDefined();
    g.to('TRADING', 3, 2);
    expect(g.sim.getPortfolio('p2')!.challenge).toBeUndefined();
  });

  it('Surprise Bill makes everyone buy random stocks until they hold five', () => {
    const g = game([card('surprise_bill')]);
    order(g, 'p2', 100);
    const other = g.sim.getUniverse().companies[7]!.symbol;
    g.sim.submit({ kind: 'order', playerId: 'p2', symbol: other, qty: 50 });
    g.step();
    expect(g.sim.getPortfolio('p2')!.positions).toHaveLength(2);
    const events = g.play();
    for (const id of ['p1', 'p2']) {
      const positions = g.sim.getPortfolio(id)!.positions;
      expect(positions).toHaveLength(card('surprise_bill').effect.kind === 'surprise_bill' ? 5 : 0);
      expect(positions.every((pos) => pos.qty > 0)).toBe(true);
    }
    expect(only(events, 'fill').filter((f) => f.playerId === 'p2')).toHaveLength(3);
    expect(hits(events)).toEqual([expect.objectContaining({ to: 'p2', kind: 'bill' })]);
  });
});
