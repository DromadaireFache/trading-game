import { Panel, Placeholder } from '../../components/Panel.tsx';
import { formatMoney, formatMoneyShort, formatPrice } from '../../lib/format.ts';
import { useQuickBet } from '../../lib/quickBet.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { betBurst } from '../fx/betFx.ts';
import { JailOrderNotice } from './JailOrderNotice.tsx';
import './trading.css';

/**
 * Bet on the selected stock in one tap: six buttons, each an amount of money. Green ▲ bets the price
 * goes up (buys), red ▼ bets it goes down (sells short). The amounts are config.trading.quickBetStakes
 * of the money you can bet right now. A bet stays open until you cash it out in Your positions (or a
 * margin call does).
 */
export function OrderPanel({ className }: { className?: string }) {
  const { phase, config, pendingOrder } = useGame();
  const market = useMarketStore();
  const symbol = useSelectedSymbol();
  const quote = useQuote(symbol);
  const live = useLivePortfolio();
  const { bet } = useQuickBet();

  if (live === null || symbol === null) {
    return (
      <Panel title="Place a bet" className={`order${className ? ` ${className}` : ''}`}>
        <Placeholder>Betting opens when the game starts.</Placeholder>
      </Panel>
    );
  }

  const price = quote?.price ?? 0;
  const eliminated = live.portfolio.eliminated === true;
  const open = phase?.phase === 'TRADING' && !eliminated && price > 0;
  // A Freeze card: no orders until the game day it thaws.
  const frozen = (live.portfolio.frozenUntil ?? -1) > market.getLastDay();
  const canBet = open && !frozen && live.buyingPower > 0 && pendingOrder === null;
  const info = market.getInfo(symbol);
  const stakes = config.trading.quickBetStakes;

  return (
    <Panel
      title="Place a bet"
      aside={
        <span className="order__on">
          {info?.name ?? symbol} <strong>${price > 0 ? formatPrice(price, config.market.priceDecimals) : '--'}</strong>
        </span>
      }
      className={`order${frozen ? ' order--frozen' : ''}${className ? ` ${className}` : ''}`}
    >
      <JailOrderNotice />
      {frozen && (
        <div className="order__frozen" data-testid="frozen">
          FROZEN
        </div>
      )}
      <div className="bet-grid" data-testid="bet-grid">
        {([true, false] as const).map((up) =>
          stakes.map((share, i) => {
            const usd = live.buyingPower * share;
            return (
              <button
                key={`${up}-${share}`}
                type="button"
                className={`bet-btn bet-btn--${up ? 'up' : 'down'}`}
                disabled={!canBet}
                onClick={(event) => {
                  const button = event.currentTarget;
                  if (bet(button, symbol, up, share)) betBurst(button, up, share);
                }}
                data-testid={`bet-${up ? 'up' : 'down'}-${i}`}
                data-share={share}
              >
                <span className="bet-btn__arrow" aria-hidden="true">
                  {up ? '▲' : '▼'}
                </span>
                {formatMoneyShort(usd)}
              </button>
            );
          }),
        )}
      </div>
    </Panel>
  );
}
