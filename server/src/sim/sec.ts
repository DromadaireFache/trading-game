/**
 * SEC: heat, the end-of-quarter catch roll, fines and jail (DESIGN.md section 5). Pure and seeded.
 *
 * - Every illegal act adds config.sec.heat[key] to the player (addHeat). The sim keeps per-player
 *   heat plus, for the arrest line, how much of it came from each kind of act this quarter.
 * - At the end of each quarter resolveSec rolls once per free player:
 *     P(caught) = min(maxCatchProbability, heat * catchProbabilityPerHeat * rankMultiplier[rank])
 *   rank 0 = richest by net worth (ties keep input order); ranks past the end of rankMultiplier use
 *   its last value.
 * - Caught: fine = fineShareOfNetWorth * net worth; jail = jailDaysLong at or above longJailHeat,
 *   else jailDaysShort; heat goes back to 0 (the player has paid for it).
 * - Not caught (or already in jail, who is not rolled again): heat *= heatDecayPerQuarter.
 * - Jail is in trading days. `jailedUntil` = `nextTradingDay + jailDays`, the game day (see
 *   shared/messages.ts) the player may trade again; the RESULTS phase passes the first day of the
 *   next quarter. Positions stay open; the sim only blocks orders and card plays while jailed.
 *
 * Not wired into createSim yet (M5): fork a new RNG stream for it at the END of createSim's forks.
 */
import type { Arrest, GameConfig, PlayerId } from '@tg/shared';
import type { HeatKey } from '@tg/shared/cards';
import type { Rng } from './rng.ts';

export type HeatSources = Partial<Record<HeatKey, number>>;

/** Wording of the arrest line, by the act that brought in the most heat. */
export const CRIME_BY_HEAT: Record<HeatKey, string> = {
  insiderTip: 'insider trading',
  fakeHeadline: 'spreading fake news',
  tradeManipulatedTarget: 'market manipulation',
  illegalEvent: 'sabotage',
  tipOff: 'securities fraud',
};

/** Returns the new heat and heat sources after one illegal act. Inputs are not mutated. */
export function addHeat(config: GameConfig, heat: number, sources: HeatSources, key: HeatKey): { heat: number; sources: HeatSources } {
  const amount = config.sec.heat[key];
  return { heat: heat + amount, sources: { ...sources, [key]: (sources[key] ?? 0) + amount } };
}

export function catchProbability(config: GameConfig, heat: number, rank: number): number {
  const multipliers = config.sec.rankMultiplier;
  const multiplier = multipliers[Math.min(Math.max(0, rank), multipliers.length - 1)] ?? 1;
  const p = Math.max(0, heat) * config.sec.catchProbabilityPerHeat * multiplier;
  return Math.min(config.sec.maxCatchProbability, p);
}

export function jailDaysFor(config: GameConfig, heat: number): number {
  return heat >= config.sec.longJailHeat ? config.sec.jailDaysLong : config.sec.jailDaysShort;
}

export interface SecPlayer {
  playerId: PlayerId;
  name: string;
  heat: number;
  netWorth: number;
  /** Heat gained this quarter per kind of act; picks the arrest wording. */
  sources?: HeatSources;
  /** Game day the player is jailed until, if any. */
  jailedUntil?: number;
  /** Eliminated players are skipped entirely (no roll, no decay). */
  eliminated?: boolean;
}

export interface SecOutcome {
  playerId: PlayerId;
  rank: number;
  probability: number;
  caught: boolean;
  heatAfter: number;
  fine: number;
  jailDays: number;
  /** Set when caught. */
  jailedUntil?: number;
  arrest?: Arrest;
}

export interface SecResolution {
  outcomes: SecOutcome[];
  /** Arrests in input order, ready for the `results` event. */
  arrests: Arrest[];
}

function reasonFor(sources: HeatSources | undefined): string {
  let best: HeatKey | undefined;
  for (const key of Object.keys(sources ?? {}) as HeatKey[]) {
    if ((sources![key] ?? 0) > 0 && (best === undefined || sources![key]! > sources![best]!)) best = key;
  }
  return best === undefined ? 'securities fraud' : CRIME_BY_HEAT[best];
}

/**
 * End-of-quarter SEC pass. `nextTradingDay` is the game day the next quarter's trading starts on
 * (jail runs from there). Draws exactly one rng.next() per player who is rolled, in input order.
 */
export function resolveSec(rng: Rng, config: GameConfig, players: readonly SecPlayer[], nextTradingDay: number): SecResolution {
  const ranked = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.eliminated)
    .sort((a, b) => b.p.netWorth - a.p.netWorth || a.i - b.i);
  const rankOf = new Map(ranked.map(({ p }, rank) => [p.playerId, rank]));

  const outcomes: SecOutcome[] = [];
  const arrests: Arrest[] = [];
  for (const p of players) {
    if (p.eliminated) continue;
    const rank = rankOf.get(p.playerId)!;
    const inJail = p.jailedUntil !== undefined && p.jailedUntil > nextTradingDay;
    const probability = inJail ? 0 : catchProbability(config, p.heat, rank);
    const caught = !inJail && p.heat > 0 && rng.next() < probability;
    if (!caught) {
      outcomes.push({ playerId: p.playerId, rank, probability, caught, heatAfter: p.heat * config.sec.heatDecayPerQuarter, fine: 0, jailDays: 0 });
      continue;
    }
    const fine = config.sec.fineShareOfNetWorth * Math.max(0, p.netWorth);
    const jailDays = jailDaysFor(config, p.heat);
    const reason = reasonFor(p.sources);
    const arrest: Arrest = {
      playerId: p.playerId,
      name: p.name,
      reason,
      fine,
      jailDays,
      text: `${p.name} arrested for ${reason}. ${jailDays} days.`,
    };
    arrests.push(arrest);
    outcomes.push({ playerId: p.playerId, rank, probability, caught, heatAfter: 0, fine, jailDays, jailedUntil: nextTradingDay + jailDays, arrest });
  }
  return { outcomes, arrests };
}

/** True while the player may not trade or play cards. */
export function isJailed(jailedUntil: number | undefined, gameDay: number): boolean {
  return jailedUntil !== undefined && gameDay < jailedUntil;
}
