/**
 * Phase order of the game. Pure (see ./types.ts for the purity rules).
 *
 *   LOBBY -> [BRIEFING -> TRADING -> EARNINGS -> RESULTS -> SHOP] x config.time.quarters -> FINAL
 */
import { QUARTER_PHASES, phaseTicks } from '@tg/shared';
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

  const index = QUARTER_PHASES.indexOf(at.phase);
  const following = QUARTER_PHASES[index + 1];
  if (following !== undefined) return { phase: following, quarter: at.quarter };
  if (at.quarter >= config.time.quarters) return { phase: 'FINAL', quarter: at.quarter };
  return { phase: QUARTER_PHASES[0]!, quarter: at.quarter + 1 };
}
