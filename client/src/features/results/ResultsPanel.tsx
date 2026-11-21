import { SECTOR_LABELS } from '@tg/shared';
import type { LeaderboardEntry, RecapMove, Sector, Statement } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatMoney, formatMoneyShort, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useSymbols } from '../../net/marketHooks.ts';
import './results.css';

/** RESULTS: leaderboard, this player's quarter, the market recap, arrests and card authors. */
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
    <Panel title={`Q${results.recap.quarter} results`} aside="market recap / standings" className={`results ${className ?? ''}`}>
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
        <section className="results__block results__recap">
          <h3 className="results__heading">What moved the market</h3>
          <Recap moves={results.recap.topMoves} />
        </section>
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

export function Leaderboard({ rows, meId, pnlLabel }: { rows: readonly LeaderboardEntry[]; meId: string | undefined; pnlLabel: string }) {
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
        {rows.map((r) => (
          <tr key={r.playerId} className={r.playerId === meId ? 'results__row--me' : undefined} data-testid="leaderboard-row" data-player={r.playerId}>
            <td>{r.rank}</td>
            <td className="results__name">
              {r.name}
              {r.playerId === meId && <span className="results__tag">YOU</span>}
              {r.eliminated && <span className="results__tag results__tag--down">OUT</span>}
              {r.jailed && <span className="results__tag results__tag--warn">JAIL</span>}
            </td>
            <td>{formatMoneyShort(r.netWorth)}</td>
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

const CAUSE_LABEL: Record<RecapMove['cause']['kind'], string> = {
  headline: 'NEWS',
  earnings: 'EARNINGS',
  card: 'CARD',
  regime: 'REGIME',
  noise: 'DRIFT',
};

function Recap({ moves }: { moves: readonly RecapMove[] }) {
  const symbols = useSymbols();
  if (moves.length === 0) return <div className="results__dim">A quiet quarter.</div>;
  return (
    <ol className="results__moves">
      {moves.map((m) => {
        const name = m.kind === 'sector' ? SECTOR_LABELS[m.target as Sector] : (symbols.find((s) => s.symbol === m.target)?.name ?? m.target);
        return (
          <li key={m.target} className="results__move" data-testid="recap-move" data-cause={m.cause.kind}>
            <div className="results__move-head">
              <span className="results__move-name">
                {m.kind === 'stock' && <span className="results__sym">{m.target}</span>} {name}
                {m.kind === 'sector' && <span className="results__dim"> sector</span>}
              </span>
              <span className={`results__move-change results__pnl--${changeDirection(m.change)}`}>{formatPercent(m.change)}</span>
            </div>
            <div className="results__cause">
              <span className={`results__tag results__tag--${m.cause.kind}`}>{CAUSE_LABEL[m.cause.kind]}</span> {m.cause.text}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
