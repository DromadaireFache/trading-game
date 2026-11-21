/** Pure time helpers for the phase countdown. */
import { phaseTicks } from '@tg/shared';
import type { GameConfig, Phase, PhaseInfo } from '@tg/shared';

/**
 * Ms left in the phase, never negative; null when the phase has no timer (LOBBY, FINAL).
 * `clockOffsetMs` = serverTime - clientTime, so server "now" = clientNow + clockOffsetMs.
 */
export function remainingMs(endsAt: number | null, clockOffsetMs: number, clientNow: number): number | null {
  if (endsAt === null) return null;
  return Math.max(0, endsAt - (clientNow + clockOffsetMs));
}

/** "1:30", "0:07". Rounds up so the display reaches 0:00 exactly when the phase ends. */
export function formatCountdown(ms: number | null): string {
  if (ms === null) return '--:--';
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Full real-time length of a phase in ms; null for LOBBY and FINAL. */
export function phaseDurationMs(config: GameConfig, phase: Phase): number | null {
  if (phase === 'LOBBY' || phase === 'FINAL') return null;
  return phaseTicks(config, phase) * config.time.tickMs;
}

/** 0..1 share of the phase that has elapsed; null when there is no timer. */
export function phaseProgress(config: GameConfig, phase: PhaseInfo, clockOffsetMs: number, clientNow: number): number | null {
  const left = remainingMs(phase.endsAt, clockOffsetMs, clientNow);
  const total = phaseDurationMs(config, phase.phase);
  if (left === null || total === null || total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - left / total));
}

/** "Q3/8"; "Q-/8" before the first quarter. */
export function formatQuarter(quarter: number, totalQuarters: number): string {
  return `Q${quarter > 0 ? quarter : '-'}/${totalQuarters}`;
}
