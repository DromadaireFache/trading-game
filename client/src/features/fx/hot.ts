/**
 * "Hot" things shake, Balatro style: a cash-out button on a winning bet, a big profit figure. The
 * level (0..1) sets how hard: CSS reads --hot. Only the label inside a button shakes, never the button
 * box, so it stays easy to click (and a test's click waits for a still box).
 */
import type { CSSProperties } from 'react';
import { getHype } from './hype.ts';

/** A bet this far in profit (share of what it cost) shakes at full strength. */
export const HOT_PROFIT = 0.25;

/** How hot a winning bet is: its profit share, plus a push from how well the player does overall. */
export function profitHeat(pnl: number, cost: number): number {
  if (!(pnl > 0) || !(cost > 0)) return 0;
  return Math.min(1, pnl / cost / HOT_PROFIT + getHype() * 0.4);
}

export function hotProps(level: number, base = ''): { className: string; style?: CSSProperties } {
  if (level < 0.04) return { className: base };
  return { className: `${base}${base ? ' ' : ''}fx-hot`, style: { '--hot': level.toFixed(2) } as CSSProperties };
}
