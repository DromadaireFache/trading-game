/**
 * The moment a bet goes in: chips fly out of the button in its color, more for a bigger stake and for
 * a player who is doing well (hype); a big stake also shakes the table.
 */
import { fx, reducedMotion } from './fx.ts';
import { getHype } from './hype.ts';

export function betBurst(button: HTMLElement, up: boolean, share: number): void {
  if (reducedMotion()) return;
  const r = button.getBoundingClientRect();
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // 0.5 of the buying power is a full-size bet.
  const size = Math.min(1, share * 2);
  const hype = getHype();
  fx.burst({ ...at, tone: up ? 'up' : 'down', count: Math.round(8 + 24 * size + 24 * hype), power: 3 + 4 * size + 3 * hype });
  if (size >= 0.5) fx.shake(1, 0.3 + 0.7 * size + 0.8 * hype);
}
