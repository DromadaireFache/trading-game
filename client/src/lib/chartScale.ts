// At this magnitude even the smallest supported price tick (0.000001) changes the number.
// Lightweight Charts can loop when subtracting its tick step leaves a large value unchanged.
const MAX_CHART_VALUE = 1e9;

export const SCALED_CHART_MIN_MOVE = 0.001;

/** Grow the chart unit in powers of 1,000 so it only changes at magnitude thresholds. */
export function chartUnitFor(value: number, unit: number): number {
  if (!Number.isFinite(value)) return unit;
  while (Math.abs(value) / unit > MAX_CHART_VALUE) unit *= 1_000;
  return unit;
}
