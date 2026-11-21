/**
 * Bot strategies for the balance harness. Deliberately simple: they stand for kinds of players
 * (cautious, levered, trend-chasing, reckless, bearish) plus one that probes a known exploit.
 * Every bot trades at most once per trading day (at tickOfDay 1) unless noted, like a human would.
 */
import type { SymbolId } from '@tg/shared';
import type { Bot, BotFactory, BotView, OrderIntent } from './harness.ts';
import { closeOthers, sharesToTarget } from './harness.ts';
import { eventPlayer, insiderTrader, manipulator } from './cardBots.ts';

const indexFund = (view: BotView): SymbolId => view.universe.funds.find((f) => f.kind === 'index')!.symbol;
const firstTickOfDay = (view: BotView): boolean => view.tickOfDay === 1;

/** Target notional = leverage * equity in one symbol, closing everything else. */
function allIn(view: BotView, symbol: SymbolId, leverage: number): OrderIntent[] {
  const orders = closeOthers(view, symbol);
  const qty = sharesToTarget(view, symbol, leverage * view.portfolio.equity);
  // Re-sizing by less than 5% is not worth the slippage.
  const held = view.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  if (qty !== 0 && Math.abs(qty) > 0.05 * Math.max(1, Math.abs(held))) orders.push({ symbol, qty });
  return orders;
}

/** Buys the index fund once and holds it. */
export const holdIndex: BotFactory = () => ({
  name: 'hold-index',
  decide: (view) => (view.portfolio.positions.length === 0 && firstTickOfDay(view) ? allIn(view, indexFund(view), 1) : []),
});

/** Keeps the index fund at the leverage cap (rebalanced daily). */
export const leveredIndex: BotFactory = () => ({
  name: 'levered-index',
  decide: (view) => (firstTickOfDay(view) ? allIn(view, indexFund(view), view.config.trading.leverageCap) : []),
});

/** Each day, holds the sector fund with the best 5-day return, at 2x. */
export const momentum: BotFactory = () => {
  const closes = new Map<SymbolId, number[]>();
  return {
    name: 'momentum',
    decide(view) {
      if (!firstTickOfDay(view)) return [];
      const funds = view.universe.funds.filter((f) => f.kind === 'sector');
      for (const f of funds) {
        const list = closes.get(f.symbol) ?? [];
        list.push(view.prices[f.symbol]!);
        closes.set(f.symbol, list.slice(-6));
      }
      const ready = funds.filter((f) => closes.get(f.symbol)!.length === 6);
      if (ready.length === 0) return [];
      const score = (s: SymbolId) => {
        const l = closes.get(s)!;
        return l[l.length - 1]! / l[0]!;
      };
      const best = ready.reduce((a, b) => (score(b.symbol) > score(a.symbol) ? b : a));
      return allIn(view, best.symbol, 2);
    },
  };
};

/** Each quarter, bets the cap on one random stock, long or short, and rides it. */
export const yolo: BotFactory = (rng) => {
  let quarter = -1;
  let pick: { symbol: SymbolId; side: number } | undefined;
  return {
    name: 'yolo',
    decide(view) {
      if (view.quarter !== quarter) {
        quarter = view.quarter;
        const companies = view.universe.companies;
        pick = { symbol: companies[rng.int(companies.length)]!.symbol, side: rng.next() < 0.5 ? -1 : 1 };
        return allIn(view, pick.symbol, pick.side * view.config.trading.leverageCap);
      }
      return [];
    },
  };
};

/** Short the index at 1x the whole game. */
export const shortIndex: BotFactory = () => ({
  name: 'short-index',
  decide: (view) => (view.portfolio.positions.length === 0 && firstTickOfDay(view) ? allIn(view, indexFund(view), -1) : []),
});

/**
 * Exploit probe: plays levered-index, then on the very last trading step of the game moves
 * everything into the thinnest stock at the cap. Its own price impact is still in the mark when the
 * game ends. Compare its result with levered-index.
 */
export const lastTickPump: BotFactory = () => {
  const base = leveredIndex(undefined as never);
  return {
    name: 'last-tick-pump',
    decide(view) {
      const lastStep = view.quarter === view.config.time.quarters && view.ticksLeft === 1;
      if (!lastStep) return base.decide(view);
      const thinnest = [...view.universe.companies].sort((a, b) => a.adv - b.adv)[0]!.symbol;
      const orders = closeOthers(view, thinnest);
      orders.push({ symbol: thinnest, qty: sharesToTarget(view, thinnest, 1e15) });
      return orders;
    },
  };
};

/**
 * A fast, news-reading human: sees a headline appear, takes `reactionMs` to read it, reads the
 * direction off the first part of the move (a human reads it off the text), goes all in on the target
 * at the leverage cap (the stock, the sector fund, or the index fund), and gets out once the shock has
 * settled. One trade at a time; headlines during a trade are ignored. Neutral headlines do not move
 * the price, so they are skipped.
 */
export function newsTrader(reactionMs = 1_000, name = 'news-trader'): BotFactory {
  return () => {
    let now = 0;
    let watching: { symbol: SymbolId; price: number; at: number } | undefined;
    let exitAt: number | undefined;
    return {
      name,
      decide(view) {
        now += 1;
        const tickMs = view.config.time.tickMs;
        const reaction = Math.max(1, Math.round(reactionMs / tickMs));
        const settle = 2 * Math.round(view.config.news.rampMs / tickMs);

        if (exitAt !== undefined) {
          if (now < exitAt && view.ticksLeft > 1) return [];
          exitAt = undefined;
          return closeOthers(view, undefined);
        }
        if (watching === undefined) {
          const h = view.headlines[0];
          if (h === undefined) return [];
          const symbol = h.symbol ?? (h.sector ? view.universe.funds.find((f) => f.sector === h.sector)!.symbol : indexFund(view));
          watching = { symbol, price: view.prices[symbol]!, at: now };
          return [];
        }
        if (now - watching.at < reaction) return [];
        const move = Math.log(view.prices[watching.symbol]! / watching.price);
        const symbol = watching.symbol;
        watching = undefined;
        // Smaller than a tick of noise: a neutral headline.
        if (Math.abs(move) < 0.002) return [];
        exitAt = now + Math.max(1, settle - reaction);
        return allIn(view, symbol, Math.sign(move) * view.config.trading.leverageCap);
      },
    };
  };
}

export const DEFAULT_BOTS: readonly BotFactory[] = [holdIndex, leveredIndex, momentum, yolo, shortIndex, lastTickPump, newsTrader()];

/** Every bot, the card users included (run.ts --bots picks from these). */
export const ALL_BOTS: readonly BotFactory[] = [...DEFAULT_BOTS, insiderTrader(), manipulator(), eventPlayer()];

export function botByName(name: string): BotFactory | undefined {
  return ALL_BOTS.find((f) => f(undefined as never).name === name);
}

export type { Bot };
