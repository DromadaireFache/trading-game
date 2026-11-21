import { unrealizedPnl } from '@tg/shared';
import type { Position } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { useUiMode } from '../../lib/uiMode.ts';
import type { UiMode } from '../../lib/uiMode.ts';
import { sendOrder } from '../fx/buttonFx.ts';
import './trading.css';

/** Your money: net worth as the big score number and how far you are from the start. */
export function MoneyPanel({ className }: { className?: string }) {
  const live = useLivePortfolio();
  const { config } = useGame();
  const mode = useUiMode();

  if (live === null) {
    return (
      <Panel title="Your money" className={className}>
        <Placeholder>Your money shows up when the game starts.</Placeholder>
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
      <div className="positions__score" title="Net worth = cash + what your bets are worth now. Highest at the end wins.">
        <span className="positions__worth" data-testid="equity">
          {formatMoney(live.equity)}
        </span>
        <span className={`positions__pnl change--${changeDirection(pnlFraction)}`} data-testid="total-pnl" title="Since the start of the game">
          {formatMoney(live.totalPnl, true)} ({formatPercent(pnlFraction)})
        </span>
      </div>
      {mode !== 'simple' && (
        <div className="positions__sub">
          <span title="Money not in a bet (negative = borrowed)">
            Cash <strong data-testid="cash">{formatMoney(live.portfolio.cash)}</strong>
          </span>
          <span title="Total size of all your bets">
            In bets <strong>{formatMoneyShort(live.gross)}</strong>
          </span>
        </div>
      )}
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
  const mode = useUiMode();

  if (live === null) {
    return (
      <Panel title="Your positions" className={className}>
        <Placeholder>Your bets show up here when the game starts.</Placeholder>
      </Panel>
    );
  }

  const positions = [...live.portfolio.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return (
    <Panel
      title="Your positions"
      aside={<span className="positions__legend"><span className="change--up">▲ long</span> <span className="change--down">▼ short</span></span>}
      className={`positions${className ? ` ${className}` : ''}`}
    >
      {positions.length === 0 ? (
        <div className="positions__empty">No bets yet. Pick a stock and bet UP or DOWN.</div>
      ) : (
        <div className="positions__scroll">
          <table className="positions__table" data-testid="positions">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Bet</th>
                {mode === 'pro' && <th>Avg</th>}
                <th>Worth</th>
                <th>Profit</th>
                <th aria-label="Cash out" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <PositionRow key={p.symbol} position={p} decimals={config.market.priceDecimals} canTrade={!live.portfolio.eliminated} mode={mode} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PositionRow({ position, decimals, canTrade, mode }: { position: Position; decimals: number; canTrade: boolean; mode: UiMode }) {
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

  return (
    <tr
      className={`positions__row positions__row--${up ? 'up' : 'down'}${selected ? ' positions__row--selected' : ''}`}
      onClick={() => market.select(position.symbol)}
      title={`${formatShares(Math.abs(position.qty))} shares, bought at $${formatPrice(position.avgPrice, decimals)}, now $${formatPrice(last, decimals)}`}
      data-testid="position-row"
      data-symbol={position.symbol}
    >
      <td className="positions__sym">{position.symbol}</td>
      <td>
        <span className={`positions__dir positions__dir--${up ? 'up' : 'down'}`} data-testid="position-qty" data-qty={position.qty}>
          {up ? '▲' : '▼'} {mode === 'pro' ? formatShares(position.qty) : up ? 'LONG' : 'SHORT'}
        </span>
      </td>
      {mode === 'pro' && <td>{formatPrice(position.avgPrice, decimals)}</td>}
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
          aria-label={`Cash out ${position.symbol}`}
          title={`Cash out ${position.symbol}`}
          onClick={(e) => {
            e.stopPropagation();
            sendOrder(client, e.currentTarget, position.symbol, -position.qty);
          }}
          data-testid="position-close"
        >
          Cash out
        </button>
      </td>
    </tr>
  );
}
