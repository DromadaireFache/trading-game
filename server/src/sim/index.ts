/**
 * Pure sim entry point. The game server and the balance harness both import from here
 * (`@tg/server/sim` from other workspaces).
 *
 * Milestone 1: the phase state machine and the lobby roster.
 *   Each quarter starts with BRIEFING and ends with SHOP, except the last, which goes from TRADING to FINAL.
 * Milestone 2: the market (./universe.ts, ./market.ts). The universe is generated from the seed
 *   when the sim is created; prices step once per tick() while the phase is TRADING and are frozen
 *   otherwise, so every quarter has exactly daysPerQuarter candles and days count on across quarters.
 * Later milestones hang portfolios, headlines, cards and SEC off the same tick().
 * See ./types.ts for the contract and the purity rules.
 *
 * Tick accounting: without Ready Up, a phase of N ticks whose `phase` event is returned by tick() call T ends on
 * call T + N, which returns the next `phase` event. The tick that processes `start` only enters
 * BRIEFING; it does not consume a BRIEFING tick. The N tick() calls after the one that announced
 * TRADING each step the market once; the last of them returns `tick`, `candle`, then the earnings
 * `phase` event, in that order.
 *
 * RNG streams: forked from the root in a FIXED order (universe, market, then later subsystems at
 * the end), so adding a subsystem never changes the universe or the price path of a seed.
 */
import { canReadyUp, msToTicks, quarterRamp } from '@tg/shared';
import type { GameConfig, NetWorthSample, Phase, PlayerId } from '@tg/shared';
import { createMarket } from './market.ts';
import { nextPhase, phaseLength } from './phases.ts';
import { createCardEngine } from './cardEngine.ts';
import { DEFAULT_CATALOG } from './data/cardData.ts';
import { DEFAULT_HEADLINES, DEFAULT_PLACEHOLDERS } from './data/headlineData.ts';
import { createHeadlineBook } from './headlines.ts';
import { createNews } from './news.ts';
import { createRng } from './rng.ts';
import { addReturns } from './shocks.ts';
import { createResults } from './results.ts';
import { createTrading } from './trading.ts';
import type { FinalExtra } from './results.ts';
import type { Sim, SimEvent, SimEventOf, SimIntent, SimOptions, SimPlayer, SimRejectCode, SimState } from './types.ts';
import { generateUniverse } from './universe.ts';

export * from './types.ts';
export { createRng } from './rng.ts';
export type { Rng } from './rng.ts';
export { isQuarterPhase, nextPhase, phaseLength } from './phases.ts';
export type { PhasePosition } from './phases.ts';
export { generateUniverse, toUniverseInfo } from './universe.ts';
export type { GenerateUniverse, Universe } from './universe.ts';
export { createMarket } from './market.ts';
export type { CreateMarket, Market, MarketEvent, MarketStepInput } from './market.ts';
export { createTrading } from './trading.ts';
export type { Account, Holding, OrderResult, Trading, TradingDeps, TradingEvent } from './trading.ts';
export { createHeadlineBook, fillHeadline, MAGNITUDES } from './headlines.ts';
export type { FillContext, HeadlineBook, HeadlineQuery, PlaceholderLists } from './headlines.ts';
export { createNews } from './news.ts';
export { createCardEngine } from './cardEngine.ts';
export type { CardEngine, CardEngineDeps, CardResult, QuarterClose } from './cardEngine.ts';
export type { HeadlineEvent, News, NewsDeps, NewsItem, NewsSource, PublishedHeadline } from './news.ts';
export { createResults, formatMoney, recapTargetName } from './results.ts';
export type { FinalExtra, QuarterExtra, Results, ResultsDeps } from './results.ts';

export function createSim(seed: number, config: GameConfig, options: SimOptions = {}): Sim {
  // One child stream per subsystem, forked in a fixed order. Append new forks at the END.
  const rng = createRng(seed);
  const universe = generateUniverse(rng.fork(), config);
  // The market's own stream keeps its place; the market is built below, once the dynamics stream
  // (forked last, so older streams are unchanged) exists.
  const marketRng = rng.fork();
  const advBySymbol = new Map<string, number>([
    ...universe.companies.map((c) => [c.symbol, c.adv] as const),
    ...universe.funds.map((f) => [f.symbol, f.adv] as const),
  ]);
  /**
   * Prices that value accounts after the game. The last earnings gap has no market step left to land
   * on (prices only move in TRADING), so at FINAL it is applied here instead: companies at
   * price * exp(gap), funds scaled by how much their basket moved. Null until FINAL.
   */
  let finalMarks: Map<string, number> | null = null;
  const markOf = (symbol: string) => finalMarks?.get(symbol) ?? market.getPrice(symbol);
  const trading = createTrading({
    config,
    priceOf: markOf,
    advOf: (symbol) => advBySymbol.get(symbol),
    now: () => market.getDay() + market.getTickOfDay() / config.time.ticksPerCandle,
  });
  // Keep existing streams in their original order and append new ones.
  const newsRng = rng.fork();
  const earningsRng = rng.fork();
  const shopRng = rng.fork();
  const secRng = rng.fork();
  const regimeRng = rng.fork();
  const earningsLeadRng = rng.fork();
  const earningsOrderRng = rng.fork();
  // Market realism (volatility clustering, jumps) and the market's reaction to news.
  const dynamicsRng = rng.fork();
  const reactionRng = rng.fork();
  // Appended last: every stream above keeps its draws (same seed, same game as before).
  const mayhemRng = rng.fork();
  const market = createMarket(universe, marketRng, config, dynamicsRng);
  const news = createNews({
    config,
    universe,
    book: createHeadlineBook(options.headlines ?? DEFAULT_HEADLINES, newsRng),
    lists: options.placeholders ?? DEFAULT_PLACEHOLDERS,
    rng: newsRng,
    earningsRng,
    earningsLeadRng,
    earningsOrderRng,
    reactionRng,
  });
  // Milestone 6: leaderboard, statements, recap, awards, projector moments. No randomness.
  const results = createResults({
    config,
    universe,
    priceOf: markOf,
    players: () => players,
    equityOf: (id) => trading.portfolio(id)?.equity ?? 0,
    positionsOf: (id) => trading.portfolio(id)?.positions ?? [],
    eliminatedOf: (id) => trading.getAccount(id)?.eliminated ?? false,
  });
  const tpc = config.time.ticksPerCandle;
  /** Market tick of the step about to be made (shocks.ts / news.ts time). */
  const marketTick = () => market.getDay() * tpc + market.getTickOfDay();
  const cards = createCardEngine({
    config,
    universe,
    catalog: options.catalog ?? DEFAULT_CATALOG,
    news,
    trading,
    shopRng,
    secRng,
    regimeRng,
    marketTick,
    quarterEndTick: () => quarter * config.time.daysPerQuarter * tpc - 1,
    mayhemRng,
  });
  const portfolioOf = (id: string) => {
    const p = trading.portfolio(id);
    return p === undefined ? undefined : cards.decorate(p);
  };

  const queue: SimIntent[] = [];
  /** Orders of jailed players, released at tick `due`. */
  const delayed: { due: number; intent: Extract<SimIntent, { kind: 'order' }> }[] = [];
  const players: SimPlayer[] = [];
  const netWorthHistory: NetWorthSample[] = [];
  const readyPlayers = new Set<PlayerId>();
  let debugMode = false;
  let phase: Phase = 'LOBBY';
  let quarter = 0;
  let tick = 0;
  let phaseTick = 0;
  let announced = false;

  let events: SimEvent[] = [];

  function recordNetWorth(): void {
    const tick = marketTick();
    const equity = Object.fromEntries(players.map(({ id }) => [id, trading.portfolio(id)!.equity]));
    const existing = netWorthHistory[tick];
    if (existing && players.every(({ id }) => existing.equity[id] === equity[id])) return;
    netWorthHistory[tick] = { tick, equity };
  }

  function pendingOrder(playerId: PlayerId): SimEventOf<'pending_order'> {
    const pending = delayed.find((entry) => entry.intent.playerId === playerId);
    return { e: 'pending_order', playerId, order: pending ? {
      symbol: pending.intent.symbol, qty: pending.intent.qty,
      remainingMs: Math.max(0, pending.due - tick) * config.time.tickMs,
    } : null };
  }

  /** `ended`: the game was ended by a player (end_game), so a cut-short quarter reports no earnings. */
  function enter(next: { phase: Phase; quarter: number }, ended = false): void {
    const previousPhase = phase;
    if (phase === 'TRADING' && next.phase !== 'TRADING') {
      for (const entry of delayed.splice(0)) {
        events.push({ e: 'pending_order', playerId: entry.intent.playerId, order: null, cancelled: true });
      }
    }
    phase = next.phase;
    quarter = next.quarter;
    phaseTick = 0;
    readyPlayers.clear();
    events.push({ e: 'phase', phase, quarter, durationTicks: phaseLength(config, phase) });
    if (phase === 'BRIEFING') {
      cards.startQuarter();
      results.startQuarter(quarter);
      const briefing = news.startQuarter(quarter, marketTick(), market.getRate());
      briefing.regimes = cards.activeRegimeNames();
      events.push({ e: 'briefing', ...briefing });
    }
    // The close of TRADING: the quarter's earnings come out before its results.
    if (previousPhase === 'TRADING' && !ended) {
      const reports = news.closeQuarter();
      results.recordEarnings(reports);
      events.push({ e: 'earnings', quarter, reports });
    }
    if (phase === 'RESULTS' || phase === 'FINAL') finishQuarter(phase === 'FINAL', previousPhase);
    if (phase === 'SHOP') events.push(...cards.openShop(quarter));
  }

  function marksAfterLastGap(): Map<string, number> | null {
    const gap = news.pendingGap();
    if (gap === null) return null;
    const floor = config.market.priceFloor;
    const marks = new Map<string, number>();
    for (const c of universe.companies) {
      const price = market.getPrice(c.symbol)!;
      marks.set(c.symbol, Math.max(floor, price * Math.exp(gap[c.symbol] ?? 0)));
    }
    for (const f of universe.funds) {
      let before = 0;
      let after = 0;
      f.members.forEach((m, i) => {
        before += f.units[i]! * market.getPrice(m)!;
        after += f.units[i]! * marks.get(m)!;
      });
      const price = market.getPrice(f.symbol)!;
      marks.set(f.symbol, Math.max(floor, before > 0 ? (price * after) / before : price));
    }
    return marks;
  }

  /** What the cards / SEC side adds to a results event (QuarterExtra of ./results.ts). */
  function cardExtra(nextTradingDay: number): FinalExtra {
    const fines: Record<string, number> = {};
    const cardSpend: Record<string, number> = {};
    const jailed: Record<string, boolean> = {};
    const jailDays: Record<string, number> = {};
    for (const p of players) {
      const ledger = cards.ledger(p.id);
      fines[p.id] = ledger.fines;
      cardSpend[p.id] = ledger.spend;
      jailDays[p.id] = ledger.jailDays;
      jailed[p.id] = cards.isJailed(p.id, nextTradingDay);
    }
    const cardNames: Record<string, string> = {};
    for (const h of news.log()) if (h.cardName !== undefined) cardNames[h.id] = h.cardName;
    return { fines, cardSpend, jailed, jailDays, cardNames };
  }

  /** Close every quarter for fines, trade awards and the recap. Publish the appropriate standings. */
  function finishQuarter(final: boolean, previousPhase: Phase): void {
    const nextTradingDay = quarter * config.time.daysPerQuarter;
    const alreadyClosed = previousPhase === 'RESULTS' || previousPhase === 'SHOP';
    const close = alreadyClosed ? null : cards.closeQuarter(quarter, nextTradingDay);
    const extra = { ...cardExtra(nextTradingDay), arrests: close?.arrests ?? results.last()?.arrests ?? [] };
    if (close) {
      const event = results.closeQuarter(quarter, news.log(), extra);
      // Cards that publish no headline (insider tips, earnings peeks) are revealed too.
      event.recap.cardAuthors.push(...close.reveals);
      if (!final) {
        recordNetWorth();
        const openingTick = (quarter - 1) * config.time.daysPerQuarter * tpc;
        event.netWorthHistory = netWorthHistory.slice(openingTick, marketTick() + 1);
        events.push(event);
        for (const m of close.moments) {
          const moment = results.addMoment(m.kind, m.text);
          if (moment !== null) events.push(moment);
        }
      }
    }
    if (final) finalMarks = marksAfterLastGap();
    // Everybody sees their updated portfolio at the close and the marks used in the final standings.
    for (const p of players) events.push(portfolioOf(p.id)!);
    if (final) events.push(results.final(news.log(), extra));
  }

  function reject(intent: SimIntent, code: SimRejectCode, message: string): void {
    events.push({ e: 'reject', playerId: intent.playerId, intent: intent.kind, code, message });
  }

  function hasPlayer(id: string): boolean {
    return players.some((p) => p.id === id);
  }

  /** Returns true when the intent moved the game into a new phase. */
  function process(intent: SimIntent, released = false): boolean {
    switch (intent.kind) {
      case 'add_player': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'players can only join in the lobby'), false;
        if (hasPlayer(intent.playerId)) return reject(intent, 'invalid', 'player already joined'), false;
        if (intent.name.length === 0) return reject(intent, 'invalid', 'name is empty'), false;
        if (players.length >= config.lobby.maxPlayers) return reject(intent, 'game_full', 'the game is full'), false;
        players.push({ id: intent.playerId, name: intent.name });
        trading.addAccount(intent.playerId);
        cards.addPlayer(intent.playerId, intent.name);
        return false;
      }
      case 'remove_player': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'players can only leave in the lobby'), false;
        const index = players.findIndex((p) => p.id === intent.playerId);
        if (index < 0) return reject(intent, 'unknown_player', 'unknown player'), false;
        players.splice(index, 1);
        trading.removeAccount(intent.playerId);
        cards.removePlayer(intent.playerId);
        return false;
      }
      case 'start': {
        if (phase !== 'LOBBY') return reject(intent, 'wrong_phase', 'the game has already started'), false;
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (players.length < config.lobby.minPlayers) {
          return reject(intent, 'not_enough_players', `need at least ${config.lobby.minPlayers} player(s) to start`), false;
        }
        debugMode = intent.debugMode === true;
        enter(nextPhase(config, { phase, quarter }));
        // Everybody learns their starting cash right away.
        for (const p of players) events.push(portfolioOf(p.id)!);
        return true;
      }
      case 'end_game':
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (phase === 'LOBBY' || phase === 'FINAL') return reject(intent, 'wrong_phase', 'there is no active game to end'), false;
        enter({ phase: 'FINAL', quarter }, true);
        return true;
      case 'order': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (phase !== 'TRADING') return reject(intent, 'wrong_phase', 'the market is closed'), false;
        // Mayhem: a Freeze refuses every order, a HODL every order that shrinks a position.
        if (cards.isFrozen(intent.playerId)) return reject(intent, 'frozen', 'You are frozen: no trading until it thaws.'), false;
        const held = trading.portfolio(intent.playerId)?.positions.find((pos) => pos.symbol === intent.symbol)?.qty ?? 0;
        if (held !== 0 && Math.sign(intent.qty) === -Math.sign(held) && cards.isHodl(intent.playerId)) {
          return reject(intent, 'hodl', 'HODL: you cannot sell or cash out until it wears off.'), false;
        }
        if (!released && delayed.some((entry) => entry.intent.playerId === intent.playerId)) {
          reject(intent, 'jailed', 'Your previous jail order is still pending.');
          events.push(pendingOrder(intent.playerId));
          return false;
        }
        // Jail: the order goes through, but only sec.jailOrderDelayMs later (at that moment's price).
        if (!released && cards.isJailed(intent.playerId, market.getDay())) {
          delayed.push({ due: tick + msToTicks(config, config.sec.jailOrderDelayMs), intent });
          events.push(pendingOrder(intent.playerId));
          return false;
        }
        // Quick bet: the day in progress counts as its first day; it never outlives the quarter.
        const closeAtDay =
          intent.holdDays === undefined
            ? undefined
            : Math.min(market.getDay() + intent.holdDays - 1, quarter * config.time.daysPerQuarter - 1);
        const result = trading.order(intent.playerId, intent.symbol, intent.qty, closeAtDay);
        if (!result.ok) return reject(intent, result.code, result.message), false;
        cards.onOrder(intent.playerId, intent.symbol);
        for (const event of result.events) {
          if (event.e === 'fill') {
            if (intent.requestId !== undefined) event.requestId = intent.requestId;
            results.recordFill(event);
          }
          events.push(event);
        }
        if (!released) events.push(pendingOrder(intent.playerId));
        return false;
      }
      case 'buy_card': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (phase !== 'SHOP') return reject(intent, 'wrong_phase', 'cards can only be bought in the SHOP phase'), false;
        const result = cards.buy(intent.playerId, intent.offerId);
        if (!result.ok) return reject(intent, result.code, result.message), false;
        for (const event of result.events) events.push(event);
        return false;
      }
      case 'ready_up': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (intent.phase !== phase || intent.quarter !== quarter || !canReadyUp(phase, debugMode)) {
          return reject(intent, 'wrong_phase', 'you cannot ready up for that phase right now'), false;
        }
        if (readyPlayers.has(intent.playerId)) return false;
        readyPlayers.add(intent.playerId);
        events.push({ e: 'phase_ready', readyPlayerIds: [...readyPlayers] });
        return false;
      }
      case 'play_card': {
        if (!hasPlayer(intent.playerId)) return reject(intent, 'unknown_player', 'unknown player'), false;
        if (phase !== 'TRADING') return reject(intent, 'wrong_phase', 'cards can only be played while the market is open'), false;
        if (trading.portfolio(intent.playerId)?.eliminated) return reject(intent, 'eliminated', 'you have been eliminated'), false;
        const result = cards.play(intent.playerId, intent.cardId, intent.target, intent.direction, quarter);
        if (!result.ok) return reject(intent, result.code, result.message), false;
        for (const event of result.events) {
          if (event.e === 'fill') results.recordFill(event);
          events.push(event);
        }
        return false;
      }
    }
  }

  function stepTrading(publishTick: boolean): void {
    const impact = trading.stepInput();
    for (const event of cards.beforeStep(marketTick())) events.push(event); // insider previews first
    const headlines = news.beforeStep(marketTick(), market.getRate());
    for (const event of headlines.events) events.push(event);
    const symbolReturn = impact && headlines.symbolReturn ? addReturns(impact, headlines.symbolReturn) : (impact ?? headlines.symbolReturn);
    const { dRate: regimeDRate = 0, ...regimeInput } = cards.marketInput();
    const dRate = headlines.dRate + regimeDRate;
    // Volatility climbs each quarter (config.progression) on top of whatever the regimes do.
    const volMult = (regimeInput.volMult ?? 1) * quarterRamp(config, quarter, config.progression.volLastQuarter);
    const input = {
      ...regimeInput,
      volMult,
      ...(symbolReturn === undefined ? {} : { symbolReturn }),
      ...(dRate === 0 ? {} : { dRate }),
    };
    let dayClosed = false;
    let moment: SimEventOf<'moment'> | null = null;
    for (const event of market.step(input)) {
      if (event.e === 'candle') {
        dayClosed = true;
        const close: Record<string, number> = {};
        for (const [symbol, c] of Object.entries(event.ohlc)) close[symbol] = c.c;
        moment = results.onCandle(event.day, close);
      }
      if (event.e !== 'tick' || publishTick) events.push(event);
    }
    for (const event of trading.afterStep(dayClosed)) {
      if (event.e === 'fill') results.recordFill(event);
      events.push(event);
    }
    recordNetWorth();
    if (moment) events.push(moment);
  }

  return {
    seed,
    config,
    submit(intent) {
      queue.push(intent);
    },
    tick() {
      events = [];
      if (!announced) {
        announced = true;
        events.push({ e: 'phase', phase, quarter, durationTicks: phaseLength(config, phase) });
      }

      // 1. jailed players' orders that are due, then intents in arrival order
      let enteredByIntent = false;
      for (let i = 0; i < delayed.length; ) {
        if (delayed[i]!.due > tick) {
          i++;
          continue;
        }
        const entry = delayed.splice(i, 1)[0]!;
        process(entry.intent, true);
        events.push(pendingOrder(entry.intent.playerId));
      }
      for (const intent of queue.splice(0)) {
        if (process(intent)) enteredByIntent = true;
      }

      // 2. clock (does not run in LOBBY and FINAL)
      const length = phaseLength(config, phase);
      if (length !== null && !enteredByIntent) {
        const readyToAdvance = canReadyUp(phase, debugMode) && readyPlayers.size >= (debugMode ? 1 : players.length);
        if (phase === 'TRADING') {
          // Skipping Trading in debug mode runs the remaining market steps at once. Candles carry the full history
          // and closing quotes to clients without a burst of intraday price messages.
          const steps = readyToAdvance ? length - phaseTick : 1;
          for (let i = 0; i < steps; i++) stepTrading(!readyToAdvance);
          phaseTick += steps;
        } else {
          phaseTick += 1;
        }
        if (phaseTick >= length || readyToAdvance) {
          enter(nextPhase(config, { phase, quarter }));
        }
      }

      // Between trading days, card purchases and quarter settlement can change the latest point.
      if (phase !== 'TRADING' && events.some((event) => event.e === 'portfolio')) recordNetWorth();
      tick += 1;
      // Every portfolio carries the player's hand, heat and jail.
      return events.map((e) => (e.e === 'portfolio' ? cards.decorate(e) : e));
    },
    getPendingOrder: pendingOrder,
    getState(): SimState {
      const length = phaseLength(config, phase);
      return {
        phase,
        debugMode,
        quarter,
        tick,
        phaseTick,
        phaseTicks: length,
        ticksLeft: length === null ? null : length - phaseTick,
        players: players.map((p) => ({ ...p })),
      };
    },
    getUniverse: () => universe,
    getMarketSnapshot: () => market.getSnapshot(),
    getNetWorth: (fromTick = 0) => netWorthHistory.slice(fromTick),
    getPortfolio: (playerId) => portfolioOf(playerId),
    getShop: (playerId) => (phase === 'SHOP' ? cards.offersOf(playerId) : null),
    getPhaseReady: () => (canReadyUp(phase, debugMode) ? { e: 'phase_ready', readyPlayerIds: [...readyPlayers] } : null),
    getResults: () => results.last(),
    cards,
    getNewsSnapshot() {
      const briefing = news.briefing();
      const earnings = news.earnings();
      return {
        briefing: briefing === null ? null : ({ e: 'briefing', ...briefing } as SimEventOf<'briefing'>),
        earnings: earnings === null ? null : { e: 'earnings', ...earnings },
        headlines: news.recent(config.news.replayHeadlines),
      };
    },
    news,
  };
}
