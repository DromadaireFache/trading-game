import { SECTOR_LABELS } from '@tg/shared';
import type { Sector } from '@tg/shared';
import { useEffect, useState } from 'react';
import { changeDirection, formatMoneyShort, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useSymbols } from '../../net/marketHooks.ts';
import { Leaderboard } from './ResultsPanel.tsx';
import './results.css';

/**
 * Projector, in RESULTS and FINAL: the standings plus either the market recap (RESULTS) or the winner
 * and awards (FINAL). Null when there is nothing to show yet.
 */
export function FloorResults() {
  const { results, phase, config } = useGame();
  const symbols = useSymbols();
  const current = phase?.phase;
  if (!results || !current) return null;
  if (current === 'FINAL' ? !results.final : current !== 'RESULTS') return null;

  const winner = results.leaderboard[0];
  return (
    <section className="floor-board" data-testid="floor-results">
      {results.final && winner && (
        <div className="results__winner" data-testid="floor-winner">
          <span className="results__winner-name">{winner.name}</span> wins with{' '}
          <span className="results__winner-money">{formatMoneyShort(winner.netWorth)}</span>{' '}
          <span className="results__dim">({(winner.netWorth / config.economy.startingCash).toFixed(1)}×)</span>
        </div>
      )}
      <Leaderboard rows={results.leaderboard} meId={undefined} pnlLabel={results.final ? 'Total P&L' : `Q${results.recap.quarter} P&L`} />
      {results.final ? (
        <ul className="results__award-list">
          {(results.awards ?? []).map((a) => (
            <li key={a.title} className="results__award">
              <div className="results__award-title">{a.title}</div>
              <div className="results__award-name">{a.name}</div>
              <div className="results__dim">{a.detail}</div>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="results__moves">
          {results.recap.topMoves.map((m) => (
            <li key={m.target} className="results__move">
              <div className="results__move-head">
                <span className="results__move-name">
                  {m.kind === 'sector' ? `${SECTOR_LABELS[m.target as Sector]} sector` : (symbols.find((s) => s.symbol === m.target)?.name ?? m.target)}
                </span>
                <span className={`results__move-change results__pnl--${changeDirection(m.change)}`}>{formatPercent(m.change)}</span>
              </div>
              <div className="results__cause">{m.cause.text}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Full-screen BREAKING banner for presentation.momentVisibleMs after a `moment` arrives. */
export function MomentBanner() {
  const { moment, config } = useGame();
  const visibleMs = config.presentation.momentVisibleMs;
  const [, rerender] = useState(0);
  const left = moment ? moment.at + visibleMs - Date.now() : 0;
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => rerender((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [moment, left]);
  if (!moment || left <= 0) return null;
  return (
    <div className={`moment moment--${moment.kind}`} data-testid="moment" data-kind={moment.kind} role="alert">
      <div className="moment__label">BREAKING</div>
      <div className="moment__text">{moment.text}</div>
    </div>
  );
}
