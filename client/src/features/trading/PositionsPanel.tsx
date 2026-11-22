import { unrealizedPnl } from '@tg/shared';
import type { Position } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoneyShort, formatPercent, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { sendOrder } from '../fx/buttonFx.ts';
import { hotProps, profitHeat } from '../fx/hot.ts';
import { MoneyScore } from './MoneyScore.tsx';
import './trading.css';

/** Your money: net worth as the big score number and how far you are from the start. */
export function MoneyPanel({ className }: { className?: string }) {
  const live = useLivePortfolio();
  const { config } = useGame();

  if (live === null) {
    return (
      <Panel title="Your money" className={className}>
        <Placeholder>{null}</Placeholder>
      </Panel>
    );
  }

  const pnlFraction = live.totalPnl / config.economy.startingCash;
  return (
    <Panel title="Your money" className={`money${className ? ` ${className}` : ''}`}>
      {live.portfolio.eliminated && (
        <div className="positions__out" data-testid="eliminated">
          OUT! Your money fell below {formatMoneyShort(config.economy.eliminationEquity)}. You can still watch.
        </div>
      )}
      <div className="positions__score">
        <MoneyScore equity={live.equity} />{' '}
        <span className={`positions__pnl change--${changeDirection(pnlFraction)}`} data-testid="total-pnl">
          ({formatPercent(pnlFraction)})
        </span>
      </div>
    </Panel>
  );
}

/**
 * Your positions: every open bet (UP / DOWN, what it is worth now and what it made). A bet stays open
 * until you cash it out (x) or a margin call closes it. Click a row to look at that stock.
 */
export function PositionsPanel({ className }: { className?: string }) {
  const live = useLivePortfolio();
  const { config } = useGame();
  const market = useMarketStore();

  if (live === null) {
    return (
      <Panel title="Your positions" className={className}>
        <Placeholder>{null}</Placeholder>
      </Panel>
    );
  }

  const positions = [...live.portfolio.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return (
    <Panel
      title="Your positions"
      className={`positions${className ? ` ${className}` : ''}`}
    >
      {positions.length === 0 ? (
        <div className="positions__empty" />
      ) : (
        <div className="positions__scroll">
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
                <PositionRow key={p.symbol} position={p} decimals={config.market.priceDecimals} canTrade={!live.portfolio.eliminated && !locked(live.portfolio, market.getLastDay())} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PositionRow({ position, decimals, canTrade }: { position: Position; decimals: number; canTrade: boolean }) {
  const client = useGameClient();
  const market = useMarketStore();
  const { phase, pendingOrder } = useGame();
  const selected = useSelectedSymbol() === position.symbol;
  const quote = useQuote(position.symbol);
  const last = quote?.price ?? position.avgPrice;
  const pnl = unrealizedPnl(position, last);
  const cost = Math.abs(position.qty) * position.avgPrice;
  const pnlFraction = cost > 0 ? pnl / cost : 0;
  const open = phase?.phase === 'TRADING' && canTrade && pendingOrder === null;
  const up = position.qty > 0;
  // A winning bet's profit and its cash-out button shake, harder the more it made.
  const heat = profitHeat(pnl, cost);
  const hotProfit = hotProps(heat, `positions__profit-value`);
  const hotButton = hotProps(heat, 'game-button positions__close');

  return (
    <tr
      className={`positions__row positions__row--${up ? 'up' : 'down'}${selected ? ' positions__row--selected' : ''}`}
      onClick={() => market.select(position.symbol)}
      data-testid="position-row"
      data-symbol={position.symbol}
    >
      <td className="positions__sym">{position.symbol}</td>
      <td>
        <span className={`positions__dir positions__dir--${up ? 'up' : 'down'}`} data-testid="position-qty" data-qty={position.qty}>
          {up ? '▲ UP' : '▼ DOWN'}
        </span>
      </td>
      <td>{formatMoneyShort(Math.abs(position.qty) * last)}</td>
      <td className={`positions__profit change--${changeDirection(pnlFraction)}`}>
        <span className={hotProfit.className} style={hotProfit.style}>
          {pnl >= 0 ? '+' : ''}
          {formatMoneyShort(pnl)}
        </span>
      </td>
      <td>
        <button
          type="button"
          className={hotButton.className}
          style={hotButton.style}
          disabled={!open}
          aria-label={`Cash out ${position.symbol}`}
          onClick={(e) => {
            e.stopPropagation();
            sendOrder(client, e.currentTarget, position.symbol, -position.qty);
          }}
          data-testid="position-close"
        >
          <span className="fx-hot__label">Cash out</span>
        </button>
      </td>
    </tr>
  );
}

/** Mayhem: frozen (no orders) or HODL (no selling) keeps every cash-out button shut. */
function locked(portfolio: { frozenUntil?: number; hodlUntil?: number }, lastDay: number): boolean {
  return (portfolio.frozenUntil ?? -1) > lastDay || (portfolio.hodlUntil ?? -1) > lastDay;
}
