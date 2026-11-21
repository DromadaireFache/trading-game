import { unrealizedPnl } from '@tg/shared';
import type { Position } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import './trading.css';

/**
 * Your money: net worth as the big score number, how far you are from the start, and your open bets
 * (UP / DOWN, what each is worth now and what it made). Click a bet to look at it; x cashes it out.
 */
export function PositionsPanel({ className }: { className?: string }) {
  const live = useLivePortfolio();
  const { config } = useGame();

  if (live === null) {
    return (
      <Panel title="Your money" className={className}>
        <Placeholder>Your money shows up when the game starts.</Placeholder>
      </Panel>
    );
  }

  const pnlFraction = live.totalPnl / config.economy.startingCash;
  const positions = [...live.portfolio.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    <Panel title="Your money" className={`positions${className ? ` ${className}` : ''}`}>
      {live.portfolio.eliminated && (
        <div className="positions__out" data-testid="eliminated">
          OUT! Your money fell below {formatMoneyShort(config.economy.eliminationEquity)}. You can still watch.
        </div>
      )}
      <div className="positions__score" title="Net worth = cash + what your bets are worth now. Highest at the end wins.">
        <span className="positions__worth" data-testid="equity">
          {formatMoney(live.equity)}
        </span>
        <span className={`positions__pnl change--${changeDirection(pnlFraction)}`} data-testid="total-pnl" title="Since the start of the game">
          {formatMoney(live.totalPnl, true)} ({formatPercent(pnlFraction)})
        </span>
      </div>
      <div className="positions__sub">
        <span title="Money not in a bet (negative = borrowed)">
          Cash <strong data-testid="cash">{formatMoney(live.portfolio.cash)}</strong>
        </span>
        <span title="Total size of all your bets">
          In bets <strong>{formatMoneyShort(live.gross)}</strong>
        </span>
      </div>
      {positions.length === 0 ? (
        <div className="positions__empty">No bets yet. Pick a stock and bet UP or DOWN.</div>
      ) : (
        <table className="positions__table" data-testid="positions">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Bet</th>
              <th>Worth</th>
              <th>Profit</th>
              <th aria-label="Cash out" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <PositionRow key={p.symbol} position={p} decimals={config.market.priceDecimals} canTrade={!live.portfolio.eliminated} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function PositionRow({ position, decimals, canTrade }: { position: Position; decimals: number; canTrade: boolean }) {
  const client = useGameClient();
  const market = useMarketStore();
  const { phase } = useGame();
  const selected = useSelectedSymbol() === position.symbol;
  const quote = useQuote(position.symbol);
  const last = quote?.price ?? position.avgPrice;
  const pnl = unrealizedPnl(position, last);
  const cost = Math.abs(position.qty) * position.avgPrice;
  const pnlFraction = cost > 0 ? pnl / cost : 0;
  const open = phase?.phase === 'TRADING' && canTrade;
  const up = position.qty > 0;

  return (
    <tr
      className={`positions__row${selected ? ' positions__row--selected' : ''}`}
      onClick={() => market.select(position.symbol)}
      title={`${formatShares(Math.abs(position.qty))} shares, bought at $${formatPrice(position.avgPrice, decimals)}, now $${formatPrice(last, decimals)}`}
      data-testid="position-row"
      data-symbol={position.symbol}
    >
      <td className="positions__sym">{position.symbol}</td>
      <td>
        <span className={`positions__dir positions__dir--${up ? 'up' : 'down'}`} data-testid="position-qty" data-qty={position.qty}>
          {up ? '▲' : '▼'} {formatShares(position.qty)}
        </span>
      </td>
      <td>{formatMoneyShort(Math.abs(position.qty) * last)}</td>
      <td className={`positions__profit change--${changeDirection(pnlFraction)}`} title={formatPercent(pnlFraction)}>
        {pnl >= 0 ? '+' : ''}
        {formatMoneyShort(pnl)}
      </td>
      <td>
        <button
          type="button"
          className="positions__close"
          disabled={!open}
          title={`Cash out ${position.symbol}`}
          onClick={(e) => {
            e.stopPropagation();
            client.send({ t: 'order', symbol: position.symbol, qty: -position.qty });
          }}
          data-testid="position-close"
        >
          ×
        </button>
      </td>
    </tr>
  );
}
