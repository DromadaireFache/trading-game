/**
 * Live portfolio values. The server sends `portfolio` on every fill and once per trading day; in
 * between, equity, buying power and P&L are recomputed here from the 10 Hz ticks with the same
 * formula the server enforces (valuePortfolio in @tg/shared). Only the symbols the player holds are
 * subscribed, so a tick of anything else does not re-render.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { valuePortfolio } from '@tg/shared';
import type { PortfolioValue, Position } from '@tg/shared';
import { useGame } from './GameProvider.tsx';
import { useMarketStore } from './marketHooks.ts';
import type { Portfolio } from './state.ts';

const NO_POSITIONS: readonly Position[] = [];

export interface LivePortfolio extends PortfolioValue {
  portfolio: Portfolio;
  /** equity - starting cash. */
  totalPnl: number;
}

export function useLivePortfolio(): LivePortfolio | null {
  const { portfolio, config } = useGame();
  const market = useMarketStore();
  const positions = portfolio?.positions ?? NO_POSITIONS;
  const symbolsKey = positions.map((p) => p.symbol).join(',');

  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = symbolsKey === '' ? [] : symbolsKey.split(',').map((s) => market.subscribeSymbol(s, listener));
      return () => offs.forEach((off) => off());
    },
    [market, symbolsKey],
  );
  // A string snapshot: equal prices compare equal, so unrelated renders are skipped.
  const pricesKey = useSyncExternalStore(subscribe, () =>
    symbolsKey === '' ? '' : symbolsKey.split(',').map((s) => market.getQuote(s)?.price ?? '').join(','),
  );

  return useMemo(() => {
    if (portfolio === null) return null;
    const value = valuePortfolio(config, portfolio.cash, portfolio.positions, (s) => market.getQuote(s)?.price);
    return { ...value, portfolio, totalPnl: value.equity - config.economy.startingCash };
    // pricesKey stands for the quotes read inside the memo.
  }, [portfolio, config, market, pricesKey]);
}
