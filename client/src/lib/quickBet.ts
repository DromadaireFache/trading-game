/**
 * Quick bets: one tap = a bet UP or DOWN on the selected stock with a share of the money you can bet
 * (config.trading.quickBetStakes, e.g. 10% / 25% / 50%). It is a plain market order: the position stays
 * open until the player cashes it out or a margin call closes it.
 */
import { useCallback } from 'react';
import { sharesForNotional, valuePortfolio } from '@tg/shared';
import type { SymbolId } from '@tg/shared';
import { useGame, useGameClient } from '../net/GameProvider.tsx';
import { useMarketStore } from '../net/marketHooks.ts';
import { sendOrder } from '../features/fx/buttonFx.ts';

/**
 * Places a quick bet of `share` of the buying power, or does nothing (returns false) when it cannot
 * (no money to bet, no price). The amount is computed at the moment of the click from the latest
 * prices, so it matches what the button showed.
 */
export function useQuickBet(): { bet: (button: HTMLButtonElement, symbol: SymbolId, up: boolean, share: number) => boolean } {
  const client = useGameClient();
  const market = useMarketStore();
  const { config, portfolio } = useGame();
  const bet = useCallback(
    (button: HTMLButtonElement, symbol: SymbolId, up: boolean, share: number) => {
      if (portfolio === null) return false;
      const { buyingPower } = valuePortfolio(config, portfolio.cash, portfolio.positions, (s) => market.getQuote(s)?.price);
      const qty = sharesForNotional(buyingPower * share, market.getQuote(symbol)?.price ?? 0);
      if (qty <= 0) return false;
      return sendOrder(client, button, symbol, up ? qty : -qty);
    },
    [client, market, config, portfolio],
  );
  return { bet };
}
