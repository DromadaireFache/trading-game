import type { EarningsReport } from '@tg/shared';
import { Panel } from '../../components/Panel.tsx';
import { changeDirection, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore } from '../../net/marketHooks.ts';
import './headlines.css';

export function EarningsPanel() {
  const { earnings, phase, briefing, config } = useGame();
  const market = useMarketStore();
  const earningsQuarter = phase?.phase === 'BRIEFING'
    ? phase.quarter - 1
    : phase?.phase === 'FINAL' ? phase.quarter : null;
  if (!earnings || earnings.quarter !== earningsQuarter) return null;

  const { quarter, reports } = earnings;
  const eps = (r: EarningsReport) => {
    const est = briefing?.consensus?.[r.symbol];
    return est === undefined ? undefined : `Profit per share $${(est * (1 + r.surprise)).toFixed(2)}, expected $${est.toFixed(2)}`;
  };

  return (
    <Panel title={`Q${quarter} earnings`} className="earnings" key={quarter}>
      <div className="earnings__report" data-testid="earnings">
        <div className="earnings__scroll" role="region" aria-label="Company earnings" tabIndex={0}>
          <ul className="earnings__list">
            {reports.map((r) => (
              <li key={r.symbol} title={eps(r)}>
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
