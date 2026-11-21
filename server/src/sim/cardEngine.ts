/**
 * Cards in play (DESIGN.md section 5): hands, buying in SHOP, playing in TRADING, heat, jail, the
 * end-of-quarter SEC roll, regimes, and who played what (revealed at RESULTS). Pure; randomness from
 * the Rng streams passed in.
 *
 * Built on the teammates' modules, which it does not change:
 *   shared/cards.ts + shared/data/cards.json   the catalog (what each card does, price, heat)
 *   ./shop.ts      one shared selection per quarter, priced per buyer
 *   ./sec.ts       heat, catch roll, fines, jail
 *   ./regimes.ts   regime state, market input, quarter countdown, lobbying bills
 * and on ./news.ts for every headline a card makes (one global queue, minimum gap).
 *
 * Effects:
 *   insider_tip    the next matching real headline in the queue is shown to the player alone, word for
 *                  word, at least leadMult * cards.insiderLeadMs before everyone (no match = card kept)
 *   earnings_peek  a private note with the chosen stock's true earnings surprise this quarter
 *   fake_headline  a fake_template headline moves the target now; news.ts debunks and reverts it later
 *   event_shock    an event headline with a permanent move
 *   regime         startRegime + its start headline now, its "during" headlines spread over the rest
 *                  of the quarter, a projector moment; it bends the market until it ends
 *   lobbying       the same as a regime (a bill; passes or fails when it ends)
 *   counter cards  stretch goal: not offered by the shop, refused if played
 * Illegal cards add their heat when played. A card that moves prices (fake headline, event, lobbying)
 * aimed at a stock or sector the player holds adds sec.heat.selfDeal, plus selfDealInFavor when it
 * moves it the player's way, legal cards included: cards are meant to be played on the others' bets.
 * Trading a stock you moved with a card this quarter (on it or its sector) adds tradeManipulatedTarget
 * heat once per stock per quarter.
 */
import { msToTicks } from '@tg/shared';
import type { Arrest, Card, CardDirection, CardReveal, GameConfig, PlayerId, Sector, SymbolId } from '@tg/shared';
import { SECTORS } from '@tg/shared';
import type { CardCatalogEntry, HeatKey } from '@tg/shared/cards';
import { toCardDef } from '@tg/shared/cards';
import type { News, NewsItem } from './news.ts';
import { emptyRegimeState, endQuarter, marketInputFor, startRegime } from './regimes.ts';
import type { RegimeState } from './regimes.ts';
import type { Rng } from './rng.ts';
import { addHeat, isJailed, resolveSec } from './sec.ts';
import type { HeatSources } from './sec.ts';
import { drawShopSelection, priceShopOffers } from './shop.ts';
import { shockSize } from './shocks.ts';
import type { ShockTarget } from './shocks.ts';
import type { Trading } from './trading.ts';
import type { MarketStepInput } from './market.ts';
import type { SimEventOf, SimRejectCode } from './types.ts';
import type { Universe } from './universe.ts';

export interface CardEngineDeps {
  config: GameConfig;
  universe: Universe;
  catalog: readonly CardCatalogEntry[];
  news: News;
  trading: Trading;
  shopRng: Rng;
  secRng: Rng;
  regimeRng: Rng;
  /** Market tick of the step about to be made. */
  marketTick(): number;
  /** Market tick of the current quarter's last TRADING step. */
  quarterEndTick(): number;
}

type CardEvent = SimEventOf<'headline'> | SimEventOf<'moment'> | SimEventOf<'portfolio'>;
export type CardResult = { ok: true; events: CardEvent[] } | { ok: false; code: SimRejectCode; message: string };

interface HandCard {
  cardId: string;
  entry: CardCatalogEntry;
}

interface PlayerCards {
  id: PlayerId;
  name: string;
  hand: HandCard[];
  heat: number;
  /** Heat gained this quarter by kind (arrest wording). */
  sources: HeatSources;
  jailedUntil?: number;
  /** Card spend this quarter. */
  spend: number;
  /** Fines paid at the last quarter close. */
  fines: number;
  /** Jail days sentenced over the whole game ("Longest sentence"). */
  jailDays: number;
  /** This quarter's offers: offerId -> entry, price, bought. */
  offers: Map<string, { entry: CardCatalogEntry; price: number; bought: boolean }>;
  offerList: SimEventOf<'shop'>['offers'];
  /** Stocks this player manipulated this quarter, and those already heated for trading them. */
  manipulated: Set<SymbolId>;
  heated: Set<SymbolId>;
}

export interface QuarterClose {
  arrests: Arrest[];
  /**
   * Cards played this quarter that published no headline (insider tips, earnings peeks). Cards with a
   * headline are revealed by results.ts from the news log (ownerId + cardName).
   */
  reveals: CardReveal[];
  moments: SimEventOf<'moment'>[];
}

export interface CardEngine {
  addPlayer(id: PlayerId, name: string): void;
  removePlayer(id: PlayerId): void;
  /** Adds hand, heat and jail to a trading portfolio event. */
  decorate(event: SimEventOf<'portfolio'>): SimEventOf<'portfolio'>;
  /** Game day (integer) -> true while the player may not trade or play cards. */
  isJailed(id: PlayerId, day: number): boolean;
  /** An order on `symbol` went through (manipulated-target heat). */
  onOrder(id: PlayerId, symbol: SymbolId): void;
  /** SHOP starts: one shared selection, priced per player. Empty in the last quarter. */
  openShop(quarter: number): SimEventOf<'shop'>[];
  /** The offers a player was shown this SHOP (reconnect). */
  offersOf(id: PlayerId): SimEventOf<'shop'> | null;
  buy(id: PlayerId, offerId: string): CardResult;
  play(id: PlayerId, cardId: string, target: string | undefined, direction: CardDirection | undefined, quarter: number): CardResult;
  /** Before each TRADING step: insider previews due now. */
  beforeStep(tick: number): SimEventOf<'headline'>[];
  /** Regimes' part of the coming market step; dRate is a one-off and is consumed. */
  marketInput(): Pick<MarketStepInput, 'volMult' | 'corrMult' | 'sectorDriftPerDay' | 'dRate'>;
  /** At the quarter close: regimes count down, the SEC rolls, fines are charged. */
  closeQuarter(quarter: number, nextTradingDay: number): QuarterClose;
  /** At BRIEFING: per-quarter counters start over. */
  startQuarter(): void;
  activeRegimeNames(): string[];
  /** Card spend this quarter, fines at the last quarter close, jail days over the game (statements, awards). */
  ledger(id: PlayerId): { spend: number; fines: number; jailDays: number };
}

export function createCardEngine(deps: CardEngineDeps): CardEngine {
  const { config, universe, catalog, news, trading } = deps;
  const players = new Map<PlayerId, PlayerCards>();
  const companyBySymbol = new Map(universe.companies.map((c) => [c.symbol, c]));
  const sectorFund = new Map(universe.funds.filter((f) => f.kind === 'sector' && f.sector).map((f) => [f.symbol, f.sector!]));
  let regimes: RegimeState = emptyRegimeState();
  let pendingDRate = 0;
  let cardSeq = 0;
  let previewSeq = 0;
  let regimeSeq = 0;
  let reveals: CardReveal[] = [];
  const previews: Array<{ playerId: PlayerId; atTick: number; headline: Omit<SimEventOf<'headline'>, 'id'> }> = [];

  const fail = (code: SimRejectCode, message: string): CardResult => ({ ok: false, code, message });

  /** A projector moment; the per-game budget is applied by the caller (results.addMoment). */
  function moment(kind: SimEventOf<'moment'>['kind'], text: string): SimEventOf<'moment'>[] {
    return [{ e: 'moment', kind, text }];
  }

  function decorate(event: SimEventOf<'portfolio'>): SimEventOf<'portfolio'> {
    const p = players.get(event.playerId);
    if (p === undefined) return event;
    const hand: Card[] = p.hand.map((h) => ({ cardId: h.cardId, card: toCardDef(h.entry) }));
    return { ...event, heat: p.heat, hand, ...(p.jailedUntil === undefined ? {} : { jailedUntil: p.jailedUntil }) };
  }

  function portfolioOf(id: PlayerId): SimEventOf<'portfolio'>[] {
    const p = trading.portfolio(id);
    return p === undefined ? [] : [decorate(p)];
  }

  function heat(p: PlayerCards, entry: CardCatalogEntry): void {
    if (entry.heat !== null) addHeatTo(p, entry.heat);
  }

  function addHeatTo(p: PlayerCards, key: HeatKey): void {
    const next = addHeat(config, p.heat, p.sources, key);
    p.heat = next.heat;
    p.sources = next.sources;
  }

  /** Does `symbol` move with `target`? (the stock itself or its sector fund; any stock or fund of a sector) */
  function exposedTo(symbol: SymbolId, target: ShockTarget): boolean {
    if (target.scope === 'market') return true;
    const sector = companyBySymbol.get(symbol)?.sector ?? sectorFund.get(symbol);
    if (target.scope === 'sector') return sector === target.sector;
    return symbol === target.symbol || (sectorFund.has(symbol) && sector === companyBySymbol.get(target.symbol)?.sector);
  }

  /**
   * Self-dealing: a price-moving card on something the player holds. Heat for holding it (not for a
   * market-wide card), more when the move goes the player's way (net long and up, net short and down).
   */
  function selfDealHeat(p: PlayerCards, target: ShockTarget, direction: CardDirection): void {
    const held = (trading.portfolio(p.id)?.positions ?? []).filter((pos) => pos.qty !== 0 && exposedTo(pos.symbol, target));
    if (held.length === 0) return;
    if (target.scope !== 'market') addHeatTo(p, 'selfDeal');
    const net = held.reduce((sum, pos) => sum + pos.qty * pos.avgPrice, 0);
    if ((direction === 'up' && net > 0) || (direction === 'down' && net < 0)) addHeatTo(p, 'selfDealInFavor');
  }

  function sectorOf(target: string | undefined): Sector | undefined {
    if (target === undefined) return undefined;
    if ((SECTORS as readonly string[]).includes(target)) return target as Sector;
    return companyBySymbol.get(target)?.sector ?? sectorFund.get(target);
  }

  function manipulate(p: PlayerCards, target: ShockTarget): void {
    if (target.scope === 'stock') p.manipulated.add(target.symbol);
    if (target.scope === 'sector') {
      for (const c of universe.companies) if (c.sector === target.sector) p.manipulated.add(c.symbol);
      for (const [fund, sector] of sectorFund) if (sector === target.sector) p.manipulated.add(fund);
    }
  }

  function targetLabel(target: ShockTarget): string {
    return target.scope === 'stock' ? target.symbol : target.scope === 'sector' ? target.sector : 'the market';
  }

  /** The next real headline in the queue matching the tip's focus, rendered; null if none. */
  function tipFor(focus: 'any' | 'sector' | 'stock', sector: Sector | undefined, symbol: SymbolId | undefined): NewsItem | null {
    for (const item of news.upcoming()) {
      if (item.query.kind !== 'real' || item.ownerId !== undefined) continue;
      const t = item.target;
      if (focus === 'stock' && !(t.scope === 'stock' && t.symbol === symbol)) continue;
      if (focus === 'sector') {
        const s = t.scope === 'sector' ? t.sector : t.scope === 'stock' ? companyBySymbol.get(t.symbol)?.sector : undefined;
        if (s !== sector) continue;
      }
      if (news.render(item) !== null) return item;
    }
    return null;
  }

  return {
    addPlayer(id, name) {
      if (players.has(id)) return;
      players.set(id, { id, name, hand: [], heat: 0, sources: {}, spend: 0, fines: 0, jailDays: 0, offers: new Map(), offerList: [], manipulated: new Set(), heated: new Set() });
    },
    removePlayer: (id) => void players.delete(id),
    decorate,

    isJailed(id, day) {
      return isJailed(players.get(id)?.jailedUntil, day);
    },

    onOrder(id, symbol) {
      const p = players.get(id);
      if (p === undefined || !p.manipulated.has(symbol) || p.heated.has(symbol)) return;
      p.heated.add(symbol);
      const next = addHeat(config, p.heat, p.sources, 'tradeManipulatedTarget');
      p.heat = next.heat;
      p.sources = next.sources;
    },

    openShop(quarter) {
      const last = quarter >= config.time.quarters;
      const selection = last ? null : drawShopSelection(deps.shopRng, catalog, config, { quarter, activeRegimes: regimes.active.length });
      const out: SimEventOf<'shop'>[] = [];
      for (const p of players.values()) {
        p.offers = new Map();
        const portfolio = trading.portfolio(p.id);
        if (selection === null || portfolio === undefined || portfolio.eliminated) {
          p.offerList = [];
        } else {
          p.offerList = priceShopOffers(selection, config, portfolio.equity);
          p.offerList.forEach((offer, i) => p.offers.set(offer.offerId, { entry: selection.entries[i]!, price: offer.price, bought: false }));
        }
        out.push({ e: 'shop', playerId: p.id, offers: p.offerList });
      }
      return out;
    },

    offersOf(id) {
      const p = players.get(id);
      return p === undefined ? null : { e: 'shop', playerId: id, offers: p.offerList };
    },

    buy(id, offerId) {
      const p = players.get(id);
      const portfolio = trading.portfolio(id);
      if (p === undefined || portfolio === undefined) return fail('unknown_player', 'unknown player');
      if (portfolio.eliminated) return fail('eliminated', 'you have been eliminated');
      const offer = p.offers.get(offerId);
      if (offer === undefined) return fail('invalid', 'that offer is not in your shop');
      if (offer.bought) return fail('invalid', 'you already bought that card');
      if (p.hand.length >= config.cards.handLimit) return fail('hand_full', `your hand is full (${config.cards.handLimit} cards)`);
      if (portfolio.equity - offer.price < config.economy.eliminationEquity) return fail('insufficient_funds', 'you cannot afford that card');
      trading.charge(id, offer.price);
      offer.bought = true;
      p.spend += offer.price;
      p.hand.push({ cardId: `c${++cardSeq}`, entry: offer.entry });
      return { ok: true, events: portfolioOf(id) };
    },

    play(id, cardId, target, direction, quarter) {
      const p = players.get(id);
      if (p === undefined) return fail('unknown_player', 'unknown player');
      const index = p.hand.findIndex((h) => h.cardId === cardId);
      if (index < 0) return fail('unknown_card', 'that card is not in your hand');
      const entry = p.hand[index]!.entry;
      const fx = entry.effect;
      if (entry.needsDirection && direction === undefined) return fail('no_target', `${entry.name} needs a direction (up or down)`);

      // Resolve the target the card asks for.
      let shockTarget: ShockTarget = { scope: 'market' };
      if (entry.targetKind === 'stock') {
        if (target === undefined || !companyBySymbol.has(target)) return fail('no_target', `${entry.name} needs a stock as its target`);
        shockTarget = { scope: 'stock', symbol: target };
      } else if (entry.targetKind === 'sector') {
        const sector = sectorOf(target);
        if (sector === undefined) return fail('no_target', `${entry.name} needs a sector (or a stock or sector fund in it) as its target`);
        shockTarget = { scope: 'sector', sector };
      }

      const now = deps.marketTick();
      const events: CardEvent[] = [];
      const owner = { ownerId: id, cardName: entry.name };
      let revealed = `${entry.name}${shockTarget.scope === 'market' ? '' : ` on ${targetLabel(shockTarget)}`}${direction ? ` (${direction})` : ''}`;

      switch (fx.kind) {
        case 'insider_tip': {
          const tip = tipFor(
            fx.focus,
            shockTarget.scope === 'sector' ? shockTarget.sector : undefined,
            shockTarget.scope === 'stock' ? shockTarget.symbol : undefined,
          );
          if (tip === null) return fail('nothing_to_tip', 'no headline is coming up for that tip yet; keep the card for later');
          const lead = msToTicks(config, config.cards.insiderLeadMs * fx.leadMult);
          const shown = news.render(tip)!;
          const { e: _e, ...fields } = shown;
          previews.push({ playerId: id, atTick: Math.max(now, tip.tick - lead), headline: { e: 'headline', ...fields, to: id, early: true } });
          break;
        }
        case 'earnings_peek': {
          const plan = news.plan();
          const company = companyBySymbol.get(target!)!;
          const surprise = plan?.surprise[company.symbol] ?? 0;
          const verb = surprise >= 0 ? 'beat' : 'miss';
          events.push({
            e: 'headline',
            to: id,
            id: `tip${++previewSeq}`,
            text: `Boardroom mole: ${company.name} will ${verb} consensus by ${Math.abs(surprise * 100).toFixed(1)}% this quarter`,
            symbol: company.symbol,
            sector: company.sector,
            ts: now / config.time.ticksPerCandle,
            early: true,
          });
          break;
        }
        case 'fake_headline': {
          const d = direction!;
          news.enqueue({
            tick: now,
            source: 'card',
            query: { kind: 'fake_template', scope: fx.scope, direction: d, magnitude: fx.magnitude },
            target: shockTarget,
            logReturn: shockSize(config, fx.magnitude, d),
            fake: true,
            ...owner,
          });
          selfDealHeat(p, shockTarget, d);
          manipulate(p, shockTarget);
          break;
        }
        case 'event_shock': {
          news.enqueue({
            tick: now,
            source: 'card',
            query: { kind: 'event', scope: fx.scope, direction: fx.direction, magnitude: fx.magnitude },
            target: shockTarget,
            logReturn: shockSize(config, fx.magnitude, fx.direction),
            ...owner,
          });
          selfDealHeat(p, shockTarget, fx.direction);
          manipulate(p, shockTarget);
          revealed = `${entry.name}${shockTarget.scope === 'market' ? '' : ` on ${targetLabel(shockTarget)}`}`;
          break;
        }
        case 'regime':
        case 'lobbying': {
          const started = startRegime(config, regimes, {
            id: `r_q${quarter}_${entry.defId}_${++regimeSeq}`,
            defId: entry.defId,
            name: entry.name,
            effect: fx,
            ownerId: id,
            ...(shockTarget.scope === 'sector' ? { sector: shockTarget.sector } : {}),
          });
          if (!started.ok) {
            return started.reason === 'regime_cap'
              ? fail('regime_cap', `at most ${config.regimes.maxActive} regimes can run at once`)
              : fail('no_target', `${entry.name} needs a sector`);
          }
          regimes = started.state;
          pendingDRate += started.dRate;
          // A bill lifts its sector if it passes: lobbying for your own bets is self-dealing too.
          if (fx.kind === 'lobbying') selfDealHeat(p, shockTarget, 'up');
          // Only the start headline carries the author (one reveal per card); the rest are its follow-ups.
          const headline = (templateId: string, tick: number, first = false): NewsItem => ({
            tick,
            source: 'regime',
            templateId,
            query: { kind: 'real', scope: 'market', direction: 'neutral' },
            target: shockTarget,
            logReturn: 0,
            ...(first ? owner : {}),
          });
          news.enqueue(headline(started.startHeadline, now, true));
          const during = started.regime.regime.headlines;
          const span = Math.max(1, deps.quarterEndTick() - now);
          during.forEach((templateId, k) => news.enqueue(headline(templateId, now + Math.round(((k + 1) * span) / (during.length + 1)))));
          events.push(...moment('regime', `${entry.name.toUpperCase()}: ${entry.description}`));
          break;
        }
        case 'fact_check':
        case 'trading_halt':
        case 'sec_tip_off':
          return fail('not_implemented', 'counter cards are not in this version of the game');
      }

      heat(p, entry);
      p.hand.splice(index, 1);
      if (fx.kind === 'insider_tip' || fx.kind === 'earnings_peek') reveals.push({ playerId: id, name: p.name, cardName: entry.name, text: revealed });
      events.push(...portfolioOf(id));
      return { ok: true, events };
    },

    beforeStep(tick) {
      const due: SimEventOf<'headline'>[] = [];
      for (let i = previews.length - 1; i >= 0; i--) {
        const preview = previews[i]!;
        if (preview.atTick > tick) continue;
        previews.splice(i, 1);
        due.unshift({ ...preview.headline, id: `tip${++previewSeq}`, ts: tick / config.time.ticksPerCandle });
      }
      return due;
    },

    marketInput() {
      const input = marketInputFor(regimes);
      const dRate = pendingDRate;
      pendingDRate = 0;
      return { ...input, ...(dRate === 0 ? {} : { dRate }) };
    },

    closeQuarter(quarter, nextTradingDay) {
      // Regimes count down; endings are announced first thing next quarter.
      const ended = endQuarter(deps.regimeRng, config, regimes);
      regimes = ended.state;
      pendingDRate += ended.dRate;
      for (const e of ended.ended) {
        if (e.headline === undefined) continue;
        news.enqueue({
          tick: 0,
          source: 'regime',
          templateId: e.headline,
          query: { kind: 'real', scope: 'market', direction: 'neutral' },
          target: e.regime.lobby ? { scope: 'sector', sector: e.regime.lobby.sector } : { scope: 'market' },
          logReturn: 0,
          carry: true,
        });
      }

      // SEC.
      const list = [...players.values()].map((p) => {
        const portfolio = trading.portfolio(p.id);
        return {
          playerId: p.id,
          name: p.name,
          heat: p.heat,
          netWorth: portfolio?.equity ?? 0,
          sources: p.sources,
          ...(p.jailedUntil === undefined ? {} : { jailedUntil: p.jailedUntil }),
          eliminated: portfolio?.eliminated === true,
        };
      });
      const sec = resolveSec(deps.secRng, config, list, nextTradingDay);
      const out: SimEventOf<'moment'>[] = [];
      for (const outcome of sec.outcomes) {
        const p = players.get(outcome.playerId)!;
        p.heat = outcome.heatAfter;
        p.fines = outcome.fine;
        if (outcome.caught) {
          trading.charge(p.id, outcome.fine);
          p.jailedUntil = outcome.jailedUntil;
          p.jailDays += outcome.jailDays;
          // The richest player behind bars is a projector moment.
          if (outcome.rank === 0) out.push(...moment('arrest', outcome.arrest!.text));
        }
      }
      for (const p of players.values()) {
        p.sources = {};
        p.manipulated = new Set();
        p.heated = new Set();
      }
      const quarterReveals = reveals;
      reveals = [];
      void quarter;
      return { arrests: sec.arrests, reveals: quarterReveals, moments: out };
    },

    startQuarter() {
      for (const p of players.values()) {
        p.spend = 0;
        p.fines = 0;
      }
    },

    activeRegimeNames: () => regimes.active.map((r) => r.regime.name),
    ledger(id) {
      const p = players.get(id);
      return { spend: p?.spend ?? 0, fines: p?.fines ?? 0, jailDays: p?.jailDays ?? 0 };
    },
  };
}
