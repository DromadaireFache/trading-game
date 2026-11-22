import { dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { LobbyPlayer, Position } from '@tg/shared';
import { Panel } from '../../components/Panel.tsx';
import { formatMoneyShort } from '../../lib/format.ts';
import { PLAYER_COLOR_APPEARANCE } from '../../lib/playerColor.ts';
import { useGame, useHoldings } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useQuoteValue } from '../../net/marketHooks.ts';
import type { Holdings } from '../../net/state.ts';
import './rivals.css';

/** One column per other seat (maxPlayers - 1), so the layout does not jump when people join. */
export function RivalsPanel({ className }: { className?: string }) {
  const { lobby, me, config } = useGame();
  const holdings = useHoldings();
  const others = (lobby?.players ?? []).filter((p) => p.id !== me?.playerId);
  const seats = Math.max(1, config.lobby.maxPlayers - 1);
  const sealed = useStandingsSealed();
  return (
    <Panel title="The other players" aside={sealed ? 'last quarter: amounts hidden' : undefined} className={`rivals${className ? ` ${className}` : ''}`}>
      <div className="rivals__cols" style={{ gridTemplateColumns: `repeat(${seats}, minmax(0, 1fr))` }} data-testid="rivals">
        {Array.from({ length: seats }, (_, i) => {
          const player = others[i];
          return player === undefined ? (
            <div key={`empty-${i}`} className="rival rival--empty" aria-hidden="true" />
          ) : (
            <Rival key={player.id} player={player} held={holdings[player.id]} />
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * In the last quarter nobody sees how rich the others are: the standings stay a secret until the
 * finale reveals them. Tickers and long / short still show.
 */
export function useStandingsSealed(): boolean {
  const { phase } = useGame();
  if (!phase || phase.quarter < 1) return false;
  return phase.quarter >= phase.totalQuarters && (phase.phase === 'BRIEFING' || phase.phase === 'TRADING');
}

function Rival({ player, held }: { player: LobbyPlayer; held: Holdings | undefined }) {
  const { config } = useGame();
  const sealed = useStandingsSealed();
  const lastDay = useLastDay();
  const positions = [...(held?.positions ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const jailed = held?.jailedUntil !== undefined && Math.max(0, lastDay) < held.jailedUntil;
  return (
    <div className={`rival${player.connected ? '' : ' rival--offline'}`} data-testid="rival" data-player={player.id}>
      <div className="rival__head">
        <span className="rival__name" style={{ color: player.color && PLAYER_COLOR_APPEARANCE[player.color].hex }}>{player.name}</span>
        {held && (
          <span className={`rival__worth${sealed ? ' rival__worth--sealed' : ''}`}>
            {sealed ? '$ ???' : formatMoneyShort(held.equity)}
          </span>
        )}
      </div>
      {(jailed || held?.eliminated || !player.connected) && (
        <div className="rival__tags">
          {jailed && (
            <span className="rival__tag rival__tag--jail">
              in jail
            </span>
          )}
          {held?.eliminated && <span className="rival__tag">out</span>}
          {!player.connected && <span className="rival__tag">offline</span>}
        </div>
      )}
      {positions.length > 0 && (
        <ul className="rival__list">
          {positions.map((p) => (
            <RivalPosition key={p.symbol} position={p} sealed={sealed} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ticker and what the bet is worth now; green = long (betting up), red = short (betting down). */
function RivalPosition({ position, sealed }: { position: Position; sealed: boolean }) {
  const market = useMarketStore();
  const long = position.qty > 0;
  // Only the rounded amount is shown: re-render when it changes, not on every tick.
  const amount = useQuoteValue(position.symbol, (quote) =>
    sealed ? '???' : formatMoneyShort(Math.abs(position.qty) * (quote?.price ?? position.avgPrice)),
  );
  return (
    <li
      className={`rival__pos rival__pos--${long ? 'long' : 'short'}`}
      data-testid="rival-position"
      data-symbol={position.symbol}
      onClick={() => market.select(position.symbol)}
    >
      <span className="rival__dir">{long ? '▲' : '▼'}</span>
      <span className="rival__ticker">{position.symbol}</span>
      <span className="rival__amount">{amount}</span>
    </li>
  );
}
