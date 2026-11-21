/**
 * Balance harness (M7): plays whole games headless through createSim with simple bot players, so the
 * economy can be tuned toward DESIGN's target of a median winner of $1B-3B.
 *
 * Everything is deterministic: same seeds + config + bots => same report. Bots submit orders, and
 * (since M5) can buy cards in SHOP and play them in TRADING. Headlines, earnings, cards, regimes and
 * the SEC all run inside the sim.
 *
 * Timing: the sim processes intents queued before tick() at the start of that tick, before the market
 * step. So a bot that sees `ticksLeft === 1` in TRADING trades on the last step of the quarter.
 * Bots are asked every tick of TRADING and SHOP; the harness only submits orders and plays in TRADING
 * and buys in SHOP, so a bot never gets rejected for the phase.
 */
import { mergeConfig } from '@tg/shared';
import type { Card, CardDirection, CardOffer, GameConfig, Phase, PlayerId, SymbolId } from '@tg/shared';
import { createRng, createSim } from '@tg/server/sim';
import type { NewsItem, Rng, SimEventOf, Universe } from '@tg/server/sim';

export type Portfolio = SimEventOf<'portfolio'>;
export type Headline = SimEventOf<'headline'>;

export interface BotView {
  config: GameConfig;
  universe: Universe;
  phase: Phase;
  quarter: number;
  /** Market day (continues across quarters) and tick within it, of the last market step. */
  day: number;
  tickOfDay: number;
  /** Ticks left in the current phase. */
  ticksLeft: number;
  /** Market tick (day * ticksPerCandle + tickOfDay) of the last step: shocks.ts / news.ts time. */
  marketTick: number;
  prices: Record<SymbolId, number>;
  portfolio: Portfolio;
  /** Public headlines published on the last tick (what every player saw appear in the feed). */
  headlines: Headline[];
  /** Headlines on the last tick meant for this player alone: insider previews, mole notes. */
  privateHeadlines: Headline[];
  /** This quarter's shop offers, priced for this player (SHOP only, else empty). */
  offers: CardOffer[];
  hand: Card[];
  heat: number;
  jailed: boolean;
  /**
   * "Reading" a headline: the news items not published yet. A bot that got an insider preview finds the
   * item behind it here (its target, direction and size are what a human reads off the words).
   */
  upcoming(): readonly NewsItem[];
}

export interface OrderIntent {
  symbol: SymbolId;
  qty: number;
}
export interface BuyIntent {
  buy: string;
}
export interface PlayIntent {
  play: string;
  target?: string;
  direction?: CardDirection;
}
export type BotIntent = OrderIntent | BuyIntent | PlayIntent;

export interface Bot {
  name: string;
  /** Asked during SHOP too (card buyers). Others are only asked in TRADING. */
  shops?: boolean;
  /** Called once per TRADING tick (and SHOP tick if `shops`). Orders and plays count in TRADING, buys in SHOP. */
  decide(view: BotView): BotIntent[];
}

export type BotFactory = (rng: Rng) => Bot;

export interface BotResult {
  name: string;
  netWorth: number;
  eliminated: boolean;
  marginCalls: number;
  orders: number;
  rejects: number;
  cardsBought: number;
  cardsPlayed: number;
  cardSpend: number;
  fines: number;
  arrests: number;
  jailDays: number;
  heat: number;
}

export interface GameResult {
  seed: number;
  bots: BotResult[];
  winner: BotResult;
}

/** Shares to trade to get from the current position to `targetNotional` dollars (signed) of a symbol. */
export function sharesToTarget(view: BotView, symbol: SymbolId, targetNotional: number): number {
  const price = view.prices[symbol];
  if (!(price! > 0)) return 0;
  const held = view.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  return Math.trunc(targetNotional / price!) - held;
}

/** Orders that close every position except `keep`. */
export function closeOthers(view: BotView, keep: SymbolId | undefined): OrderIntent[] {
  return view.portfolio.positions.filter((p) => p.symbol !== keep && p.qty !== 0).map((p) => ({ symbol: p.symbol, qty: -p.qty }));
}

const isOrder = (i: BotIntent): i is OrderIntent => 'symbol' in i;
const isBuy = (i: BotIntent): i is BuyIntent => 'buy' in i;

/** Plays one full game with one player per bot. */
export function playGame(seed: number, baseConfig: GameConfig, factories: readonly BotFactory[]): GameResult {
  const config = mergeConfig(baseConfig, { lobby: { maxPlayers: Math.max(baseConfig.lobby.maxPlayers, factories.length) } });
  const sim = createSim(seed, config);
  const universe = sim.getUniverse();
  // Every bot gets its own stream, so two bots of the same strategy still differ.
  const bots = factories.map((make, i) => make(createRng((seed * 7919 + i * 104729) >>> 0)));
  const ids: PlayerId[] = bots.map((_, i) => `bot${i}`);
  const stats = new Map<PlayerId, BotResult>(
    bots.map((b, i) => [
      ids[i]!,
      { name: b.name, netWorth: 0, eliminated: false, marginCalls: 0, orders: 0, rejects: 0, cardsBought: 0, cardsPlayed: 0, cardSpend: 0, fines: 0, arrests: 0, jailDays: 0, heat: 0 },
    ]),
  );
  const offers = new Map<PlayerId, CardOffer[]>();
  /** Prices of buys sent but not confirmed, per player (a rejected buy refunds the oldest). The engine's
   *  ledger only keeps this quarter's spend, so the harness adds up the whole game itself. */
  const pendingBuys = new Map<PlayerId, number[]>();
  const spend = new Map<PlayerId, number>();
  /** Who submits first changes every tick: with a fixed order, identical strategies always see the
   *  first one get the better fill and the second eat its impact. Seeded, so runs stay reproducible. */
  const orderRng = createRng((seed * 2654435761) >>> 0);
  const order = bots.map((_, i) => i);

  ids.forEach((id, i) => sim.submit({ kind: 'add_player', playerId: id, name: bots[i]!.name }));
  sim.submit({ kind: 'start', playerId: ids[0]! });

  let prices: Record<SymbolId, number> = sim.getMarketSnapshot().prices;
  let day = 0;
  let tickOfDay = 0;
  let headlines: Headline[] = [];
  const privateHeadlines = new Map<PlayerId, Headline[]>();
  const tpc = config.time.ticksPerCandle;
  const upcoming = () => sim.news.upcoming();
  const maxTicks = 10_000_000;
  for (let n = 0; n < maxTicks; n++) {
    headlines = [];
    privateHeadlines.clear();
    for (const event of sim.tick()) {
      if (event.e === 'headline') {
        if (event.to === undefined) headlines.push(event);
        else privateHeadlines.set(event.to, [...(privateHeadlines.get(event.to) ?? []), event]);
      } else if (event.e === 'tick') {
        prices = event.prices;
        day = event.day;
        tickOfDay = event.tickOfDay;
      } else if (event.e === 'fill' && event.reason === 'margin_call') {
        stats.get(event.playerId)!.marginCalls++;
      } else if (event.e === 'reject') {
        const s = stats.get(event.playerId);
        if (s) {
          s.rejects++;
          if (event.intent === 'play_card') s.cardsPlayed--;
          if (event.intent === 'buy_card') {
            s.cardsBought--;
            pendingBuys.get(event.playerId)?.shift();
          }
        }
      } else if (event.e === 'shop') {
        offers.set(event.playerId, event.offers);
      } else if (event.e === 'phase' && event.phase !== 'SHOP') {
        offers.clear();
      } else if (event.e === 'results') {
        for (const a of event.arrests) {
          const s = stats.get(a.playerId);
          if (s) {
            s.arrests++;
            s.fines += a.fine;
          }
        }
      }
    }
    // Buys sent last tick that were not rejected went through.
    for (const [id, prices] of pendingBuys) {
      for (const price of prices) spend.set(id, (spend.get(id) ?? 0) + price);
      prices.length = 0;
    }
    const state = sim.getState();
    if (state.phase === 'FINAL') break;
    if (state.phase !== 'TRADING' && state.phase !== 'SHOP') continue;
    const trading = state.phase === 'TRADING';
    for (let k = order.length - 1; k > 0; k--) {
      const j = orderRng.int(k + 1);
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    for (const i of order) {
      const bot = bots[i]!;
      const id = ids[i]!;
      if (!trading && !bot.shops) continue;
      const portfolio = sim.getPortfolio(id)!;
      if (portfolio.eliminated) continue;
      const view: BotView = {
        config,
        universe,
        phase: state.phase,
        quarter: state.quarter,
        day,
        tickOfDay,
        ticksLeft: state.ticksLeft ?? 0,
        marketTick: day * tpc + tickOfDay,
        prices,
        portfolio,
        headlines,
        privateHeadlines: privateHeadlines.get(id) ?? [],
        offers: offers.get(id) ?? [],
        hand: portfolio.hand ?? [],
        heat: portfolio.heat,
        jailed: portfolio.jailedUntil !== undefined && portfolio.jailedUntil > day,
        upcoming,
      };
      const s = stats.get(id)!;
      for (const intent of bot.decide(view)) {
        if (isOrder(intent)) {
          if (!trading || !Number.isFinite(intent.qty) || Math.trunc(intent.qty) === 0) continue;
          sim.submit({ kind: 'order', playerId: id, symbol: intent.symbol, qty: intent.qty });
          s.orders++;
        } else if (isBuy(intent)) {
          if (trading) continue;
          sim.submit({ kind: 'buy_card', playerId: id, offerId: intent.buy });
          s.cardsBought++;
          const price = (offers.get(id) ?? []).find((o) => o.offerId === intent.buy)?.price ?? 0;
          pendingBuys.set(id, [...(pendingBuys.get(id) ?? []), price]);
          // An offer can be bought once: drop it so the bot does not ask again next tick.
          offers.set(id, (offers.get(id) ?? []).filter((o) => o.offerId !== intent.buy));
        } else {
          if (!trading) continue;
          sim.submit({ kind: 'play_card', playerId: id, cardId: intent.play, target: intent.target, direction: intent.direction });
          s.cardsPlayed++;
        }
      }
    }
  }
  if (sim.getState().phase !== 'FINAL') throw new Error(`seed ${seed}: game did not reach FINAL`);

  const results = ids.map((id) => {
    const s = stats.get(id)!;
    const p = sim.getPortfolio(id)!;
    const ledger = sim.cards.ledger(id);
    return { ...s, netWorth: p.equity, eliminated: p.eliminated === true, cardSpend: spend.get(id) ?? 0, jailDays: ledger.jailDays, heat: p.heat };
  });
  const winner = results.reduce((best, r) => (r.netWorth > best.netWorth ? r : best));
  return { seed, bots: results, winner };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface BotSummary {
  p10: number;
  median: number;
  p90: number;
  eliminated: number;
  marginCalls: number;
  rejects: number;
  /** Averages per game. */
  cardsBought: number;
  cardsPlayed: number;
  cardSpend: number;
  fines: number;
  arrests: number;
  jailDays: number;
}

export interface Summary {
  games: number;
  startingCash: number;
  winner: { p10: number; median: number; p90: number; byBot: Record<string, number> };
  bots: Record<string, BotSummary>;
}

export function summarize(config: GameConfig, games: readonly GameResult[]): Summary {
  const sortedNw = (values: number[]) => [...values].sort((a, b) => a - b);
  const winners = sortedNw(games.map((g) => g.winner.netWorth));
  const byBot: Record<string, number> = {};
  for (const g of games) byBot[g.winner.name] = (byBot[g.winner.name] ?? 0) + 1;
  const names = [...new Set(games.flatMap((g) => g.bots.map((b) => b.name)))];
  const bots: Summary['bots'] = {};
  for (const name of names) {
    const rows = games.flatMap((g) => g.bots.filter((b) => b.name === name));
    const nw = sortedNw(rows.map((r) => r.netWorth));
    const avg = (f: (r: BotResult) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    bots[name] = {
      p10: quantile(nw, 0.1),
      median: quantile(nw, 0.5),
      p90: quantile(nw, 0.9),
      eliminated: rows.filter((r) => r.eliminated).length / rows.length,
      marginCalls: avg((r) => r.marginCalls),
      rejects: avg((r) => r.rejects),
      cardsBought: avg((r) => r.cardsBought),
      cardsPlayed: avg((r) => r.cardsPlayed),
      cardSpend: avg((r) => r.cardSpend),
      fines: avg((r) => r.fines),
      arrests: avg((r) => r.arrests),
      jailDays: avg((r) => r.jailDays),
    };
  }
  return {
    games: games.length,
    startingCash: config.economy.startingCash,
    winner: { p10: quantile(winners, 0.1), median: quantile(winners, 0.5), p90: quantile(winners, 0.9), byBot },
    bots,
  };
}
