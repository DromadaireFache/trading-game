/**
 * News shocks as numbers (DESIGN.md section 3): a move of log-size `m` applied as a ramp with a
 * slight overshoot, optionally reverted later (a debunked fake headline). No headline text here:
 * whoever publishes the headline passes scope / target / direction / magnitude, or a raw log-return.
 *
 * Time is the MARKET tick: day * ticksPerCandle + tickOfDay of the step being made (0-based). It only
 * advances during TRADING, so a shock started near the close carries on at the next open.
 *
 * Path of the cumulative log-move L(k) after k ticks of a shock with total m:
 *   ramp   (k = 0..R):   L = m * (1 + overshoot) * smooth(k / R)          R = news.rampMs in ticks
 *   settle (k = R..2R):  L goes from m * (1 + overshoot) back to m, smoothly
 *   after:               L = m (a permanent event stays)
 *   revert (from tick D, over R ticks): L goes smoothly from its value at D to 0, no overshoot.
 * The tick's extra return is L(k) - L(k - 1), summed over every live shock on the symbol; that map is
 * what market.step takes as `symbolReturn`.
 */
import type { GameConfig, HeadlineMagnitude, Sector, SymbolId } from '@tg/shared';
import { msToTicks } from '@tg/shared';
import type { Rng } from './rng.ts';
import type { Universe } from './universe.ts';

export interface Shock {
  id: string;
  /** Companies it moves (funds follow their members). */
  symbols: SymbolId[];
  /** Total log-return per symbol (signed). */
  logReturn: number;
  /** Market tick of its first step. */
  startTick: number;
  rampTicks: number;
  overshoot: number;
  /** Market tick its reversal starts on (fake headlines, fact-check). */
  revertTick?: number;
}

export type ShockTarget = { scope: 'market' } | { scope: 'sector'; sector: Sector } | { scope: 'stock'; symbol: SymbolId };

/** Companies a target covers. Unknown sector or symbol = none. */
export function shockSymbols(universe: Universe, target: ShockTarget): SymbolId[] {
  switch (target.scope) {
    case 'market':
      return universe.companies.map((c) => c.symbol);
    case 'sector':
      return universe.companies.filter((c) => c.sector === target.sector).map((c) => c.symbol);
    case 'stock':
      return universe.companies.some((c) => c.symbol === target.symbol) ? [target.symbol] : [];
  }
}

/** Signed log-return of a headline of this magnitude and direction ('neutral' = 0). */
export function shockSize(config: GameConfig, magnitude: HeadlineMagnitude, direction: 'up' | 'down' | 'neutral'): number {
  if (direction === 'neutral') return 0;
  const m = config.news.shock[magnitude];
  return direction === 'up' ? m : -m;
}

/** The magnitude whose shock size is closest to |logReturn| (to pick a headline for a raw move). */
export function nearestMagnitude(config: GameConfig, logReturn: number): HeadlineMagnitude {
  const size = Math.abs(logReturn);
  let best: HeadlineMagnitude = 'small';
  for (const [magnitude, m] of Object.entries(config.news.shock) as [HeadlineMagnitude, number][]) {
    if (Math.abs(m - size) < Math.abs(config.news.shock[best] - size)) best = magnitude;
  }
  return best;
}

export function createShock(
  config: GameConfig,
  universe: Universe,
  args: { id: string; target: ShockTarget; logReturn: number; startTick: number },
): Shock {
  return {
    id: args.id,
    symbols: shockSymbols(universe, args.target),
    logReturn: args.logReturn,
    startTick: args.startTick,
    rampTicks: msToTicks(config, config.news.rampMs),
    overshoot: config.news.overshoot,
  };
}

/** Market tick a fake headline started on `startTick` gets debunked, drawn in cards.fakeDebunk{Min,Max}Ms. */
export function drawDebunkTick(rng: Rng, config: GameConfig, startTick: number): number {
  const minTicks = msToTicks(config, config.cards.fakeDebunkMinMs);
  const maxTicks = Math.max(minTicks, msToTicks(config, config.cards.fakeDebunkMaxMs));
  return startTick + minTicks + rng.int(maxTicks - minTicks + 1);
}

/** Returns the shock with its reversal starting at `tick` (no-op if one already started earlier). */
export function revertShock(shock: Shock, tick: number): Shock {
  if (shock.revertTick !== undefined && shock.revertTick <= tick) return shock;
  return { ...shock, revertTick: Math.max(tick, shock.startTick) };
}

/** 0 -> 0, 1 -> 1, flat at both ends. */
function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** Cumulative log-move L after the shock's steps up to and including market tick `tick`. */
export function shockLevel(shock: Shock, tick: number): number {
  const level = (t: number): number => {
    const k = t - shock.startTick + 1;
    if (k <= 0) return 0;
    const peak = shock.logReturn * (1 + shock.overshoot);
    const r = Math.max(1, shock.rampTicks);
    if (k <= r) return peak * smooth(k / r);
    if (k <= 2 * r) return peak + (shock.logReturn - peak) * smooth((k - r) / r);
    return shock.logReturn;
  };
  if (shock.revertTick === undefined || tick < shock.revertTick) return level(tick);
  const from = level(shock.revertTick - 1);
  const k = tick - shock.revertTick + 1;
  return from * (1 - smooth(k / Math.max(1, shock.rampTicks)));
}

/** True once the shock no longer moves anything (settled for good, or fully reverted). */
export function shockDone(shock: Shock, tick: number): boolean {
  const r = Math.max(1, shock.rampTicks);
  if (shock.revertTick !== undefined) return tick >= shock.revertTick + r - 1;
  return tick >= shock.startTick + 2 * r - 1;
}

/**
 * This tick's extra returns from every shock, plus the shocks still worth keeping. Shocks whose
 * revertTick is still pending are kept even when settled, so a later debunk can find them.
 */
export function stepShocks(shocks: readonly Shock[], tick: number): { symbolReturn: Record<SymbolId, number>; live: Shock[] } {
  const symbolReturn: Record<SymbolId, number> = {};
  const live: Shock[] = [];
  for (const shock of shocks) {
    const delta = shockLevel(shock, tick) - shockLevel(shock, tick - 1);
    if (delta !== 0) for (const s of shock.symbols) symbolReturn[s] = (symbolReturn[s] ?? 0) + delta;
    const pendingRevert = shock.revertTick !== undefined && tick < shock.revertTick;
    if (pendingRevert || !shockDone(shock, tick)) live.push(shock);
  }
  return { symbolReturn, live };
}

/** Adds two symbolReturn maps (shocks + impact + earnings gap feed one market step). */
export function addReturns(a: Record<SymbolId, number>, b: Record<SymbolId, number>): Record<SymbolId, number> {
  const out = { ...a };
  for (const [s, r] of Object.entries(b)) out[s] = (out[s] ?? 0) + r;
  return out;
}
