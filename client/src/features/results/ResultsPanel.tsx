import type React from 'react';
import type { LeaderboardEntry, Statement } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { ReadyUp } from '../../components/ReadyUp.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { CountUp } from '../fx/CountUp.tsx';
import { QuarterNetWorth } from './QuarterNetWorth.tsx';
import '../fx/fx.css';
import './results.css';

/** RESULTS: leaderboard, each player's net-worth path, statements, arrests and card authors. */
export function ResultsPanel({ className }: { className?: string }) {
  const { results, phase, me } = useGame();
  const quarter = phase?.quarter ?? 0;
  if (!results || results.final || results.recap.quarter !== quarter) {
    return (
      <Panel title="Results" className={className}>
        <Placeholder>Tallying the quarter…</Placeholder>
      </Panel>
    );
  }
  const mine = results.statements.find((s) => s.playerId === me?.playerId);
  return (
    <Panel title={`Q${results.recap.quarter} results`} className={`results ${className ?? ''}`}>
      <ReadyUp />
      <div className="results__grid">
        <section className="results__block results__board">
          <h3 className="results__heading">Standings</h3>
          <Leaderboard rows={results.leaderboard} meId={me?.playerId} pnlLabel="Quarter P&L" />
        </section>
        {mine && (
          <section className="results__block results__mine" data-testid="my-statement">
            <h3 className="results__heading">Your quarter</h3>
            <MyStatement statement={mine} />
          </section>
        )}
        <QuarterNetWorth key={quarter} results={results} />
        {(results.arrests.length > 0 || results.recap.cardAuthors.length > 0) && (
          <section className="results__block results__news">
            {results.arrests.length > 0 && (
              <>
                <h3 className="results__heading results__heading--alert">Arrests</h3>
                <ul className="results__list" data-testid="arrests">
                  {results.arrests.map((a) => (
                    <li key={a.playerId}>
                      {a.text} <span className="results__dim">Fined {formatMoneyShort(a.fine)}.</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {results.recap.cardAuthors.length > 0 && (
              <>
                <h3 className="results__heading">Card authors revealed</h3>
                <ul className="results__list" data-testid="card-authors">
                  {results.recap.cardAuthors.map((c, i) => (
                    <li key={i}>
                      <strong>{c.name}</strong> played {c.cardName}: <span className="results__dim">“{c.text}”</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}

const fxIndex = (i: number) => ({ '--fx-i': i }) as React.CSSProperties;

export function Leaderboard({ rows, meId, pnlLabel, tally = true }: { rows: readonly LeaderboardEntry[]; meId: string | undefined; pnlLabel: string; tally?: boolean }) {
  return (
    <table className="results__table" data-testid="leaderboard">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Net worth</th>
          <th>{pnlLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.playerId}
            className={`fx-deal${r.playerId === meId ? ' results__row--me' : ''}`}
            style={fxIndex(i)}
            data-testid="leaderboard-row"
            data-player={r.playerId}
          >
            <td>{r.rank}</td>
            <td className="results__name">
              {r.name}
              {r.playerId === meId && <span className="results__tag">YOU</span>}
              {r.eliminated && <span className="results__tag results__tag--down">OUT</span>}
              {r.jailed && <span className="results__tag results__tag--warn">JAIL</span>}
            </td>
            <td className="results__worth">
              {tally ? (
                <CountUp value={r.netWorth} from={r.netWorth - r.pnl} format={formatMoneyShort} delayMs={300 + i * 140} sound={i === 0} />
              ) : (
                formatMoneyShort(r.netWorth)
              )}
            </td>
            <td className={`results__pnl--${changeDirection(r.pnl)}`}>{formatMoneyShort(r.pnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MyStatement({ statement: s }: { statement: Statement }) {
  const change = s.startEquity > 0 ? s.endEquity / s.startEquity - 1 : 0;
  return (
    <dl className="results__facts">
      <div>
        <dt>Net worth</dt>
        <dd>
          {formatMoneyShort(s.startEquity)} → {formatMoneyShort(s.endEquity)}{' '}
          <span className={`results__pnl--${changeDirection(change)}`}>{formatPercent(change)}</span>
        </dd>
      </div>
      <div>
        <dt>Best trade</dt>
        <dd data-testid="best-trade">{s.bestTrade ? `${s.bestTrade.symbol} ${formatMoney(s.bestTrade.pnl, true)}` : '—'}</dd>
      </div>
      <div>
        <dt>Worst trade</dt>
        <dd>{s.worstTrade ? `${s.worstTrade.symbol} ${formatMoney(s.worstTrade.pnl, true)}` : '—'}</dd>
      </div>
      {s.cardSpend > 0 && (
        <div>
          <dt>Spent on cards</dt>
          <dd>{formatMoneyShort(s.cardSpend)}</dd>
        </div>
      )}
      {s.fines > 0 && (
        <div>
          <dt>Fines</dt>
          <dd className="results__pnl--down">{formatMoneyShort(s.fines)}</dd>
        </div>
      )}
    </dl>
  );
}
