/**
 * Game days <-> the time axis of lightweight-charts.
 *
 * The chart wants calendar times, the game has "trading day N of quarter Q". We place quarter q on
 * the fake calendar year BASE_YEAR + q, one game day per calendar day from January 1st. The chart
 * spaces bars by index (not by time), so the gap between "years" is invisible, and its strongest
 * tick marks (year starts) land exactly on quarter starts. Labels are then translated back
 * ("Q2", "D31", "Q2 D17"), so no real date ever shows.
 *
 * Quarters longer than a year (only possible with an exotic config) fall back to one game day per
 * calendar day from the epoch; labels stay correct, only the tick mark placement is less neat.
 */
import { dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { GameConfig } from '@tg/shared';

const SECONDS_PER_DAY = 86_400;
const BASE_YEAR = 2000;
const MAX_DAYS_PER_FAKE_YEAR = 365;

const fitsFakeYears = (daysPerQuarter: number) => daysPerQuarter >= 1 && daysPerQuarter <= MAX_DAYS_PER_FAKE_YEAR;

/** Chart time (UTC seconds) of a 0-based game day. Strictly increasing in `day`. */
export function dayToChartTime(config: GameConfig, day: number): number {
  const perQuarter = config.time.daysPerQuarter;
  if (!fitsFakeYears(perQuarter)) return day * SECONDS_PER_DAY;
  const quarter = dayToQuarter(config, day);
  const offset = day - (quarter - 1) * perQuarter;
  return Date.UTC(BASE_YEAR + quarter, 0, 1) / 1000 + offset * SECONDS_PER_DAY;
}

/** Inverse of dayToChartTime. */
export function chartTimeToDay(config: GameConfig, time: number): number {
  const perQuarter = config.time.daysPerQuarter;
  if (!fitsFakeYears(perQuarter)) return Math.round(time / SECONDS_PER_DAY);
  const year = new Date(time * 1000).getUTCFullYear();
  const offset = Math.round((time - Date.UTC(year, 0, 1) / 1000) / SECONDS_PER_DAY);
  return (year - BASE_YEAR - 1) * perQuarter + offset;
}

/** "Q2 D17": quarter and 1-based day within it. */
export function formatGameDay(config: GameConfig, day: number): string {
  return `Q${dayToQuarter(config, day)} D${dayOfQuarter(config, day)}`;
}

/** Axis label: just the quarter at a quarter start, else just the day within the quarter. */
export function formatAxisDay(config: GameConfig, day: number): string {
  const ofQuarter = dayOfQuarter(config, day);
  return ofQuarter === 1 ? `Q${dayToQuarter(config, day)}` : `D${ofQuarter}`;
}
