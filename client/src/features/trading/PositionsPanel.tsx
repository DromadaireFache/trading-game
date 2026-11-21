import { unrealizedPnl } from '@tg/shared';
import type { Position } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import './trading.css';

/** Cash, equity, total P&L, and one row per open position with live P&L. */
export function PositionsPanel({ className }: { className?: string }) {
  const live = useLivePortfolio();
  const { config } = useGame();

  if (live === null) {
    return (
      <Panel title="Positions" aside="cash / equity / P&L" className={className}>
        <Placeholder>Your portfolio appears when the game starts.</Placeholder>
      </Panel>
    );
  }

  const pnlFraction = live.totalPnl / config.economy.startingCash;
  const positions = [...live.portfolio.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    <Panel
      title="Positions"
      aside={
        <span className={`change--${changeDirection(pnlFraction)}`} data-testid="total-pnl">
          {formatMoney(live.totalPnl, true)} ({formatPercent(pnlFraction)})
        </span>
      }
      className={`positions${className ? ` ${className}` : ''}`}
    >
      {live.portfolio.eliminated && (
        <div className="positions__out" data-testid="eliminated">
          ELIMINATED. Equity fell below {formatMoneyShort(config.economy.eliminationEquity)}. You are out for good.
        </div>
      )}
      <dl className="positions__summary">
        <div>
          <dt>Equity</dt>
          <dd data-testid="equity">{formatMoney(live.equity)}</dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd data-testid="cash">{formatMoney(live.portfolio.cash)}</dd>
        </div>
        <div>
          <dt>Exposure</dt>
          <dd>{formatMoneyShort(live.gross)}</dd>
        </div>
      </dl>
      {positions.length === 0 ? (
        <div className="positions__empty">No open positions.</div>
      ) : (
        <table className="positions__table" data-testid="positions">
          <thead>
            <tr>
              <th>Sym</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>Last</th>
              <th>P&amp;L</th>
              <th aria-label="Close" />
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

  return (
    <tr
      className={`positions__row${selected ? ' positions__row--selected' : ''}`}
      onClick={() => market.select(position.symbol)}
      data-testid="position-row"
      data-symbol={position.symbol}
    >
      <td className="positions__sym">{position.symbol}</td>
      <td className={position.qty < 0 ? 'change--down' : undefined} data-testid="position-qty">
        {formatShares(position.qty)}
      </td>
      <td>{formatPrice(position.avgPrice, decimals)}</td>
      <td>{formatPrice(last, decimals)}</td>
      <td className={`change--${changeDirection(pnlFraction)}`} title={formatPercent(pnlFraction)}>
        {formatMoneyShort(pnl)}
      </td>
      <td>
        <button
          type="button"
          className="positions__close"
          disabled={!open}
          title={`Close ${position.symbol}`}
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
