/**
 * React bindings for the MarketStore. Each hook subscribes to one narrow slice, so a price tick
 * re-renders only the rows / headers of the symbols that moved.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { SymbolId, SymbolInfo } from '@tg/shared';
import { useGameClient } from './GameProvider.tsx';
import type { MarketStore, Quote } from './marketStore.ts';

export function useMarketStore(): MarketStore {
  return useGameClient().market;
}

/** All symbols in canonical order; empty until the `market` snapshot arrives. */
export function useSymbols(): readonly SymbolInfo[] {
  const market = useMarketStore();
  return useSyncExternalStore(market.subscribeUniverse, market.getSymbols);
}

/** Price and quarter-open reference of one symbol; undefined while unknown. */
export function useQuote(symbol: SymbolId | null): Quote | undefined {
  const market = useMarketStore();
  const subscribe = useCallback(
    (listener: () => void) => (symbol === null ? () => {} : market.subscribeSymbol(symbol, listener)),
    [market, symbol],
  );
  return useSyncExternalStore(subscribe, () => (symbol === null ? undefined : market.getQuote(symbol)));
}

/** The latest trading day with data (-1 before the first tick); re-renders once per day, not per tick. */
export function useLastDay(): number {
  const market = useMarketStore();
  return useSyncExternalStore(market.subscribeFeed, () => market.getLastDay());
}

/** The symbol selected in the list (shared by chart, header and later the order panel). */
export function useSelectedSymbol(): SymbolId | null {
  const market = useMarketStore();
  return useSyncExternalStore(market.subscribeSelection, market.getSelected);
}
