/**
 * Portfolio arithmetic shared by the sim (authoritative) and the client (live display between
 * `portfolio` messages). Pure. One formula on both sides, so the numbers a player sees are the
 * numbers the server enforces.
 *
 *   value of a position  = qty * price            (negative for a short)
 *   equity               = cash + sum(value)      (short proceeds sit in cash)
 *   gross exposure       = sum(|value|)
 *   buying power         = max(0, leverageCap * equity - gross)
 *   margin call          when gross > 0 and equity < maintenanceMargin * gross
 */
import type { GameConfig } from './config.ts';
import type { Position, SymbolId } from './types.ts';

export interface PortfolioValue {
  equity: number;
  gross: number;
  buyingPower: number;
  /** gross / equity; Infinity when equity <= 0 with open positions, 0 when flat. */
  leverage: number;
}

/** Positions valued at `priceOf`; a symbol without a price counts at its average entry price. */
export function valuePortfolio(
  config: GameConfig,
  cash: number,
  positions: readonly Pick<Position, 'symbol' | 'qty' | 'avgPrice'>[],
  priceOf: (symbol: SymbolId) => number | undefined,
): PortfolioValue {
  let equity = cash;
  let gross = 0;
  for (const p of positions) {
    const price = priceOf(p.symbol) ?? p.avgPrice;
    equity += p.qty * price;
    gross += Math.abs(p.qty) * price;
  }
  const buyingPower = Math.max(0, config.trading.leverageCap * equity - gross);
  const leverage = gross === 0 ? 0 : equity > 0 ? gross / equity : Infinity;
  return { equity, gross, buyingPower, leverage };
}

export function isMarginCall(config: GameConfig, value: Pick<PortfolioValue, 'equity' | 'gross'>): boolean {
  return value.gross > 0 && value.equity < config.trading.maintenanceMargin * value.gross;
}

/** Whole shares worth at most `notional` dollars at `price` (0 when the price is unusable). */
export function sharesForNotional(notional: number, price: number): number {
  if (!(price > 0) || !(notional > 0)) return 0;
  return Math.floor(notional / price);
}

/** Unrealized P&L of one position at `price`. */
export function unrealizedPnl(position: Pick<Position, 'qty' | 'avgPrice'>, price: number): number {
  return position.qty * (price - position.avgPrice);
}
