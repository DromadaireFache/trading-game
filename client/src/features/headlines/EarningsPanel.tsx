import { Panel } from '../../components/Panel.tsx';
import { changeDirection, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore } from '../../net/marketHooks.ts';
import './headlines.css';

export function EarningsPanel() {
  const { earnings, phase, config } = useGame();
  const market = useMarketStore();
  const earningsQuarter = phase?.phase === 'BRIEFING'
    ? phase.quarter - 1
    : phase?.phase === 'FINAL' ? phase.quarter : null;
  if (!earnings || earnings.quarter !== earningsQuarter) return null;

  const { quarter, reports } = earnings;

  return (
    <Panel title={`Q${quarter} earnings`} className="earnings" key={quarter}>
      <div className="earnings__report" data-testid="earnings">
        <div className="earnings__scroll" role="region" aria-label="Company earnings" tabIndex={0}>
          <ul className="earnings__list">
            {reports.map((r) => (
              <li key={r.symbol}>
                <button type="button" className="ticker-tag" onClick={() => market.select(r.symbol)}>
                  {r.symbol}
                </button>
                <span className={`change--${changeDirection(r.surprise)}`}>
                  {r.surprise === 0
                    ? 'met expectations'
                    : `${r.surprise > 0 ? 'beat' : 'miss'} ${formatPercent(r.surprise)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
