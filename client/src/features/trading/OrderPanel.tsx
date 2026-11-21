import { useState } from 'react';
import { sharesForNotional } from '@tg/shared';
import type { FillMsg } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { formatMoney, formatMoneyShort, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import './trading.css';

type Side = 'buy' | 'sell';

/**
 * Market orders on the selected symbol. Pick a side, then one click on a quick-size button sends the
 * order: a share of buying power, or a fixed dollar amount. Half / Close act on the position held.
 * The server fills in arrival order and may clip an order to the leverage cap.
 */
export function OrderPanel({ className }: { className?: string }) {
  const { phase, config, fills } = useGame();
  const client = useGameClient();
  const market = useMarketStore();
  const symbol = useSelectedSymbol();
  const quote = useQuote(symbol);
  const live = useLivePortfolio();
  const [side, setSide] = useState<Side>('buy');

  if (live === null || symbol === null) {
    return (
      <Panel title="Order entry" aside="market orders" className={className}>
        <Placeholder>Trading opens when the game starts.</Placeholder>
      </Panel>
    );
  }

  const decimals = config.market.priceDecimals;
  const eliminated = live.portfolio.eliminated === true;
  const open = phase?.phase === 'TRADING';
  const price = quote?.price ?? 0;
  const disabled = !open || eliminated || price <= 0;
  const held = live.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const sign = side === 'buy' ? 1 : -1;

  const send = (qty: number) => {
    if (qty !== 0) client.send({ t: 'order', symbol, qty });
  };
  const sendNotional = (notional: number) => send(sign * sharesForNotional(notional, price));

  const status = eliminated ? 'Eliminated: you are out of the game.' : open ? null : 'Market closed until the next TRADING phase.';

  return (
    <Panel
      title="Order entry"
      aside={<span title={market.getInfo(symbol)?.name}>{symbol} @ {price > 0 ? formatPrice(price, decimals) : '--'}</span>}
      className={`order${className ? ` ${className}` : ''}`}
    >
      <div className="order__sides" role="radiogroup" aria-label="Side">
        <button
          type="button"
          className={`order__side order__side--buy${side === 'buy' ? ' order__side--on' : ''}`}
          aria-pressed={side === 'buy'}
          onClick={() => setSide('buy')}
          data-testid="side-buy"
        >
          Buy / cover
        </button>
        <button
          type="button"
          className={`order__side order__side--sell${side === 'sell' ? ' order__side--on' : ''}`}
          aria-pressed={side === 'sell'}
          onClick={() => setSide('sell')}
          data-testid="side-sell"
        >
          Sell / short
        </button>
      </div>

      <div className="order__row">
        <span className="order__label">% power</span>
        {config.trading.quickSizePct.map((pct) => (
          <button
            key={pct}
            type="button"
            className={`order__size order__size--${side}`}
            disabled={disabled || live.buyingPower <= 0}
            onClick={() => sendNotional(pct * live.buyingPower)}
            title={`${side === 'buy' ? 'Buy' : 'Sell'} ${formatMoney(pct * live.buyingPower)} of ${symbol}`}
            data-testid={`size-pct-${Math.round(pct * 100)}`}
          >
            {Math.round(pct * 100)}%
          </button>
        ))}
      </div>
      <div className="order__row">
        <span className="order__label">$ amount</span>
        {config.trading.quickSizeUsd.map((usd) => (
          <button
            key={usd}
            type="button"
            className={`order__size order__size--${side}`}
            disabled={disabled}
            onClick={() => sendNotional(usd)}
            title={`${side === 'buy' ? 'Buy' : 'Sell'} ${formatMoney(usd)} of ${symbol}`}
            data-testid={`size-usd-${usd}`}
          >
            {formatMoneyShort(usd).replace('.0', '')}
          </button>
        ))}
      </div>
      <div className="order__row">
        <span className="order__label">Holding</span>
        <span className={`order__held${held > 0 ? ' change--up' : held < 0 ? ' change--down' : ''}`} data-testid="order-held">
          {held === 0 ? 'none' : `${formatShares(held)} sh`}
        </span>
        <button type="button" className="order__size" disabled={disabled || Math.abs(held) < 2} onClick={() => send(-Math.trunc(held / 2))} data-testid="order-half">
          Half
        </button>
        <button type="button" className="order__size" disabled={disabled || held === 0} onClick={() => send(-held)} data-testid="order-close">
          Close
        </button>
      </div>

      <dl className="order__facts">
        <div>
          <dt>Buying power</dt>
          <dd data-testid="buying-power">{formatMoney(live.buyingPower)}</dd>
        </div>
        <div>
          <dt>Leverage</dt>
          <dd className={live.leverage > config.trading.leverageCap ? 'change--down' : undefined}>
            {Number.isFinite(live.leverage) ? `${live.leverage.toFixed(2)}x` : '--'} / {config.trading.leverageCap}x
          </dd>
        </div>
      </dl>

      {status !== null && <div className="order__status">{status}</div>}
      {fills[0] !== undefined && <LastFill key={fills[0].seq} fill={fills[0]} decimals={decimals} />}
    </Panel>
  );
}

function LastFill({ fill, decimals }: { fill: Omit<FillMsg, 't'>; decimals: number }) {
  const bought = fill.qty > 0;
  const forced = fill.reason === 'margin_call' ? 'MARGIN CALL: ' : fill.reason === 'elimination' ? 'ELIMINATED: ' : '';
  return (
    <div className={`order__fill${forced ? ' order__fill--forced' : ''}`} data-testid="last-fill">
      {forced}
      <span className={bought ? 'change--up' : 'change--down'}>{bought ? 'Bought' : 'Sold'}</span> {formatShares(Math.abs(fill.qty))}{' '}
      {fill.symbol} @ {formatPrice(fill.price, decimals)}
    </div>
  );
}
