/**
 * How much detail a player wants on screen. Per player and per browser (localStorage), the game rules
 * are the same in every mode:
 *   simple  casual players: company names, the core bet buttons, risk in words
 *   normal  the full desk in plain words
 *   pro     everything, plus the raw numbers (shares, average price, leverage, policy rate)
 * The mode is also written to <html data-mode="..."> so CSS can hide things without JS.
 */
import { useSyncExternalStore } from 'react';

export type UiMode = 'simple' | 'normal' | 'pro';
export const UI_MODES: readonly UiMode[] = ['simple', 'normal', 'pro'];
export const DEFAULT_UI_MODE: UiMode = 'simple';

export const UI_MODE_INFO: Record<UiMode, { label: string; blurb: string }> = {
  simple: { label: 'Simple', blurb: 'Just the basics: pick a company, bet up or down, follow the news.' },
  normal: { label: 'Normal', blurb: 'The full desk: risk, coming events, earnings.' },
  pro: { label: 'Pro', blurb: 'Every number: tickers, shares, average prices, leverage, interest rate.' },
};

const KEY = 'tg.uiMode';
const listeners = new Set<() => void>();

function read(): UiMode {
  try {
    const stored = localStorage.getItem(KEY);
    return UI_MODES.includes(stored as UiMode) ? (stored as UiMode) : DEFAULT_UI_MODE;
  } catch {
    return DEFAULT_UI_MODE;
  }
}

let current: UiMode = typeof window === 'undefined' ? DEFAULT_UI_MODE : read();

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.mode = current;
}
apply();

export function getUiMode(): UiMode {
  return current;
}

export function setUiMode(mode: UiMode): void {
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // storage blocked: the mode just does not survive a reload
  }
  apply();
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribe, getUiMode, () => DEFAULT_UI_MODE);
}
