/**
 * Card-using bots for the balance harness (M7 after M5). Each one is the news trader (bots.ts) plus a
 * card habit, so their edge over `news-trader` is what the cards are worth:
 *   insider-trader  insider tips (trades the private preview before the market sees it) and the
 *                   boardroom mole (carries a capped bet through the earnings gap)
 *   manipulator     fake headlines: positions first, plants the story, sells into the overshoot
 *   event-player    event cards (position, then make it happen) and the war / pandemic regimes
 * They buy what they can use whenever the shop offers it and they can afford it, and ignore the SEC:
 * the heat, fines and jail they pay for it are part of what the report measures.
 */
import type { Card, CardDirection, Sector, SymbolId } from '@tg/shared';
import type { CardCatalogEntry, EventShockEffect, FakeHeadlineEffect, RegimeEffect } from '@tg/shared/cards';
import catalogJson from '@tg/shared/data/cards.json';
import type { BotFactory, BotIntent, BotView, Headline, OrderIntent } from './harness.ts';
import { closeOthers, sharesToTarget } from './harness.ts';

const catalog = new Map((catalogJson as CardCatalogEntry[]).map((c) => [c.defId, c]));
const effectOf = (card: Card) => catalog.get(card.card.defId)?.effect;

const indexFund = (view: BotView): SymbolId => view.universe.funds.find((f) => f.kind === 'index')!.symbol;
const sectorFund = (view: BotView, sector: Sector): SymbolId => view.universe.funds.find((f) => f.sector === sector)!.symbol;
const settleTicks = (view: BotView) => 2 * Math.round(view.config.news.rampMs / view.config.time.tickMs);
const rampTicks = (view: BotView) => Math.round(view.config.news.rampMs / view.config.time.tickMs);
/** The most liquid company (cheapest to trade big): manipulators and event players pick it. */
const liquidStock = (view: BotView): SymbolId => [...view.universe.companies].sort((a, b) => b.adv - a.adv)[0]!.symbol;
const liquidSector = (view: BotView): Sector => {
  const funds = view.universe.funds.filter((f) => f.kind === 'sector');
  return funds.sort((a, b) => b.adv - a.adv)[0]!.sector!;
};

/** Everything except `keep` closed, then `leverage` x equity in `symbol` (signed). */
function allIn(view: BotView, symbol: SymbolId, leverage: number): OrderIntent[] {
  const orders = closeOthers(view, symbol);
  const qty = sharesToTarget(view, symbol, leverage * view.portfolio.equity);
  if (qty !== 0) orders.push({ symbol, qty });
  return orders;
}

/** What a headline's target trades as: the stock, its sector fund, or the index fund. */
function tradeableOf(view: BotView, h: { symbol?: string; sector?: Sector }): SymbolId {
  return h.symbol ?? (h.sector ? sectorFund(view, h.sector) : indexFund(view));
}

/** The queued item an insider preview announces: first upcoming item on the same target. */
function itemBehind(view: BotView, h: Headline) {
  return view
    .upcoming()
    .find((item) =>
      h.symbol !== undefined
        ? item.target.scope === 'stock' && item.target.symbol === h.symbol
        : h.sector !== undefined
          ? item.target.scope === 'sector' && item.target.sector === h.sector
          : item.target.scope === 'market',
    );
}

interface Core {
  /** Own tick counter (TRADING ticks only, like market ticks). */
  now: number;
  /** When the current trade is closed; undefined = idle. */
  exitAt: number | undefined;
  watching: { symbol: SymbolId; price: number; at: number } | undefined;
  /** No news trading while a longer bet runs (earnings carry, regime). */
  busyUntilQuarter: number;
}

const newCore = (): Core => ({ now: 0, exitAt: undefined, watching: undefined, busyUntilQuarter: 0 });

/** Shared exit + public-headline trading (same rules as newsTrader in bots.ts). */
function coreStep(view: BotView, core: Core, reactionMs = 1_000): BotIntent[] | null {
  if (core.exitAt !== undefined) {
    if (core.now < core.exitAt && view.ticksLeft > 1) return [];
    core.exitAt = undefined;
    return closeOthers(view, undefined);
  }
  if (core.busyUntilQuarter > view.quarter) return null;
  const reaction = Math.max(1, Math.round(reactionMs / view.config.time.tickMs));
  if (core.watching === undefined) {
    const h = view.headlines[0];
    if (h === undefined) return null;
    const symbol = tradeableOf(view, h);
    core.watching = { symbol, price: view.prices[symbol]!, at: core.now };
    return [];
  }
  if (core.now - core.watching.at < reaction) return [];
  const { symbol, price } = core.watching;
  core.watching = undefined;
  const move = Math.log(view.prices[symbol]! / price);
  if (Math.abs(move) < 0.002) return null;
  core.exitAt = core.now + Math.max(1, settleTicks(view) - reaction);
  return allIn(view, symbol, Math.sign(move) * view.config.trading.leverageCap);
}

/** Buys every offer whose card it can use, cheapest first, while the hand has room and cash allows. */
function shop(view: BotView, wants: (defId: string) => boolean): BotIntent[] {
  if (view.phase !== 'SHOP') return [];
  const room = view.config.cards.handLimit - view.hand.length;
  const out: BotIntent[] = [];
  let budget = view.portfolio.cash;
  for (const o of [...view.offers].sort((a, b) => a.price - b.price)) {
    if (out.length >= room) break;
    if (!wants(o.card.defId) || o.price > budget * 0.5) continue;
    budget -= o.price;
    out.push({ buy: o.offerId });
  }
  return out;
}

export function insiderTrader(name = 'insider-trader'): BotFactory {
  return () => {
    const core = newCore();
    let lastTipAttempt = -Infinity;
    let mole: { symbol: SymbolId; dir: number } | undefined;
    let carrying: { symbol: SymbolId; closeQuarter: number } | undefined;
    return {
      name,
      shops: true,
      decide(view) {
        if (view.phase === 'SHOP') return shop(view, (id) => id === 'insider_tip' || id === 'boardroom_mole');
        if (view.phase !== 'TRADING' || view.jailed) return [];
        core.now += 1;
        const cap = view.config.trading.leverageCap;

        // Close after the latest possible earnings move in the next quarter.
        if (carrying && view.quarter >= carrying.closeQuarter) {
          const { daysPerQuarter, ticksPerCandle, tickMs } = view.config.time;
          const tradingTicks = daysPerQuarter * ticksPerCandle;
          const openTick = (view.quarter - 1) * tradingTicks;
          const latestDelay = Math.min(Math.ceil(view.config.news.leadMaxMs / tickMs), tradingTicks);
          if (view.marketTick < openTick + latestDelay) return [];
          carrying = undefined;
          return closeOthers(view, undefined);
        }

        // Reading private notes: a mole's verdict, or a preview of a headline nobody has seen yet.
        for (const h of view.privateHeadlines) {
          const m = /will (beat|miss) consensus/.exec(h.text);
          if (m && h.symbol) {
            mole = { symbol: h.symbol, dir: m[1] === 'beat' ? 1 : -1 };
            continue;
          }
          const item = itemBehind(view, h);
          if (item && item.logReturn !== 0 && !carrying) {
            const symbol = tradeableOf(view, h);
            core.watching = undefined;
            core.exitAt = core.now + Math.max(1, item.tick - view.marketTick) + settleTicks(view);
            return allIn(view, symbol, Math.sign(item.logReturn) * cap);
          }
        }

        // Late in the quarter with a mole's verdict: carry a capped bet through the earnings gap.
        if (mole && view.ticksLeft <= settleTicks(view) + 5 && !carrying && core.exitAt === undefined) {
          carrying = { symbol: mole.symbol, closeQuarter: view.quarter + 1 };
          const bet = mole;
          mole = undefined;
          return allIn(view, bet.symbol, bet.dir * cap);
        }
        if (carrying) return [];

        const out = coreStep(view, core);
        if (out !== null) return out;

        // Idle: use a card.
        const moleCard = view.hand.find((c) => c.card.defId === 'boardroom_mole');
        if (moleCard && !mole && view.ticksLeft > settleTicks(view) * 4) return [{ play: moleCard.cardId, target: liquidStock(view) }];
        const tip = view.hand.find((c) => effectOf(c)?.kind === 'insider_tip' && c.card.targetKind === 'none');
        if (tip && core.now - lastTipAttempt > 20) {
          lastTipAttempt = core.now;
          return [{ play: tip.cardId }];
        }
        return [];
      },
    };
  };
}

export function manipulator(name = 'manipulator'): BotFactory {
  return (rng) => {
    const core = newCore();
    let planned: { card: Card; target?: string; direction: CardDirection } | undefined;
    return {
      name,
      shops: true,
      decide(view) {
        if (view.phase === 'SHOP') return shop(view, (id) => effectOf({ cardId: '', card: catalog.get(id)! } as Card)?.kind === 'fake_headline');
        if (view.phase !== 'TRADING' || view.jailed) return [];
        core.now += 1;

        // Positioned last tick: now plant the story, and sell into the overshoot (before any debunk).
        if (planned) {
          const p = planned;
          planned = undefined;
          core.exitAt = core.now + rampTicks(view);
          return [{ play: p.card.cardId, ...(p.target ? { target: p.target } : {}), direction: p.direction }];
        }
        const out = coreStep(view, core);
        if (out !== null) return out;

        const card = view.hand.find((c) => effectOf(c)?.kind === 'fake_headline');
        if (!card || view.ticksLeft < settleTicks(view) * 3) return [];
        const fxk = effectOf(card) as FakeHeadlineEffect;
        const direction: CardDirection = rng.next() < 0.5 ? 'up' : 'down';
        let target: string | undefined;
        let symbol: SymbolId;
        if (fxk.scope === 'stock') symbol = target = liquidStock(view);
        else if (fxk.scope === 'sector') {
          target = liquidSector(view);
          symbol = sectorFund(view, target as Sector);
        } else symbol = indexFund(view);
        planned = { card, ...(target ? { target } : {}), direction };
        core.exitAt = undefined;
        return allIn(view, symbol, (direction === 'up' ? 1 : -1) * view.config.trading.leverageCap);
      },
    };
  };
}

export function eventPlayer(name = 'event-player'): BotFactory {
  return () => {
    const core = newCore();
    let planned: { card: Card; target?: string } | undefined;
    return {
      name,
      shops: true,
      decide(view) {
        if (view.phase === 'SHOP') {
          return shop(view, (id) => {
            const kind = catalog.get(id)?.effect.kind;
            return kind === 'event_shock' || id === 'war' || id === 'pandemic';
          });
        }
        if (view.phase !== 'TRADING' || view.jailed) return [];
        core.now += 1;
        const cap = view.config.trading.leverageCap;

        if (planned) {
          const p = planned;
          planned = undefined;
          core.exitAt = core.now + settleTicks(view);
          return [{ play: p.card.cardId, ...(p.target ? { target: p.target } : {}) }];
        }
        const out = coreStep(view, core);
        if (out !== null) return out;
        if (view.ticksLeft < settleTicks(view) * 3) return [];

        // A regime early in the quarter: ride the sector it lifts most, at 2x, for the rest of the quarter.
        const regime = view.hand.find((c) => effectOf(c)?.kind === 'regime');
        if (regime && core.busyUntilQuarter <= view.quarter) {
          const drift = (effectOf(regime) as RegimeEffect).sectorDrift;
          const best = (Object.entries(drift) as [Sector, number][]).sort((a, b) => b[1] - a[1])[0];
          if (best) {
            core.busyUntilQuarter = view.quarter + 1;
            return [...allIn(view, sectorFund(view, best[0]), 2), { play: regime.cardId }];
          }
        }

        const card = view.hand.find((c) => effectOf(c)?.kind === 'event_shock');
        if (!card) return [];
        const fxk = effectOf(card) as EventShockEffect;
        const sign = fxk.direction === 'up' ? 1 : -1;
        let target: string | undefined;
        let symbol: SymbolId;
        if (fxk.scope === 'stock') symbol = target = liquidStock(view);
        else if (fxk.scope === 'sector') {
          target = liquidSector(view);
          symbol = sectorFund(view, target as Sector);
        } else symbol = indexFund(view);
        planned = { card, ...(target ? { target } : {}) };
        return allIn(view, symbol, sign * cap);
      },
    };
  };
}
