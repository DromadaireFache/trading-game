import { Panel, Placeholder } from '../../components/Panel.tsx';
import { formatMoneyShort } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { Leaderboard } from './ResultsPanel.tsx';
import './results.css';

/** FINAL: the winner, the final standings (P&L since the start) and the awards. */
export function FinalPanel({ className }: { className?: string }) {
  const { results, me, config } = useGame();
  const client = useGameClient();
  if (!results?.final) {
    return (
      <Panel title="Final" className={className}>
        <Placeholder>Counting the money…</Placeholder>
      </Panel>
    );
  }
  const winner = results.leaderboard[0];
  const multiple = winner ? winner.netWorth / config.economy.startingCash : 0;
  return (
    <Panel
      title="Final standings"
      aside={
        me?.role === 'player' ? (
          <button type="button" className="results__again" data-testid="new-game" onClick={() => client.newGame()}>
            Play again
          </button>
        ) : (
          'game over'
        )
      }
      className={`results ${className ?? ''}`}
    >
      {winner && (
        <div className="results__winner" data-testid="winner">
          <span className="results__winner-name">{winner.name}</span> wins with{' '}
          <span className="results__winner-money">{formatMoneyShort(winner.netWorth)}</span>{' '}
          <span className="results__dim">({multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}× the starting {formatMoneyShort(config.economy.startingCash)})</span>
        </div>
      )}
      <div className="results__grid">
        <section className="results__block results__board">
          <h3 className="results__heading">Leaderboard</h3>
          <Leaderboard rows={results.leaderboard} meId={me?.playerId} pnlLabel="Total P&L" />
        </section>
        <section className="results__block results__awards">
          <h3 className="results__heading">Awards</h3>
          {(results.awards ?? []).length === 0 ? (
            <div className="results__dim">No awards this time.</div>
          ) : (
            <ul className="results__award-list" data-testid="awards">
              {results.awards!.map((a) => (
                <li key={a.title} className={`results__award${a.playerId === me?.playerId ? ' results__award--me' : ''}`} data-testid="award">
                  <div className="results__award-title">{a.title}</div>
                  <div className="results__award-name">{a.name}</div>
                  <div className="results__dim">{a.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}
