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

/** Quick-size share of your money as a short label: 10%, 25%, ½, ALL. */
function shareLabel(pct: number): string {
  if (pct >= 1) return 'ALL';
  if (pct === 0.5) return '½';
  return `${Math.round(pct * 100)}%`;
}

/**
 * Place a bet on the selected stock, in plain words: UP (buy) or DOWN (sell short), then one click on
 * an amount sends a market order. "Cash out" closes half or all of what you hold. The server fills in
 * arrival order and clips an order to the leverage cap rather than refusing it.
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
      <Panel title="Place a bet" className={className}>
        <Placeholder>Betting opens when the game starts.</Placeholder>
      </Panel>
    );
  }

  const decimals = config.market.priceDecimals;
  const cap = config.trading.leverageCap;
  const eliminated = live.portfolio.eliminated === true;
  const open = phase?.phase === 'TRADING';
  const price = quote?.price ?? 0;
  const disabled = !open || eliminated || price <= 0;
  const held = live.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const sign = side === 'buy' ? 1 : -1;
  const info = market.getInfo(symbol);

  const send = (qty: number) => {
    if (qty !== 0) client.send({ t: 'order', symbol, qty });
  };
  const sendNotional = (notional: number) => send(sign * sharesForNotional(notional, price));

  const status = eliminated ? 'You are out of the game.' : open ? null : 'Betting is closed until the market opens.';
  const risk = Number.isFinite(live.leverage) ? Math.min(1, live.leverage / cap) : 1;
  const riskLevel = risk < 0.5 ? 'low' : risk < 0.85 ? 'mid' : 'high';
  const verb = side === 'buy' ? 'Bet UP on' : 'Bet DOWN on';

  return (
    <Panel
      title="Place a bet"
      aside={
        <span className="order__on" title={info?.name}>
          {symbol} <strong>${price > 0 ? formatPrice(price, decimals) : '--'}</strong>
        </span>
      }
      className={`order${className ? ` ${className}` : ''}`}
    >
      <div className="order__sides" role="radiogroup" aria-label="Which way">
        <button
          type="button"
          className={`order__side order__side--buy${side === 'buy' ? ' order__side--on' : ''}`}
          aria-pressed={side === 'buy'}
          onClick={() => setSide('buy')}
          title="You win if the price goes up. (Buys shares; also closes a DOWN bet.)"
          data-testid="side-buy"
        >
          <span className="order__side-main">▲ Bet up</span>
          <span className="order__side-sub">it will rise</span>
        </button>
        <button
          type="button"
          className={`order__side order__side--sell${side === 'sell' ? ' order__side--on' : ''}`}
          aria-pressed={side === 'sell'}
          onClick={() => setSide('sell')}
          title="You win if the price goes down. (Sells short; also sells an UP bet you hold.)"
          data-testid="side-sell"
        >
          <span className="order__side-main">▼ Bet down</span>
          <span className="order__side-sub">it will fall</span>
        </button>
      </div>

      <div className="order__row">
        <span className="order__label">How much</span>
        {config.trading.quickSizeUsd.map((usd) => (
          <button
            key={usd}
            type="button"
            className={`order__size order__size--${side}`}
            disabled={disabled}
            onClick={() => sendNotional(usd)}
            title={`${verb} ${symbol} with ${formatMoney(usd)}`}
            data-testid={`size-usd-${usd}`}
          >
            {formatMoneyShort(usd).replace('.0', '')}
          </button>
        ))}
      </div>
      <div className="order__row">
        <span className="order__label" title="A share of the money you can bet right now">Of my money</span>
        {config.trading.quickSizePct.map((pct) => (
          <button
            key={pct}
            type="button"
            className={`order__size order__size--${side}`}
            disabled={disabled || live.buyingPower <= 0}
            onClick={() => sendNotional(pct * live.buyingPower)}
            title={`${verb} ${symbol} with ${formatMoney(pct * live.buyingPower)}`}
            data-testid={`size-pct-${Math.round(pct * 100)}`}
          >
            {shareLabel(pct)}
          </button>
        ))}
      </div>

      <div className="order__held-row">
        <span
          className={`order__held${held > 0 ? ' order__held--up' : held < 0 ? ' order__held--down' : ''}`}
          data-testid="order-held"
          title={held === 0 ? undefined : `${formatShares(Math.abs(held))} shares`}
        >
          {held === 0
            ? `No bet on ${symbol} yet`
            : `${held > 0 ? '▲ UP' : '▼ DOWN'} · ${formatMoneyShort(Math.abs(held) * price)}`}
        </span>
        <button type="button" className="order__cash" disabled={disabled || Math.abs(held) < 2} onClick={() => send(-Math.trunc(held / 2))} data-testid="order-half" title="Close half of this bet">
          Cash out ½
        </button>
        <button type="button" className="order__cash" disabled={disabled || held === 0} onClick={() => send(-held)} data-testid="order-close" title="Close this bet and keep what it made (or lost)">
          Cash out
        </button>
      </div>

      <div className="order__facts">
        <div className="order__can" title={`You can bet up to ${cap}× your net worth: the extra is borrowed (leverage).`}>
          <span className="order__fact-label">Can bet</span>{' '}
          <span className="order__fact-value" data-testid="buying-power">
            {formatMoney(live.buyingPower)}
          </span>
        </div>
        <div
          className={`order__risk order__risk--${riskLevel}`}
          title={`Risk = how much you borrowed (${Number.isFinite(live.leverage) ? live.leverage.toFixed(1) : '--'}× of the ${cap}× limit). Borrowing makes wins and losses bigger. If losses eat too much of your money, the bank closes your biggest bet (margin call); below ${formatMoneyShort(config.economy.eliminationEquity)} you are out.`}
        >
          <span className="order__fact-label">Risk</span>
          <span className="order__risk-bar" aria-hidden="true">
            <span className="order__risk-fill" style={{ transform: `scaleX(${risk})` }} />
          </span>
        </div>
      </div>

      {status !== null && <div className="order__status">{status}</div>}
      {fills[0] !== undefined && <LastFill key={fills[0].seq} fill={fills[0]} decimals={decimals} />}
    </Panel>
  );
}

function LastFill({ fill, decimals }: { fill: Omit<FillMsg, 't'>; decimals: number }) {
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
