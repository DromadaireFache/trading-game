/**
 * Regimes (DESIGN.md section 5): multi-quarter world states that bend the market, plus lobbying
 * bills. Pure; the only randomness (does a bill pass?) comes from the Rng passed in.
 *
 * - A regime card becomes an ActiveRegime (startRegime). At most regimes.maxActive run at once,
 *   lobbying bills included.
 * - Every TRADING tick, marketInputFor() turns the active regimes into the MarketStepInput fields
 *   the market already takes: volMult and corrMult multiply, sector drifts add, and drifts of passed
 *   bills (RegimeState.permanentDrift) add on top for the rest of the game.
 * - rateDelta is a one-off: +rateDelta on the tick the regime starts, -rateDelta on the tick it ends
 *   (the "slow recovery" of a coup is its end headline plus the rate going back). Both come back
 *   from startRegime / endQuarter as `dRate` for the caller to pass to market.step once.
 * - endQuarter() (at RESULTS) counts every regime down by one quarter. A regime that reaches 0 ends;
 *   a bill that reaches 0 is decided with regimes.lobbyPassProbability.
 *
 * Not wired into createSim yet (M5): fork a new RNG stream for it at the END of createSim's forks.
 */
import type { GameConfig, PlayerId, Regime, Sector } from '@tg/shared';
import { SECTORS } from '@tg/shared';
import type { LobbyingEffect, RegimeEffect } from '@tg/shared/cards';
import type { MarketStepInput } from './market.ts';
import type { Rng } from './rng.ts';

export interface ActiveRegime {
  regime: Regime;
  /** Card defId it came from. */
  defId: string;
  /** Headline id to publish when it ends (bills use lobby.passed / lobby.failed instead). */
  endHeadline?: string;
  /** Set for a lobbying bill. */
  lobby?: { sector: Sector; driftIfPassed: number; passed: string; failed: string };
}

export interface RegimeState {
  active: ActiveRegime[];
  /** Per-day drifts that stay for the rest of the game (passed bills). */
  permanentDrift: Partial<Record<Sector, number>>;
}

export function emptyRegimeState(): RegimeState {
  return { active: [], permanentDrift: {} };
}

export type StartRegimeResult =
  | { ok: true; state: RegimeState; regime: ActiveRegime; dRate: number; startHeadline: string }
  | { ok: false; reason: 'regime_cap' | 'needs_sector' | 'unknown_sector' };

export interface StartRegimeArgs {
  /** Unique id for this regime instance, e.g. "r_q3_war". */
  id: string;
  defId: string;
  name: string;
  effect: RegimeEffect | LobbyingEffect;
  ownerId?: PlayerId;
  /** Target sector, required for lobbying. */
  sector?: string;
}

export function canStartRegime(config: GameConfig, state: RegimeState): boolean {
  return state.active.length < config.regimes.maxActive;
}

/** Starts a regime from a played card (or the engine). Returns a new state; the input is not mutated. */
export function startRegime(config: GameConfig, state: RegimeState, args: StartRegimeArgs): StartRegimeResult {
  if (!canStartRegime(config, state)) return { ok: false, reason: 'regime_cap' };
  const fx = args.effect;
  const owner = args.ownerId === undefined ? {} : { ownerId: args.ownerId };

  let active: ActiveRegime;
  let startHeadline: string;
  if (fx.kind === 'lobbying') {
    if (args.sector === undefined) return { ok: false, reason: 'needs_sector' };
    if (!SECTORS.includes(args.sector as Sector)) return { ok: false, reason: 'unknown_sector' };
    const sector = args.sector as Sector;
    const during = [fx.headlines.delayed, ...(fx.headlines.beneficiary ? [fx.headlines.beneficiary] : [])];
    active = {
      regime: { id: args.id, name: args.name, ...owner, quartersLeft: fx.quarters, sectorDrift: {}, volMult: 1, corrMult: 1, headlines: during },
      defId: args.defId,
      lobby: { sector, driftIfPassed: fx.driftIfPassed, passed: fx.headlines.passed, failed: fx.headlines.failed },
    };
    startHeadline = fx.headlines.start;
  } else {
    active = {
      regime: {
        id: args.id,
        name: args.name,
        ...owner,
        quartersLeft: fx.quarters,
        sectorDrift: { ...fx.sectorDrift },
        volMult: fx.volMult,
        corrMult: fx.corrMult,
        ...(fx.rateDelta === undefined ? {} : { rateDelta: fx.rateDelta }),
        headlines: [...fx.headlines.during],
      },
      defId: args.defId,
      ...(fx.headlines.end === undefined ? {} : { endHeadline: fx.headlines.end }),
    };
    startHeadline = fx.headlines.start;
  }
  return {
    ok: true,
    state: { active: [...state.active, active], permanentDrift: { ...state.permanentDrift } },
    regime: active,
    dRate: active.regime.rateDelta ?? 0,
    startHeadline,
  };
}

/** The regime part of this tick's MarketStepInput (no dRate: that is a one-off, see the header). */
export function marketInputFor(state: RegimeState): Pick<MarketStepInput, 'volMult' | 'corrMult' | 'sectorDriftPerDay'> {
  let volMult = 1;
  let corrMult = 1;
  const drift: Partial<Record<Sector, number>> = { ...state.permanentDrift };
  for (const { regime } of state.active) {
    volMult *= regime.volMult;
    corrMult *= regime.corrMult;
    for (const [sector, d] of Object.entries(regime.sectorDrift) as [Sector, number][]) {
      drift[sector] = (drift[sector] ?? 0) + d;
    }
  }
  return { volMult, corrMult, sectorDriftPerDay: drift };
}

export interface EndedRegime {
  regime: ActiveRegime;
  /** Headline to publish now, if any. */
  headline?: string;
  /** For a bill: whether it passed. */
  passed?: boolean;
}

export interface EndQuarterResult {
  state: RegimeState;
  ended: EndedRegime[];
  /** Sum of the reverted rateDeltas, to pass to market.step once. */
  dRate: number;
}

/**
 * Counts every active regime down by one quarter. Draws one rng.next() per bill that is decided,
 * in active order, and nothing else.
 */
export function endQuarter(rng: Rng, config: GameConfig, state: RegimeState): EndQuarterResult {
  const active: ActiveRegime[] = [];
  const ended: EndedRegime[] = [];
  const permanentDrift = { ...state.permanentDrift };
  let dRate = 0;
  for (const item of state.active) {
    const quartersLeft = item.regime.quartersLeft - 1;
    const next: ActiveRegime = { ...item, regime: { ...item.regime, quartersLeft } };
    if (quartersLeft > 0) {
      active.push(next);
      continue;
    }
    if (item.lobby) {
      const passed = rng.next() < config.regimes.lobbyPassProbability;
      if (passed) permanentDrift[item.lobby.sector] = (permanentDrift[item.lobby.sector] ?? 0) + item.lobby.driftIfPassed;
      ended.push({ regime: next, passed, headline: passed ? item.lobby.passed : item.lobby.failed });
    } else {
      dRate -= item.regime.rateDelta ?? 0;
      ended.push({ regime: next, ...(item.endHeadline === undefined ? {} : { headline: item.endHeadline }) });
    }
  }
  return { state: { active, permanentDrift }, ended, dRate };
}
