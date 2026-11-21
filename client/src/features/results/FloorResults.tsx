import type React from 'react';
import { useEffect, useState } from 'react';
import { formatMoneyShort } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { CountUp } from '../fx/CountUp.tsx';
import { Leaderboard } from './ResultsPanel.tsx';
import { QuarterNetWorth } from './QuarterNetWorth.tsx';
import './results.css';

/**
 * Projector, in RESULTS and FINAL: the standings plus either the quarter replay (RESULTS) or the winner
 * and awards (FINAL). Null when there is nothing to show yet.
 */
export function FloorResults({ pauseReplay }: { pauseReplay: boolean }) {
  const { results, phase, config } = useGame();
  const current = phase?.phase;
  if (!results || !current) return null;
  if (current === 'FINAL' ? !results.final : current !== 'RESULTS' || results.final || results.recap.quarter !== phase.quarter) return null;

  const winner = results.leaderboard[0];
  return (
    <section className="floor-board" data-testid="floor-results">
      {results.final && winner && (
        <div className="results__winner fx-wobble" data-testid="floor-winner">
          <span className="results__winner-name">{winner.name}</span> wins with{' '}
          <CountUp className="results__winner-money" value={winner.netWorth} from={config.economy.startingCash} format={formatMoneyShort} durationMs={1800} sound />{' '}
          <span className="results__dim">({(winner.netWorth / config.economy.startingCash).toFixed(1)}×)</span>
        </div>
      )}
      <Leaderboard rows={results.leaderboard} meId={undefined} pnlLabel={results.final ? 'Total P&L' : `Q${results.recap.quarter} P&L`} tally={!results.final} />
      {results.final ? (
        <ul className="results__award-list">
          {(results.awards ?? []).map((a, i) => (
            <li key={a.title} className="results__award fx-deal" style={{ '--fx-i': i + 3 } as React.CSSProperties}>
              <div className="results__award-title">{a.title}</div>
              <div className="results__award-name">{a.name}</div>
              <div className="results__dim">{a.detail}</div>
            </li>
          ))}
        </ul>
      ) : (
        <QuarterNetWorth key={results.recap.quarter} results={results} paused={pauseReplay} />
      )}
    </section>
  );
}

export function useVisibleMoment() {
  const { moment, config } = useGame();
  const visibleMs = config.presentation.momentVisibleMs;
  const [, rerender] = useState(0);
  const left = moment ? moment.at + visibleMs - Date.now() : 0;
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => rerender((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [moment, left]);
  return left > 0 ? moment : null;
}

/** Full-screen BREAKING banner while a moment is visible. */
export function MomentBanner({ moment }: { moment: NonNullable<ReturnType<typeof useVisibleMoment>> }) {
  return (
    <div className={`moment moment--${moment.kind}`} data-testid="moment" data-kind={moment.kind} role="alert">
      <div className="moment__label">BREAKING</div>
      <div className="moment__text">{moment.text}</div>
    </div>
  );
}
