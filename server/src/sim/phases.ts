/**
 * Phase order of the game. Pure (see ./types.ts for the purity rules).
 *
 *   LOBBY -> [BRIEFING -> TRADING -> RESULTS -> SHOP] -> ... -> FINAL
 *   The last quarter goes from TRADING to FINAL. The earnings come out as TRADING closes.
 */
import { FINAL_QUARTER_PHASES, QUARTER_PHASES, phaseTicks } from '@tg/shared';
import type { GameConfig, Phase, QuarterPhase } from '@tg/shared';

export interface PhasePosition {
  phase: Phase;
  quarter: number;
}

export function isQuarterPhase(phase: Phase): phase is QuarterPhase {
  return (QUARTER_PHASES as readonly Phase[]).includes(phase);
}

/** Length of a phase in ticks; null for the untimed phases (LOBBY, FINAL). */
export function phaseLength(config: GameConfig, phase: Phase): number | null {
  return isQuarterPhase(phase) ? phaseTicks(config, phase) : null;
}

/** Where the game goes when the current phase ends. LOBBY starts quarter 1; FINAL stays FINAL. */
export function nextPhase(config: GameConfig, at: PhasePosition): PhasePosition {
  if (at.phase === 'FINAL') return at;
  if (at.phase === 'LOBBY') return { phase: QUARTER_PHASES[0]!, quarter: 1 };

  const lastQuarter = at.quarter >= config.time.quarters;
  const phases = lastQuarter ? FINAL_QUARTER_PHASES : QUARTER_PHASES;
  const following = phases[QUARTER_PHASES.indexOf(at.phase) + 1];
  if (following !== undefined) return { phase: following, quarter: at.quarter };
  if (lastQuarter) return { phase: 'FINAL', quarter: at.quarter };
  return { phase: QUARTER_PHASES[0]!, quarter: at.quarter + 1 };
}
