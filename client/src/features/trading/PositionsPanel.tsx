import { unrealizedPnl } from '@tg/shared';
import type { Position } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent, formatPrice, formatShares } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { useUiMode } from '../../lib/uiMode.ts';
import type { UiMode } from '../../lib/uiMode.ts';
import './trading.css';

/**
 * Your money: net worth as the big score number, how far you are from the start, and your open bets
 * (UP / DOWN, what each is worth now and what it made). Click a bet to look at it; x cashes it out.
 */
export function PositionsPanel({ className }: { className?: string }) {
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
      {mode === 'simple' && <BetResults />}
      {positions.length === 0 ? (
        <div className="positions__empty">No bets yet. Pick a stock and bet UP or DOWN.</div>
      ) : (
        <table className="positions__table" data-testid="positions">
          <thead>
            <tr>
              <th>{mode === 'simple' ? 'Company' : 'Stock'}</th>
              <th>Bet</th>
              {mode === 'pro' && <th>Avg</th>}
              {mode !== 'simple' && <th>Worth</th>}
              <th>Profit</th>
              {mode === 'simple' && <th>Ends</th>}
              <th aria-label="Cash out" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <PositionRow key={p.symbol} position={p} decimals={config.market.priceDecimals} canTrade={!live.portfolio.eliminated} mode={mode} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function PositionRow({ position, decimals, canTrade, mode }: { position: Position; decimals: number; canTrade: boolean; mode: UiMode }) {
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
  const { portfolio } = useGame();
  const lastDay = useLastDay();
  /** Days until the first quick bet on this symbol cashes out by itself ('' = a normal bet). */
  const endsIn = (symbol: string) => {
    const bet = portfolio?.bets?.filter((b) => b.symbol === symbol).sort((a, b) => a.closeAtDay - b.closeAtDay)[0];
    if (bet === undefined) return '';
    const left = bet.closeAtDay - Math.max(0, lastDay) + 1;
    return left <= 1 ? 'today' : `${left} days`;
  };

  return (
    <tr
      className={`positions__row${selected ? ' positions__row--selected' : ''}`}
      onClick={() => market.select(position.symbol)}
      title={`${formatShares(Math.abs(position.qty))} shares, bought at $${formatPrice(position.avgPrice, decimals)}, now $${formatPrice(last, decimals)}`}
      data-testid="position-row"
      data-symbol={position.symbol}
    >
      <td className={mode === 'simple' ? 'positions__name' : 'positions__sym'}>
        {mode === 'simple' ? (market.getInfo(position.symbol)?.name ?? position.symbol) : position.symbol}
      </td>
      <td>
        <span className={`positions__dir positions__dir--${up ? 'up' : 'down'}`} data-testid="position-qty" data-qty={position.qty}>
          {up ? '▲' : '▼'} {mode === 'simple' ? (up ? 'UP' : 'DOWN') : formatShares(position.qty)}
        </span>
      </td>
      {mode === 'pro' && <td>{formatPrice(position.avgPrice, decimals)}</td>}
      {mode !== 'simple' && <td>{formatMoneyShort(Math.abs(position.qty) * last)}</td>}
      <td className={`positions__profit change--${changeDirection(pnlFraction)}`} title={formatPercent(pnlFraction)}>
        {pnl >= 0 ? '+' : ''}
        {formatMoneyShort(pnl)}
      </td>
      {mode === 'simple' && <td className="positions__ends">{endsIn(position.symbol)}</td>}
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

/** Simple mode: the win streak and the last quick-bet results, newest first. */
function BetResults() {
  const { betResults, portfolio } = useGame();
  const market = useMarketStore();
  const streak = betResults[0]?.streak ?? portfolio?.streak ?? 0;
  if (betResults.length === 0) return <div className="bets__hint">Finished bets show up here.</div>;
  return (
    <div className="bets" data-testid="bet-results">
      <div className={`bets__streak${streak >= 2 ? ' bets__streak--hot' : ''}`} data-testid="streak">
        {streak > 0 ? `Win streak ${streak}` : 'Streak broken'}
      </div>
      <ol className="bets__list">
        {betResults.slice(0, 4).map((r) => (
          <li key={r.seq} className={`bets__item bets__item--${r.pnl > 0 ? 'win' : 'loss'}`} data-testid="bet-result">
            <span className="bets__mark">{r.pnl > 0 ? '✓' : '✗'}</span>
            <span className="bets__name">{market.getInfo(r.symbol)?.name ?? r.symbol}</span>
            <span className="bets__pnl">
              {r.pnl >= 0 ? '+' : ''}
              {formatMoneyShort(r.pnl)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
