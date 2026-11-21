import type { FillMsg } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { formatMoney, formatMoneyShort, formatPrice, formatShares } from '../../lib/format.ts';
import { useQuickBet } from '../../lib/quickBet.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { sendOrder } from '../fx/buttonFx.ts';
import { JailOrderNotice } from './JailOrderNotice.tsx';
import './trading.css';

/**
 * Bet on the selected stock in one tap: six buttons, each an amount of money. Green ▲ bets the price
 * goes up (buys), red ▼ bets it goes down (sells short). The amounts are config.trading.quickBetStakes
 * of the money you can bet right now. A bet stays open until you cash it out (or a margin call does).
 */
export function OrderPanel({ className }: { className?: string }) {
  const { phase, config, fills, pendingOrder } = useGame();
  const client = useGameClient();
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
  const canBet = open && live.buyingPower > 0 && pendingOrder === null;
  const info = market.getInfo(symbol);
  const held = live.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const stakes = config.trading.quickBetStakes;

  return (
    <Panel
      title="Place a bet"
      aside={
        <span className="order__on" title={info?.name}>
          {info?.name ?? symbol} <strong>${price > 0 ? formatPrice(price, config.market.priceDecimals) : '--'}</strong>
        </span>
      }
      className={`order${className ? ` ${className}` : ''}`}
    >
      <JailOrderNotice />
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
                onClick={(event) => bet(event.currentTarget, symbol, up, share)}
                title={`Bet ${formatMoney(usd)} that ${info?.name ?? symbol} goes ${up ? 'up' : 'down'}`}
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
      {held !== 0 ? (
        <div className="order__held-row">
          <span className={`order__held order__held--${held > 0 ? 'up' : 'down'}`} data-testid="order-held">
            {held > 0 ? '▲ UP' : '▼ DOWN'} · {formatMoneyShort(Math.abs(held) * price)}
          </span>
          <span />
          <button
            type="button"
            className="order__cash order__cash--primary"
            disabled={!open || pendingOrder !== null}
            onClick={(event) => sendOrder(client, event.currentTarget, symbol, -held)}
            title="Close this bet and keep what it made (or lost)"
            data-testid="order-close"
          >
            Cash out
          </button>
        </div>
      ) : (
        <div className="order__note" data-testid="order-held">
          {eliminated ? 'You are out of the game.' : open ? 'No bet on this stock yet.' : 'Betting opens when the market opens.'}
        </div>
      )}
      {fills[0] !== undefined && <LastFill key={fills[0].seq} fill={fills[0]} decimals={config.market.priceDecimals} />}
    </Panel>
  );
}

export function LastFill({ fill, decimals }: { fill: Omit<FillMsg, 't'>; decimals: number }) {
  const bought = fill.qty > 0;
  const forced = fill.reason === 'margin_call' ? 'MARGIN CALL: ' : fill.reason === 'elimination' ? 'OUT: ' : '';
  return (
    <div
      className={`order__fill${forced ? ' order__fill--forced' : ''}`}
      data-testid="last-fill"
      title={forced ? 'The bank closed this bet for you because your losses got too big.' : undefined}
    >
      {forced}
      <span className={bought ? 'change--up' : 'change--down'}>{bought ? 'Bought' : 'Sold'}</span> {formatShares(Math.abs(fill.qty))}{' '}
      {fill.symbol} @ ${formatPrice(fill.price, decimals)}
    </div>
  );
}
