/**
 * Quick bets (Simple mode): one tap = a bet UP or DOWN on a company with a fixed stake (Small /
 * Medium / Big = config.trading.quickBetStakes of the money you can bet). The server cashes it out by
 * itself after config.trading.quickBetDays trading days (or at the quarter's close), and sends a
 * `bet_result` with the profit and the win streak.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { sharesForNotional, valuePortfolio } from '@tg/shared';
import type { SymbolId } from '@tg/shared';
import { useGame, useGameClient } from '../net/GameProvider.tsx';
import { useMarketStore } from '../net/marketHooks.ts';

export const STAKE_LABELS = ['Small', 'Medium', 'Big'] as const;

const KEY = 'tg.stake';
const listeners = new Set<() => void>();
let stake = (() => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n >= 0 && n < STAKE_LABELS.length ? n : 1;
  } catch {
    return 1;
  }
})();

export function setStake(index: number): void {
  if (index === stake) return;
  stake = index;
  try {
    localStorage.setItem(KEY, String(index));
  } catch {
    // storage blocked: the choice just does not survive a reload
  }
  for (const listener of [...listeners]) listener();
}

/** Index into config.trading.quickBetStakes (0 = Small). */
export function useStake(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => stake,
  );
}

/**
 * Returns `bet(symbol, up)`: places a quick bet with the chosen stake, or does nothing (returns false)
 * when it cannot (no money to bet, no price). The stake is computed at the moment of the click, so this
 * hook does not follow the 10 Hz prices (one per panel, never one per row).
 */
export function useQuickBet(): { bet: (symbol: SymbolId, up: boolean) => boolean; days: number; ready: boolean } {
  const client = useGameClient();
  const market = useMarketStore();
  const { config, portfolio } = useGame();
  const index = useStake();
  const share = config.trading.quickBetStakes[index] ?? config.trading.quickBetStakes[0] ?? 0.1;
  const days = config.trading.quickBetDays;
  const bet = useCallback(
    (symbol: SymbolId, up: boolean) => {
      if (portfolio === null) return false;
      const { buyingPower } = valuePortfolio(config, portfolio.cash, portfolio.positions, (s) => market.getQuote(s)?.price);
      const qty = sharesForNotional(buyingPower * share, market.getQuote(symbol)?.price ?? 0);
      if (qty <= 0) return false;
      return client.send({ t: 'order', symbol, qty: up ? qty : -qty, holdDays: days });
    },
    [client, market, config, portfolio, share, days],
  );
  return { bet, days, ready: portfolio !== null && portfolio.eliminated !== true };
}
