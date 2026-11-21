import type { NetWorthSample } from '@tg/shared';
import { theme } from '../theme.ts';

const COLORS = [theme.color.accent, theme.color.info, theme.color.up, theme.color.sectorHealth, theme.color.sectorFinance, theme.color.warn] as const;
export const playerColor = (index: number) => COLORS[index % COLORS.length]!;

export function fitWorthRange(samples: readonly NetWorthSample[]) {
  let min = Infinity;
  let max = -Infinity;
  for (const { equity } of samples) {
    for (const value of Object.values(equity)) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (min > max) return null;
  const padding = Math.max(1, (max - min) * 0.12, Math.max(Math.abs(min), Math.abs(max)) * 0.001);
  return { from: min - padding, to: max + padding };
}
