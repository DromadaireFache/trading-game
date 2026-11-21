/**
 * Hype: how well the player is doing, 0 (at or below the start) to 1 (HYPE_MAX_MULTIPLE times the
 * starting money), on a log scale so early gains already show. Effects scale with it: CSS reads
 * --hype (0..1) and data-hype (0..3) on <html>; effect code calls getHype().
 * Quantized to HYPE_STEP so the root style changes rarely (a root custom property restyles the page).
 */
import { useEffect } from 'react';
import { useGame } from '../../net/GameProvider.tsx';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';

export const HYPE_MAX_MULTIPLE = 3;
const HYPE_STEP = 0.05;

let hype = 0;

export function getHype(): number {
  return hype;
}

export function hypeOf(equity: number, startingCash: number): number {
  if (!(equity > 0) || !(startingCash > 0)) return 0;
  const raw = Math.log(equity / startingCash) / Math.log(HYPE_MAX_MULTIPLE);
  return Math.max(0, Math.min(1, raw));
}

function publish(value: number): void {
  const stepped = Math.round(value / HYPE_STEP) * HYPE_STEP;
  if (stepped === hype) return;
  hype = stepped;
  const root = document.documentElement;
  root.style.setProperty('--hype', stepped.toFixed(2));
  root.dataset.hype = String(stepped >= 0.75 ? 3 : stepped >= 0.4 ? 2 : stepped >= 0.1 ? 1 : 0);
}

/** Mounted once on /play: keeps --hype in step with the player's net worth. */
export function HypeMeter(): null {
  const live = useLivePortfolio();
  const { config } = useGame();
  const equity = live?.equity ?? config.economy.startingCash;
  useEffect(() => publish(hypeOf(equity, config.economy.startingCash)), [equity, config.economy.startingCash]);
  useEffect(() => () => publish(0), []);
  return null;
}
