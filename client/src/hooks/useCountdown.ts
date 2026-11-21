import { useEffect, useState } from 'react';
import { formatCountdown, phaseProgress, remainingMs } from '../lib/time.ts';
import { useGame } from '../net/GameProvider.tsx';

/** Client clock, re-read every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface Countdown {
  /** Ms left, corrected for the server/client clock offset. null = no timer (LOBBY, FINAL, not joined). */
  ms: number | null;
  /** "m:ss", or "--:--" without a timer. */
  text: string;
  /** 0..1 elapsed share of the phase, null without a timer. */
  progress: number | null;
}

/** Live countdown of the current phase. */
export function useCountdown(): Countdown {
  const { phase, clockOffsetMs, config } = useGame();
  // The interval only triggers re-renders; the clock is read fresh on every render so a render caused
  // by a phase change does not use a stale time (which would flash one second too many).
  useNow(config.presentation.countdownRefreshMs);
  const now = Date.now();
  if (!phase) return { ms: null, text: formatCountdown(null), progress: null };
  const ms = remainingMs(phase.endsAt, clockOffsetMs, now);
  return { ms, text: formatCountdown(ms), progress: phaseProgress(config, phase, clockOffsetMs, now) };
}
