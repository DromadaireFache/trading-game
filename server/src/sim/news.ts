/**
 * The news engine (DESIGN.md sections 3 and 5): decides the quarter's shocks, then publishes them as
 * headlines through ONE global queue. Pure; randomness from its own Rng streams.
 *
 * Built on the teammates' number modules, which it does not change:
 *   ./shocks.ts    a move -> per-tick returns (ramp, overshoot, revert)
 *   ./earnings.ts  surprises, leaks and the EARNINGS gap
 *   ./headlines.ts template lookup (no repeats) and slot filling
 *
 * Per quarter, at BRIEFING (startQuarter):
 *   - earnings: drawEarnings -> one leak item per leak (an earnings_leak headline on the company);
 *   - scheduled beats: scheduledBeatsPerQuarter market-wide macro headlines on evenly spaced days,
 *     announced with their day and title (direction hidden). The first one is the rate decision and
 *     also moves the policy rate by +-market.rateStep (kept inside [rateMin, rateMax]);
 *   - random headlines: randomHeadlinesPerQuarter, of which noiseShare are neutral (no move); the rest
 *     draw scope, magnitude and direction from config.news, at a random tick after quietDays;
 *   - filler: a chain of random headlines through the whole trading window, each news.minGapMs to
 *     news.maxGapMs after the previous one, skewed so the quarter (planned headlines included) averages
 *     news.meanGapMs, drawn from news.filler (mostly noise and small moves). Those too close to the
 *     close for a move to settle are noise. So the news never stops for long.
 * Every TRADING tick (beforeStep): publish at most ONE due item, and only when news.minGapMs has
 * passed since the last headline (the global queue; later items wait; a due card or regime item goes
 * before any backlog of engine headlines). Engine news shocks and rate changes start after a seeded
 * news.leadMinMs-leadMaxMs trading-clock delay; a player's own card headline moves the market at once
 * (only its author was ready for it). Then turn all live shocks into this tick's symbolReturn. Items
 * still waiting at the close are dropped.
 * At EARNINGS (closeQuarter): reports with gap = gapFactor * (surprise - what PUBLISHED leaks priced
 * in). That gap lands after a seeded trading window at the start of the next quarter.
 *
 * Time is the market tick (day * ticksPerCandle + tickOfDay), like ./shocks.ts.
 * Cards and regimes (M5) publish through enqueue() so they share the queue and the gap.
 */
import { msToTicks, quarterRamp } from '@tg/shared';
import type { Briefing, GameConfig, HeadlineMagnitude, HeadlineTemplate, Sector, SymbolId } from '@tg/shared';
import { SECTORS } from '@tg/shared';
import { drawEarnings, earningsGap } from './earnings.ts';
import type { EarningsImpactReport, EarningsPlan } from './earnings.ts';
import { fillHeadline } from './headlines.ts';
import type { HeadlineBook, HeadlineQuery, PlaceholderLists } from './headlines.ts';
import type { Rng } from './rng.ts';
import { addReturns, createShock, drawDebunkTick, nearestMagnitude, revertShock, shockSize, stepShocks } from './shocks.ts';
import type { Shock, ShockTarget } from './shocks.ts';
import type { SimEventOf } from './types.ts';
import type { Universe } from './universe.ts';

export type NewsSource = 'random' | 'beat' | 'rate' | 'leak' | 'card' | 'regime';

/** Something waiting to be published. */
export interface NewsItem {
  /** Earliest market tick it may go out. */
  tick: number;
  source: NewsSource;
  /** How to find its headline, unless templateId names one. */
  query: HeadlineQuery;
  templateId?: string;
  target: ShockTarget;
  /** Total log-move of its shock (0 = a headline without a move). */
  logReturn: number;
  /** Policy-rate change applied when it is published. */
  dRate?: number;
  /** Who played it (cards); revealed at RESULTS. */
  ownerId?: string;
  /** Name of the card that made it (results.ts reveals it next to the author). */
  cardName?: string;
  /** Earnings leak: surprise units it prices in. */
  leakAmount?: number;
  /**
   * Fake headline (M5): its move is reverted later by a `debunk` headline published
   * cards.fakeDebunk{Min,Max}Ms after it (see drawDebunkTick), which the engine queues itself.
   */
  fake?: boolean;
  /** Debunk: reverts the shock of the published headline with this id. */
  reverts?: string;
  /** Kept across the close and published at the start of the next quarter's trading (debunks, regime ends). */
  carry?: boolean;
  /** Template and text, fixed in advance (render) so an insider preview shows the exact same words. */
  rendered?: { template: HeadlineTemplate; text: string };
}

/** A published headline with everything the recap (M6) needs to explain a move. */
export interface PublishedHeadline {
  id: string;
  templateId: string;
  text: string;
  quarter: number;
  tick: number;
  /** Game day (fractional). */
  ts: number;
  source: NewsSource;
  target: ShockTarget;
  logReturn: number;
  ownerId?: string;
  /** Policy rate after it (rate decisions only). */
  rate?: number;
  /** A fake headline (its move is reverted by a later debunk). */
  fake?: boolean;
  /** A debunk: the id of the fake it reverted. */
  reverts?: string;
  /** Card that made it. */
  cardName?: string;
}

export type HeadlineEvent = SimEventOf<'headline'>;

export interface NewsDeps {
  config: GameConfig;
  universe: Universe;
  book: HeadlineBook;
  lists: PlaceholderLists;
  /** Scheduling and slot filling. */
  rng: Rng;
  /** Earnings draws (its own stream, as earnings.ts asks). */
  earningsRng: Rng;
  /** Delay before the prior earnings report affects the market. */
  earningsLeadRng: Rng;
  /**
   * How the market reacts to engine headlines (size, reversal, overshoot, speed, aftermath) and
   * whether a leak misleads; see config.news.reaction. Optional so a bare engine (tests) is exact.
   */
  reactionRng?: Rng;
  /** Presentation order of the earnings reports. */
  earningsOrderRng: Rng;
}

export interface News {
  /** At BRIEFING. `tradingStartTick` = market tick of the quarter's first TRADING step; `rate` = policy rate now. */
  startQuarter(quarter: number, tradingStartTick: number, rate: number): Briefing;
  /** Before each TRADING market step. */
  beforeStep(tick: number, rate: number): { symbolReturn: Record<SymbolId, number> | undefined; dRate: number; events: HeadlineEvent[] };
  /** At EARNINGS: every company's report, in a stable shuffled order for this quarter. */
  closeQuarter(): EarningsImpactReport[];
  /** Queue an extra item (cards, regimes). */
  enqueue(item: NewsItem): void;
  /** Items not published yet, earliest first (insider tips peek here). */
  upcoming(): readonly NewsItem[];
  /**
   * Fixes an item's template and text now (idempotent) and returns the headline it WILL publish, minus
   * the id. Null when no template matches (it would never be published).
   */
  render(item: NewsItem): Omit<HeadlineEvent, 'id'> | null;
  briefing(): Briefing | null;
  /** Latest earnings reports and their quarter. */
  earnings(): { quarter: number; reports: EarningsImpactReport[] } | null;
  /** Gap waiting to land (after the last quarter, used to settle the final standings). */
  pendingGap(): Record<SymbolId, number> | null;
  /** The last `n` public headlines, oldest first. */
  recent(n: number): HeadlineEvent[];
  /** Everything published so far. */
  log(): readonly PublishedHeadline[];
  /** This quarter's earnings plan (the Boardroom Mole card reads it). */
  plan(): EarningsPlan | null;
}

function weighted<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let u = rng.next() * total;
  for (const [key, w] of entries) {
    u -= Math.max(0, w);
    if (u < 0) return key;
  }
  return entries[entries.length - 1]![0];
}

export function createNews(deps: NewsDeps): News {
  const { config, universe, book, lists, rng, earningsRng, earningsLeadRng, earningsOrderRng, reactionRng } = deps;
  const reaction = config.news.reaction;
  const between = (r: Rng, min: number, max: number) => min + (max - min) * r.next();
  const tpc = config.time.ticksPerCandle;
  const tradingTicks = config.time.daysPerQuarter * tpc;
  const minGapTicks = msToTicks(config, config.news.minGapMs);
  const leadMinTicks = Math.ceil(config.news.leadMinMs / config.time.tickMs);
  const leadMaxTicks = Math.max(leadMinTicks, Math.floor(config.news.leadMaxMs / config.time.tickMs));
  const settleTicks = 2 * msToTicks(config, config.news.rampMs) + leadMaxTicks;
  const companyBySymbol = new Map(universe.companies.map((c) => [c.symbol, c]));
  /** Expected quarterly EPS per company (fundamentals are fixed for the game), rounded to cents. */
  const consensus: Record<SymbolId, number> = {};
  for (const c of universe.companies) {
    const f = c.fundamentals;
    consensus[c.symbol] = f.shares > 0 ? Math.round(((f.revenue * f.margin) / 4 / f.shares) * 100) / 100 : 0;
  }

  let queue: NewsItem[] = [];
  /** Items with `carry` still waiting at the close. */
  let carried: NewsItem[] = [];
  let shocks: Shock[] = [];
  const delayedEffects: Array<{ tick: number; dRate?: number; reverts?: string }> = [];
  let lastPublished: number | null = null;
  let seq = 0;
  let quarter = 0;
  let currentPlan: EarningsPlan | null = null;
  let priced: Record<SymbolId, number> = {};
  let pendingEarnings: { returns: Record<SymbolId, number>; effectTick?: number } | null = null;
  let currentBriefing: Briefing | null = null;
  let lastEarnings: { quarter: number; reports: EarningsImpactReport[] } | null = null;
  const published: PublishedHeadline[] = [];
  const events: HeadlineEvent[] = [];

  function sortQueue(): void {
    queue.sort((a, b) => a.tick - b.tick);
  }

  function randomTarget(scope: ShockTarget['scope']): ShockTarget {
    if (scope === 'market') return { scope };
    if (scope === 'sector') return { scope, sector: SECTORS[rng.int(SECTORS.length)]! };
    return { scope, symbol: universe.companies[rng.int(universe.companies.length)]!.symbol };
  }

  /** Fixes the template and text of an item (once) and returns the public fields of its headline. */
  function render(item: NewsItem): Omit<HeadlineEvent, 'id'> | null {
    if (item.rendered === undefined) {
      let template: HeadlineTemplate | undefined;
      if (item.templateId !== undefined) {
        template = book.byId(item.templateId);
        if (template) book.use(template);
      }
      const targetSector = item.target.scope === 'sector' ? item.target.sector
        : item.target.scope === 'stock' ? companyBySymbol.get(item.target.symbol)?.sector : undefined;
      template ??= book.pick({ ...item.query, sector: targetSector });
      if (template === undefined) return null; // nothing in the database fits: no headline, no move
      const target = item.target;
      const company = target.scope === 'stock' ? companyBySymbol.get(target.symbol) : undefined;
      const sector: Sector | undefined = target.scope === 'sector' ? target.sector : company?.sector;
      const text = fillHeadline(template.text, rng, { universe, lists, ...(company ? { company } : {}), ...(sector ? { sector } : {}) });
      item.rendered = { template, text };
    }
    const target = item.target;
    const event: Omit<HeadlineEvent, 'id'> = { e: 'headline', text: item.rendered.text, ts: item.tick / tpc };
    if (target.scope === 'stock') {
      event.symbol = target.symbol;
      const sector = companyBySymbol.get(target.symbol)?.sector;
      if (sector) event.sector = sector;
    } else if (target.scope === 'sector') event.sector = target.sector;
    return event;
  }

  function publish(item: NewsItem, tick: number, newRate?: number): HeadlineEvent | null {
    const shown = render(item);
    if (shown === null || item.rendered === undefined) return null;
    const { template, text } = item.rendered;
    const target = item.target;
    const id = `n${++seq}`;
    // A player's card hits the market as it is published; engine news after the lead.
    const effectTick = item.ownerId !== undefined ? tick : tick + leadMinTicks + rng.int(leadMaxTicks - leadMinTicks + 1);
    // The move the market actually makes. Cards keep their exact effect; the engine's own news gets an
    // uncertain reaction, so a headline never fully tells you how far, how fast, or even which way.
    // The engine's own news grows with the quarter like the rest of the volatility (cards scale where
    // they are played, earnings leaks follow the earnings).
    const ownNews = item.source !== 'card' && item.source !== 'regime' && item.leakAmount === undefined;
    const base = ownNews ? item.logReturn * quarterRamp(config, quarter, config.progression.volLastQuarter) : item.logReturn;
    let move = base;
    if (move !== 0) {
      const shock = createShock(config, universe, { id, target, logReturn: move, startTick: effectTick });
      const engineNews = reactionRng !== undefined && ownNews;
      if (engineNews) {
        const r = reactionRng!;
        const size = Math.exp(reaction.sizeSigma * r.normal() - (reaction.sizeSigma * reaction.sizeSigma) / 2);
        const reversed = r.next() < reaction.reverseChance;
        move = base * size * (reversed ? -reaction.reverseScale : 1);
        shock.logReturn = move;
        shock.overshoot = between(r, reaction.overshootMin, reaction.overshootMax);
        shock.rampTicks = Math.max(1, Math.round(shock.rampTicks * between(r, reaction.rampMultMin, reaction.rampMultMax)));
        // Aftermath: a slow follow-through or fade over the next days, with no headline of its own.
        if (r.next() < reaction.driftChance) {
          const days = Math.round(between(r, reaction.driftDaysMin, reaction.driftDaysMax));
          const drift = createShock(config, universe, { id: `${id}~`, target, logReturn: move * between(r, reaction.driftShareMin, reaction.driftShareMax), startTick: effectTick + 2 * shock.rampTicks });
          shocks.push({ ...drift, rampTicks: Math.max(1, days * tpc), overshoot: 0 });
        }
      }
      // A fake stays revertible until its debunk lands (an unset revertTick would drop it once settled).
      shocks.push(item.fake ? { ...shock, revertTick: Number.POSITIVE_INFINITY } : shock);
    }
    if (item.reverts !== undefined || item.dRate !== undefined) {
      delayedEffects.push({ tick: effectTick, ...(item.reverts === undefined ? {} : { reverts: item.reverts }), ...(item.dRate === undefined ? {} : { dRate: item.dRate }) });
    }
    if (item.leakAmount !== undefined && target.scope === 'stock') priced[target.symbol] = (priced[target.symbol] ?? 0) + item.leakAmount;
    if (item.fake) {
      const direction = item.query.direction === 'up' ? 'down' : 'up';
      queue.push({
        tick: drawDebunkTick(rng, config, tick),
        source: item.source,
        query: { kind: 'debunk', scope: item.query.scope, direction },
        target,
        logReturn: 0,
        reverts: id,
        carry: true,
      });
      sortQueue();
    }

    const ts = tick / tpc;
    published.push({
      id,
      templateId: template.id,
      text,
      quarter,
      tick,
      ts,
      source: item.source,
      target,
      // The move the market made (what the recap explains), not the planned one.
      logReturn: move,
      ...(item.ownerId === undefined ? {} : { ownerId: item.ownerId }),
      ...(item.cardName === undefined ? {} : { cardName: item.cardName }),
      ...(newRate === undefined ? {} : { rate: newRate }),
      ...(item.fake ? { fake: true } : {}),
      ...(item.reverts === undefined ? {} : { reverts: item.reverts }),
    });
    const event: HeadlineEvent = { ...shown, id, ts };
    if (newRate !== undefined) event.rate = newRate;
    events.push(event);
    return event;
  }

  return {
    startQuarter(q, tradingStartTick, rate) {
      quarter = q;
      // Debunks and regime ends that missed the last close go out first thing this quarter.
      // (Also `carry` items queued while the market was closed, e.g. regime ends at RESULTS.)
      queue = [...carried, ...queue.filter((item) => item.carry)].map((item) => ({ ...item, tick: tradingStartTick }));
      carried = [];
      priced = {};
      if (pendingEarnings !== null) {
        const delay = leadMinTicks + earningsLeadRng.int(leadMaxTicks - leadMinTicks + 1);
        // The first step runs one tick after the trading phase is announced.
        pendingEarnings.effectTick = tradingStartTick + Math.min(delay, tradingTicks) - 1;
      }
      const n = config.news;

      // 1. Earnings plan and its leaks.
      currentPlan = drawEarnings(earningsRng, config, universe, q, tradingStartTick);
      for (const leak of currentPlan.leaks) {
        // A leak is a rumor: with 1 - leakAccuracy it points the wrong way. What it moves is what it
        // "prices in" (signed), so the report's gap corrects it and leak + gap still add up.
        const sign = reactionRng !== undefined && reactionRng.next() >= reaction.leakAccuracy ? -1 : 1;
        const logReturn = sign * leak.logReturn;
        queue.push({
          tick: leak.tick,
          source: 'leak',
          query: { kind: 'real', scope: 'stock', category: 'earnings_leak', direction: logReturn >= 0 ? 'up' : 'down', magnitude: nearestMagnitude(config, logReturn) },
          target: { scope: 'stock', symbol: leak.symbol },
          logReturn,
          leakAmount: sign * leak.amount,
        });
      }

      // 2. Scheduled beats on evenly spaced days; the first is the rate decision.
      const beats: Briefing['beats'] = [];
      const count = Math.min(n.scheduledBeatsPerQuarter, n.beatTitles.length);
      for (let k = 0; k < count; k++) {
        const dayInQuarter = Math.min(config.time.daysPerQuarter - 1, Math.round(((k + 1) * config.time.daysPerQuarter) / (count + 1)));
        const tick = tradingStartTick + dayInQuarter * tpc;
        const magnitude: HeadlineMagnitude = rng.next() < 0.5 ? 'medium' : 'large';
        let up = rng.next() < 0.5;
        let dRate: number | undefined;
        if (k === 0) {
          // A cut lifts the market, a hike sinks it. Never leave [rateMin, rateMax].
          const step = config.market.rateStep;
          if (rate - step < config.market.rateMin - 1e-12) up = false;
          else if (rate + step > config.market.rateMax + 1e-12) up = true;
          dRate = up ? -step : step;
        }
        const direction = up ? 'up' : 'down';
        queue.push({
          tick,
          source: k === 0 ? 'rate' : 'beat',
          query: { kind: 'real', scope: 'market', direction, magnitude, category: 'macro', ...(k === 0 ? { prefer: /rate/i } : {}) },
          target: { scope: 'market' },
          logReturn: shockSize(config, magnitude, direction),
          ...(dRate === undefined ? {} : { dRate }),
        });
        beats.push({ day: tradingStartTick / tpc + dayInQuarter, title: n.beatTitles[k]! });
      }

      // 3. Random headlines (noise included).
      const first = tradingStartTick + n.quietDays * tpc;
      const window = Math.max(1, tradingStartTick + tradingTicks - settleTicks - first);
      for (let i = 0; i < n.randomHeadlinesPerQuarter; i++) {
        const tick = first + rng.int(window);
        const scope = weighted(rng, n.scopeWeights);
        const target = randomTarget(scope);
        if (rng.next() < n.noiseShare) {
          const magnitude: HeadlineMagnitude = rng.next() < 0.5 ? 'small' : 'medium';
          queue.push({ tick, source: 'random', query: { kind: 'real', scope, direction: 'neutral', magnitude }, target, logReturn: 0 });
          continue;
        }
        const magnitude = weighted(rng, n.magnitudeWeights);
        const direction = rng.next() < 0.5 ? 'up' : 'down';
        const jitter = 1 + n.shockJitter * (2 * rng.next() - 1);
        queue.push({ tick, source: 'random', query: { kind: 'real', scope, direction, magnitude }, target, logReturn: shockSize(config, magnitude, direction) * jitter });
      }

      // 4. The filler chain: never more than maxGapMs without news, meanGapMs on average overall.
      if (n.maxGapMs > 0) {
        const gapMin = Math.max(1, minGapTicks);
        const gapMax = Math.max(gapMin, Math.floor(n.maxGapMs / config.time.tickMs));
        const end = tradingStartTick + tradingTicks;
        // The planned headlines count toward the average: the chain fills in the rest. A quarter of
        // T seconds averaging g between headlines holds about T / g - 1 of them (the open and the close
        // are not headlines).
        const planned = count + n.randomHeadlinesPerQuarter + currentPlan.leaks.length;
        const chainCount = Math.max(1, tradingTicks / (n.meanGapMs / config.time.tickMs) - 1 - planned);
        const chainMean = Math.min(gapMax - 0.5, Math.max(gapMin + 0.5, tradingTicks / chainCount));
        // gap = min + (max - min) * u^k has mean min + (max - min) / (k + 1).
        const k = gapMax > gapMin ? (gapMax - gapMin) / (chainMean - gapMin) - 1 : 1;
        const gap = () => gapMin + Math.round((gapMax - gapMin) * rng.next() ** k);
        for (let tick = tradingStartTick + gap(); tick < end; tick += gap()) {
          const scope = weighted(rng, n.scopeWeights);
          const target = randomTarget(scope);
          const late = tick + settleTicks >= end;
          if (late || rng.next() < n.filler.noiseShare) {
            const magnitude: HeadlineMagnitude = rng.next() < 0.5 ? 'small' : 'medium';
            queue.push({ tick, source: 'random', query: { kind: 'real', scope, direction: 'neutral', magnitude }, target, logReturn: 0 });
            continue;
          }
          const magnitude = weighted(rng, n.filler.magnitudeWeights);
          const direction = rng.next() < 0.5 ? 'up' : 'down';
          const jitter = 1 + n.shockJitter * (2 * rng.next() - 1);
          queue.push({ tick, source: 'random', query: { kind: 'real', scope, direction, magnitude }, target, logReturn: shockSize(config, magnitude, direction) * jitter });
        }
      }
      sortQueue();

      currentBriefing = { quarter: q, rate, beats, regimes: [], consensus };
      return currentBriefing;
    },

    beforeStep(tick, rate) {
      events.length = 0;
      let dRate = 0;
      let extra: Record<SymbolId, number> | undefined;
      if (pendingEarnings?.effectTick !== undefined && pendingEarnings.effectTick <= tick) {
        extra = pendingEarnings.returns;
        pendingEarnings = null;
      }

      // Players first: a due card or regime headline jumps any backlog of engine headlines.
      const playerIndex = queue.findIndex((item) => item.tick <= tick && (item.source === 'card' || item.source === 'regime'));
      const index = playerIndex >= 0 ? playerIndex : 0;
      const due = queue[index];
      if (due !== undefined && due.tick <= tick && (lastPublished === null || tick - lastPublished >= minGapTicks)) {
        queue.splice(index, 1);
        const next = due.dRate === undefined ? undefined : Math.min(config.market.rateMax, Math.max(config.market.rateMin, rate + due.dRate));
        // A late leak must settle before earnings or its move would be counted twice.
        const tooLateForLeak = due.leakAmount !== undefined && tick + settleTicks >= quarter * tradingTicks;
        if (!tooLateForLeak && publish(due, tick, next) !== null) {
          lastPublished = tick;
        }
      }

      for (let i = delayedEffects.length - 1; i >= 0; i--) {
        const effect = delayedEffects[i]!;
        if (effect.tick > tick) continue;
        if (effect.reverts !== undefined) shocks = shocks.map((s) => (s.id === effect.reverts ? revertShock(s, tick) : s));
        if (effect.dRate !== undefined) {
          const nextRate = Math.min(config.market.rateMax, Math.max(config.market.rateMin, rate + dRate + effect.dRate));
          dRate = nextRate - rate;
        }
        delayedEffects.splice(i, 1);
      }

      const stepped = stepShocks(shocks, tick);
      shocks = stepped.live;
      const symbolReturn = extra === undefined ? stepped.symbolReturn : addReturns(stepped.symbolReturn, extra);
      return { symbolReturn: Object.keys(symbolReturn).length > 0 ? symbolReturn : undefined, dRate, events: [...events] };
    },

    closeQuarter() {
      carried.push(...queue.filter((item) => item.carry));
      queue = [];
      if (currentPlan === null) return [];
      const g = earningsGap(config, currentPlan, priced);
      pendingEarnings = { returns: g };
      const reports = Object.entries(currentPlan.surprise).map(([symbol, surprise]) => ({ symbol, surprise, gap: g[symbol] ?? 0 }));
      for (let i = reports.length - 1; i > 0; i--) {
        const j = earningsOrderRng.int(i + 1);
        [reports[i], reports[j]] = [reports[j]!, reports[i]!];
      }
      lastEarnings = { quarter, reports };
      return reports;
    },

    enqueue(item) {
      queue.push(item);
      sortQueue();
    },

    upcoming: () => queue,
    render,
    briefing: () => currentBriefing,
    earnings: () => lastEarnings,
    pendingGap: () => pendingEarnings?.returns ?? null,
    recent(n) {
      return published.slice(-n).map((p) => {
        const event: HeadlineEvent = { e: 'headline', id: p.id, text: p.text, ts: p.ts };
        if (p.rate !== undefined) event.rate = p.rate;
        if (p.target.scope === 'stock') {
          event.symbol = p.target.symbol;
          const sector = companyBySymbol.get(p.target.symbol)?.sector;
          if (sector) event.sector = sector;
        } else if (p.target.scope === 'sector') event.sector = p.target.sector;
        return event;
      });
    },
    log: () => published,
    plan: () => currentPlan,
  };
}
